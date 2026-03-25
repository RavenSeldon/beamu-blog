"""Media routes: photos, music items, videos, reviews CRUD."""
import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required
from werkzeug.utils import secure_filename
from uuid import uuid4

from app.extensions import db, cache
from app.models import Photo, Post, Project, MusicItem, Video, Review
from app.helpers import allowed_file, invalidate_content_caches, handle_image_upload, replace_item_image, published_filter
from app.utils.image_utils import process_upload_image, USING_SPACES, IMAGE_SIZES
from app.utils.s3_utils import delete_files

media_bp = Blueprint('media', __name__)


# ──────────────────────────────────────────────
#  Photos
# ──────────────────────────────────────────────

@media_bp.route('/photo_album')
@cache.cached()
def photo_album():
    photos = Photo.query.all()
    return render_template('photo_album.html', photos=photos)


@media_bp.route('/new_photo', methods=['GET', 'POST'])
@login_required
def new_photo():
    if request.method == 'POST':
        current_app.logger.info("Processing new photo submission")
        photo_file = request.files.get('image')
        description = request.form.get('description', '').strip()

        if not photo_file or not allowed_file(photo_file.filename):
            flash("No photo submitted!", "error")
            return redirect(url_for('new_photo'))

        photo = handle_image_upload(photo_file, description=description)
        if not photo:
            flash("Error processing photo.", "error")
            return redirect(url_for('new_photo'))

        db.session.commit()
        invalidate_content_caches('photo')

        flash('Photo uploaded!', 'success')
        return redirect(url_for('new_photo'))

    projects = Project.query.order_by(Project.title).all()
    posts = Post.query.order_by(Post.title).all()
    return render_template('new_photo.html', posts=posts, projects=projects)

@media_bp.route('/bulk_upload_photos', methods=['GET', 'POST'])
@login_required
def bulk_upload_photos():
    if request.method == 'POST':
        files = request.files.getlist('images')
        if not files or all(f.filename == '' for f in files):
            flash('No files selected.', 'error')
            return redirect(url_for('bulk_upload_photos'))

        success_count = 0
        fail_count = 0
        for f in files:
            if f and f.filename and allowed_file(f.filename):
                photo = handle_image_upload(f, description=None)
                if photo:
                    success_count += 1
                else:
                    fail_count += 1
            else:
                fail_count += 1

        db.session.commit()
        invalidate_content_caches('photo')

        if success_count:
            flash(f'{success_count} photo(s) uploaded successfully.', 'success')
        if fail_count:
            flash(f'{fail_count} file(s) skipped (invalid type or processing error).', 'error')
        return redirect(url_for('photo_album'))

    return render_template('bulk_upload_photos.html')


@media_bp.route('/edit_photo/<int:photo_id>', methods=['GET', 'POST'])
@login_required
def edit_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)

    if request.method == 'POST':
        photo.description = request.form.get('description', '').strip() or None

        # Optionally replace the image file itself
        image_file = request.files.get('image')
        if image_file and image_file.filename and allowed_file(image_file.filename):
            # Process new image with same base workflow
            ext = os.path.splitext(secure_filename(image_file.filename))[1].lower()
            unique_filename = f"{uuid4().hex}{ext}"

            image_paths = process_upload_image(
                image_file, current_app.config['UPLOAD_FOLDER'], unique_filename
            )

            if image_paths:
                old_filename = photo.filename

                # Delete old files from storage (original + WebP)
                old_no_ext = os.path.splitext(old_filename)[0]
                try:
                    if USING_SPACES:
                        paths = []
                        for size in IMAGE_SIZES:
                            paths.append(f"{size}/{old_filename}")
                            paths.append(f"{size}/{old_no_ext}.webp")
                        delete_files(paths)
                    else:
                        for size in IMAGE_SIZES:
                            for fname in [old_filename, f"{old_no_ext}.webp"]:
                                path = os.path.join(current_app.config['UPLOAD_FOLDER'], size, fname)
                                if os.path.exists(path):
                                    os.remove(path)
                except Exception as e:
                    current_app.logger.warning(f"Failed to delete old photo files: {e}")

                photo.filename = unique_filename

        db.session.commit()
        invalidate_content_caches('photo')
        flash('Photo updated!', 'success')
        return redirect(url_for('photo_album'))

    return render_template('edit_photo.html', photo=photo)


@media_bp.route('/delete_photo/<int:photo_id>', methods=['POST'])
@login_required
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)
    if not photo:
        flash('Photo not found.', 'error')
        return redirect(url_for('photo_album'))

    filename = photo.filename

    name_no_ext = os.path.splitext(filename)[0]
    try:
        if USING_SPACES:
            paths_to_delete = []
            for size in IMAGE_SIZES:
                paths_to_delete.append(f"{size}/{filename}")
                paths_to_delete.append(f"{size}/{name_no_ext}.webp")
            delete_files(paths_to_delete)
        else:
            for size in IMAGE_SIZES:
                for fname in [filename, f"{name_no_ext}.webp"]:
                    file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], size, fname)
                    if os.path.exists(file_path):
                        os.remove(file_path)
    except Exception as e:
        flash(f'Error deleting image files: {str(e)}', 'error')

    db.session.delete(photo)
    db.session.commit()
    invalidate_content_caches('photo')

    flash('Photo deleted successfully', 'success')
    return redirect(url_for('photo_album'))


# ──────────────────────────────────────────────
#  Music
# ──────────────────────────────────────────────

@media_bp.route('/music')
@cache.cached()
def music():
    items = published_filter(MusicItem.query).order_by(MusicItem.date_posted.desc()).all()
    return render_template('music.html', items=items)


@media_bp.route('/new_music_item', methods=['GET', 'POST'])
@login_required
def new_music_item():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None
        item_type = request.form['item_type']
        artist = request.form.get('artist')
        album_title = request.form.get('album_title')
        spotify_link = request.form.get('spotify_link')
        youtube_link = request.form.get('youtube_link')
        image_file = request.files.get('image')

        music_item = MusicItem(
            title=title, content=content, type='music_item', project_id=project_id,
            item_type=item_type, artist=artist, album_title=album_title,
            spotify_link=spotify_link or None, youtube_link=youtube_link or None
        )
        db.session.add(music_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            photo = handle_image_upload(image_file, description=f"Cover for {title}")
            if photo:
                music_item.photo_id = photo.id

        db.session.commit()
        invalidate_content_caches('music_item')
        flash('Music item added!', 'success')
        return redirect(url_for('music'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_music_item.html', projects=projects)

@media_bp.route('/edit_music_item/<int:item_id>', methods=['GET', 'POST'])
@login_required
def edit_music_item(item_id):
    item = MusicItem.query.get_or_404(item_id)

    if request.method == 'POST':
        item.title = request.form['title']
        item.content = request.form.get('content', '')
        item.project_id = request.form.get('project_id') or None
        item.item_type = request.form['item_type']
        item.artist = request.form.get('artist', '').strip() or None
        item.album_title = request.form.get('album_title', '').strip() or None
        item.spotify_link = request.form.get('spotify_link', '').strip() or None
        item.youtube_link = request.form.get('youtube_link', '').strip() or None

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(item, image_file, description=f"Cover for {item.title}")

        db.session.commit()
        invalidate_content_caches('music_item')
        flash('Music item updated!', 'success')
        return redirect(url_for('post', post_id=item.id))

    projects = Project.query.order_by(Project.title).all()
    return render_template('edit_music_item.html', item=item, projects=projects)


# ──────────────────────────────────────────────
#  Videos
# ──────────────────────────────────────────────

@media_bp.route('/videos')
@cache.cached()
def videos():
    video_items = published_filter(Video.query).order_by(Video.date_posted.desc()).all()
    return render_template('videos.html', videos=video_items)


@media_bp.route('/new_video_item', methods=['GET', 'POST'])
@login_required
def new_video_item():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None
        video_url = request.form.get('video_url')
        embed_code = request.form.get('embed_code')
        source_type = request.form.get('source_type')
        duration = request.form.get('duration')
        image_file = request.files.get('image')

        video_item = Video(
            title=title, content=content, type='video', project_id=project_id,
            video_url=video_url or None, embed_code=embed_code or None,
            source_type=source_type or None, duration=duration or None
        )
        db.session.add(video_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            photo = handle_image_upload(image_file, description=f"Thumbnail for {title}")
            if photo:
                video_item.photo_id = photo.id

        db.session.commit()
        invalidate_content_caches('video')
        flash('Video item added!', 'success')
        return redirect(url_for('videos'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_video_item.html', projects=projects)

@media_bp.route('/edit_video_item/<int:item_id>', methods=['GET', 'POST'])
@login_required
def edit_video_item(item_id):
    item = Video.query.get_or_404(item_id)

    if request.method == 'POST':
        item.title = request.form['title']
        item.content = request.form.get('content', '')
        item.project_id = request.form.get('project_id') or None
        item.video_url = request.form.get('video_url', '').strip() or None
        item.embed_code = request.form.get('embed_code', '').strip() or None
        item.source_type = request.form.get('source_type', '').strip() or None
        item.duration = request.form.get('duration', '').strip() or None

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(item, image_file, description=f"Thumbnail for {item.title}")

        db.session.commit()
        invalidate_content_caches('video')
        flash('Video updated!', 'success')
        return redirect(url_for('post', post_id=item.id))

    projects = Project.query.order_by(Project.title).all()
    return render_template('edit_video_item.html', item=item, projects=projects)

# ──────────────────────────────────────────────
#  Reviews
# ──────────────────────────────────────────────

@media_bp.route('/reviews')
@cache.cached()
def reviews():
    review_items = published_filter(Review.query).order_by(Review.date_posted.desc()).all()
    return render_template('reviews.html', reviews=review_items)


@media_bp.route('/new_review', methods=['GET', 'POST'])
@login_required
def new_review():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None
        item_title = request.form['item_title']
        category = request.form['category']
        rating = request.form.get('rating') if request.form.get('rating') else None
        year_released_str = request.form.get('year_released')
        year_released = int(year_released_str) if year_released_str and year_released_str.isdigit() else None
        director_author = request.form.get('director_author')
        item_link = request.form.get('item_link')
        image_file = request.files.get('image')

        review_item = Review(
            title=title, content=content, type='review', project_id=project_id,
            item_title=item_title, category=category, rating=rating,
            year_released=year_released, director_author=director_author or None,
            item_link=item_link or None
        )
        db.session.add(review_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            photo = handle_image_upload(image_file, description=f"Cover for {item_title}")
            if photo:
                review_item.photo_id = photo.id

        db.session.commit()
        invalidate_content_caches('review')
        flash('Review added!', 'success')
        return redirect(url_for('reviews'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_review.html', projects=projects)


@media_bp.route('/edit_review/<int:item_id>', methods=['GET', 'POST'])
@login_required
def edit_review(item_id):
    item = Review.query.get_or_404(item_id)

    if request.method == 'POST':
        item.title = request.form['title']
        item.content = request.form.get('content', '')
        item.project_id = request.form.get('project_id') or None
        item.item_title = request.form['item_title']
        item.category = request.form['category']
        item.rating = request.form.get('rating', '').strip() or None
        year_released_str = request.form.get('year_released', '')
        item.year_released = int(year_released_str) if year_released_str and year_released_str.isdigit() else None
        item.director_author = request.form.get('director_author', '').strip() or None
        item.item_link = request.form.get('item_link', '').strip() or None

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(item, image_file, description=f"Cover for {item.item_title}")

        db.session.commit()
        invalidate_content_caches('review')
        flash('Review updated!', 'success')
        return redirect(url_for('post', post_id=item.id))

    projects = Project.query.order_by(Project.title).all()
    return render_template('edit_review.html', item=item, projects=projects)
