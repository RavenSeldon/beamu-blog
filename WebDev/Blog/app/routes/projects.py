"""Project routes: list, detail, create, edit, delete, featured toggle."""
import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required
from werkzeug.utils import secure_filename
from uuid import uuid4

from app.extensions import db, cache
from app.models import Project, Photo
from app.helpers import allowed_file, invalidate_content_caches, handle_image_upload, replace_item_image
from app.utils.image_utils import process_upload_image

projects_bp = Blueprint('projects_bp', __name__)


@projects_bp.route('/projects')
@cache.cached()
def projects():
    try:
        projects_list = Project.query.order_by(Project.date_posted.desc()).all()
        current_app.logger.info(f"Retrieved {len(projects_list)} projects")
        for project in projects_list:
            current_app.logger.info(f"Project ID: {project.id}, Title: {project.title}, Image: {project.photo_id}")
        return render_template('projects.html', projects=projects_list)
    except Exception as e:
        current_app.logger.error(f"Error retrieving projects: {str(e)}")
        flash(f'Error loading projects: {str(e)}', 'error')
        return render_template('projects.html', projects=[])


@projects_bp.route('/project/<int:project_id>')
def project_detail(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return redirect(url_for('page_not_found_error', path=f'project/{project_id}'))
    return render_template('project_detail.html', project=project)


@projects_bp.route('/new_project', methods=['GET', 'POST'])
@login_required
def new_project():
    if request.method == 'POST':
        current_app.logger.info("Processing new project submission")
        title = request.form['title'].strip()
        description = request.form.get('description', '').strip()
        github_link = request.form.get('github_link', '').strip() or None
        image_file = request.files.get('image')

        if not title or not description:
            flash('Project title and description are required!', 'error')
            return redirect(url_for('new_project'))

        try:
            project = Project(title=title, description=description, github_link=github_link or None)
            db.session.add(project)
            db.session.flush()

            if image_file and allowed_file(image_file.filename):
                photo = handle_image_upload(image_file, description=f"Cover for {title}")
                if photo:
                    project.photo_id = photo.id
                    project.photo = photo

            db.session.commit()
            invalidate_content_caches('project')
            flash('Project created!', 'success')
            return redirect(url_for('projects'))

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error creating project: {str(e)}")
            flash(f'Error creating project: {str(e)}', 'error')
            return redirect(url_for('new_project'))

    return render_template('new_project.html')


@projects_bp.route('/edit_project/<int:project_id>', methods=['GET', 'POST'])
@login_required
def edit_project(project_id):
    project = Project.query.get_or_404(project_id)

    if request.method == 'POST':
        project.title = request.form['title'].strip()
        project.description = request.form.get('description', '').strip()
        project.github_link = request.form.get('github_link', '').strip() or None

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(project, image_file, description=f"Cover for {project.title}")

        db.session.commit()
        invalidate_content_caches('project')
        flash('Project updated!', 'success')
        return redirect(url_for('project_detail', project_id=project.id))

    return render_template('edit_project.html', project=project)


@projects_bp.route('/set_featured_project/<int:project_id>', methods=['POST'])
@login_required
def set_featured_project(project_id):
    project = Project.query.get_or_404(project_id)
    Project.query.update({'is_featured': False})
    project.is_featured = True
    db.session.commit()
    invalidate_content_caches('project')
    flash(f'"{project.title}" is now featured on the Home Page!', 'success')
    return redirect(url_for('projects'))


@projects_bp.route('/unset_featured_project', methods=['POST'])
@login_required
def unset_featured_project():
    Project.query.update({'is_featured': False})
    db.session.commit()
    invalidate_content_caches('project')
    flash('Featured project removed', 'success')
    return redirect(url_for('projects'))


@projects_bp.route('/delete_project/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if not project:
        flash('Project not found.', 'error')
        return redirect(url_for('projects'))
    db.session.delete(project)
    db.session.commit()
    invalidate_content_caches('project')
    flash('Project and all associated items deleted successfully', 'success')
    return redirect(url_for('projects'))
