"""Post routes: view, create, edit, delete for generic posts."""
import os
from datetime import datetime, timezone
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required
from werkzeug.utils import secure_filename
from uuid import uuid4

from app.extensions import db
from app.models import Post, Photo, Project
from app.helpers import allowed_file, invalidate_content_caches, handle_image_upload, replace_item_image, sync_tags
from app.utils.image_utils import process_upload_image

posts_bp = Blueprint('posts', __name__)


@posts_bp.route('/post/<int:post_id>')
def post(post_id):
    post_item = db.session.get(Post, post_id)
    if not post_item:
        return redirect(url_for('page_not_found_error', path=f'post/{post_id}'))

    if post_item.type == 'music_item':
        return render_template('music_item_detail.html', item=post_item)
    elif post_item.type == 'video':
        return render_template('video_detail.html', item=post_item)
    elif post_item.type == 'review':
        return render_template('review_detail.html', item=post_item)
    else:
        return render_template('post.html', post=post_item)


@posts_bp.route('/new_post', methods=['GET', 'POST'])
@login_required
def new_post():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form['content'][:20000]
        github_link = request.form.get('github_link', '')
        project_id = request.form.get('project_id')
        image_file = request.files.get('image')

        # Parse optional scheduled publish date
        # datetime-local input gives naive local time — treat as UTC
        # (the form label says UTC; for local-time support, use JS to convert)
        published_at_str = request.form.get('published_at', '').strip()
        published_at = None
        if published_at_str:
            try:
                naive = datetime.fromisoformat(published_at_str)
                published_at = naive.replace(tzinfo=timezone.utc)
                # Validate it's actually in the future
                if published_at <= datetime.now(timezone.utc):
                    flash('Scheduled time is in the past — publishing immediately.', 'warning')
                    published_at = None
                else:
                    flash(f'Post scheduled for {published_at.strftime("%B %d, %Y at %H:%M")} UTC.', 'success')
            except ValueError:
                flash('Invalid schedule date format.', 'error')

        post_obj = Post(
            title=title, content=content,
            github_link=github_link if github_link else None,
            project_id=project_id if project_id else None,
            published_at=published_at,
            type='post'
        )
        db.session.add(post_obj)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            photo = handle_image_upload(image_file, description=title)
            if photo:
                post_obj.photo_id = photo.id
                post_obj.photo = photo

        sync_tags(post_obj, request.form.get('tags', ''))

        db.session.commit()
        invalidate_content_caches('post')
        flash('Post created!', 'success')
        return redirect(url_for('index'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_post.html', projects=projects)


@posts_bp.route('/edit_post/<int:post_id>', methods=['GET', 'POST'])
@login_required
def edit_post(post_id):
    post_obj = Post.query.get_or_404(post_id)

    if request.method == 'POST':
        post_obj.title = request.form['title']
        post_obj.content = request.form['content'][:20000]
        post_obj.github_link = request.form.get('github_link', '').strip() or None
        post_obj.project_id = request.form.get('project_id') or None

        # Update scheduled publish date
        published_at_str = request.form.get('published_at', '').strip()
        if published_at_str:
            try:
                naive = datetime.fromisoformat(published_at_str)
                new_published_at = naive.replace(tzinfo=timezone.utc)
                if new_published_at <= datetime.now(timezone.utc):
                    flash('Scheduled time is in the past — publishing immediately.', 'warning')
                    post_obj.published_at = None
                else:
                    post_obj.published_at = new_published_at
                    flash(f'Post scheduled for {new_published_at.strftime("%B %d, %Y at %H:%M")} UTC.', 'success')
            except ValueError:
                pass
        else:
            post_obj.published_at = None

        sync_tags(post_obj, request.form.get('tags', ''))

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(post_obj, image_file, description=post_obj.title)

        db.session.commit()
        invalidate_content_caches('post')
        flash('Post updated!', 'success')
        return redirect(url_for('post', post_id=post_obj.id))

    projects = Project.query.order_by(Project.title).all()
    return render_template('edit_post.html', post=post_obj, projects=projects)


@posts_bp.route('/delete_post/<int:post_id>', methods=['POST'])
@login_required
def delete_post(post_id):
    post_obj = Post.query.get_or_404(post_id)

    if not post_obj:
        flash('Post not found.', 'error')
        return redirect(url_for('index'))

    post_type = post_obj.type
    db.session.delete(post_obj)
    db.session.commit()
    invalidate_content_caches(post_type)

    flash(f'{post_type.capitalize()} deleted successfully', 'success')
    return redirect(url_for('index'))
