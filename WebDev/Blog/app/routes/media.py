"""Media routes: photos, music items, videos, reviews CRUD."""
import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required
from werkzeug.utils import secure_filename
from uuid import uuid4

from app.extensions import db, cache
from app.models import Photo, Post, Project, MusicItem, Video, Review
from app.helpers import allowed_file, invalidate_content_caches, handle_image_upload, replace_item_image, published_filter, delete_photo_if_unreferenced, generate_lqip_for, _delete_image_files, MAX_UPLOAD_SIZE, sync_post_images, GalleryValidationError
from app.utils.image_utils import process_upload_image

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

        # Optionally replace the underlying image file. We keep the SAME Photo row
        # (and id), so any feature-image or inline-gallery references to this photo
        # stay valid and simply point at the new image.
        image_file = request.files.get('image')
        if image_file and image_file.filename:
            if not allowed_file(image_file.filename):
                flash('Unsupported image file type. Please upload a PNG, JPG, JPEG, GIF, or WebP image.', 'error')
                return redirect(url_for('edit_photo', photo_id=photo.id))

            # Size guard, mirroring handle_image_upload (10 MB max).
            image_file.seek(0, os.SEEK_END)
            file_size = image_file.tell()
            image_file.seek(0)
            if file_size > MAX_UPLOAD_SIZE:
                flash(f'Image too large ({file_size / (1024 * 1024):.1f} MB). Maximum allowed is 10 MB.', 'error')
                return redirect(url_for('edit_photo', photo_id=photo.id))

            ext = os.path.splitext(secure_filename(image_file.filename))[1].lower()
            unique_filename = f"{uuid4().hex}{ext}"

            image_paths = process_upload_image(
                image_file, current_app.config['UPLOAD_FOLDER'], unique_filename
            )

            if not image_paths:
                flash('Could not process the new image; keeping the existing one.', 'error')
                return redirect(url_for('edit_photo', photo_id=photo.id))

            old_filename = photo.filename
            photo.filename = unique_filename
            # Regenerate the LQIP for the new image (previously left stale).
            photo.lqip = generate_lqip_for(unique_filename)
            # Remove the previous file's size-tier variants via the shared helper.
            _delete_image_files(old_filename)

        db.session.commit()
        invalidate_content_caches('photo')
        flash('Photo updated!', 'success')
        return redirect(url_for('photo_album'))

    return render_template('edit_photo.html', photo=photo)


@media_bp.route('/delete_photo/<int:photo_id>', methods=['POST'])
@login_required
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)

    # delete_photo_if_unreferenced is the only sanctioned Photo-deletion path: it
    # removes the row + files only when nothing still references this photo as a
    # feature image or inline gallery image (across posts and projects).
    deleted = delete_photo_if_unreferenced(photo)

    if deleted:
        db.session.commit()
        invalidate_content_caches('photo')
        flash('Photo deleted successfully', 'success')
    else:
        flash(
            'This photo is still in use by a post or project and was not deleted. '
            'Remove it from those items first.',
            'error'
        )
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
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None
        item_type = request.form.get('item_type', '').strip()
        if not title or not item_type:
            flash('Title and item type are required.', 'error')
            return redirect(url_for('new_music_item'))
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

        try:
            sync_post_images(music_item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('new_music_item'))

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
        title = request.form.get('title', '').strip()
        item_type = request.form.get('item_type', '').strip()
        if not title or not item_type:
            flash('Title and item type are required.', 'error')
            return redirect(url_for('edit_music_item', item_id=item.id))
        item.title = title
        item.content = request.form.get('content', '')
        item.project_id = request.form.get('project_id') or None
        item.item_type = item_type
        item.artist = request.form.get('artist', '').strip() or None
        item.album_title = request.form.get('album_title', '').strip() or None
        item.spotify_link = request.form.get('spotify_link', '').strip() or None
        item.youtube_link = request.form.get('youtube_link', '').strip() or None

        try:
            sync_post_images(item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('edit_music_item', item_id=item.id))

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

        try:
            sync_post_images(video_item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('new_video_item'))

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

        try:
            sync_post_images(item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('edit_video_item', item_id=item.id))

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
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None
        item_title = request.form.get('item_title', '').strip()
        category = request.form.get('category', '').strip()
        if not title or not item_title or not category:
            flash('Title, reviewed-item title, and category are all required.', 'error')
            return redirect(url_for('new_review'))
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

        try:
            sync_post_images(review_item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('new_review'))

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
        title = request.form.get('title', '').strip()
        item_title = request.form.get('item_title', '').strip()
        category = request.form.get('category', '').strip()
        if not title or not item_title or not category:
            flash('Title, reviewed-item title, and category are all required.', 'error')
            return redirect(url_for('edit_review', item_id=item.id))
        item.title = title
        item.content = request.form.get('content', '')
        item.project_id = request.form.get('project_id') or None
        item.item_title = item_title
        item.category = category
        item.rating = request.form.get('rating', '').strip() or None
        year_released_str = request.form.get('year_released', '')
        item.year_released = int(year_released_str) if year_released_str and year_released_str.isdigit() else None
        item.director_author = request.form.get('director_author', '').strip() or None
        item.item_link = request.form.get('item_link', '').strip() or None

        try:
            sync_post_images(item, request.form, request.files)
        except GalleryValidationError as e:
            db.session.rollback()
            flash(str(e), 'error')
            return redirect(url_for('edit_review', item_id=item.id))

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            replace_item_image(item, image_file, description=f"Cover for {item.item_title}")

        db.session.commit()
        invalidate_content_caches('review')
        flash('Review updated!', 'success')
        return redirect(url_for('post', post_id=item.id))

    projects = Project.query.order_by(Project.title).all()
    return render_template('edit_review.html', item=item, projects=projects)
