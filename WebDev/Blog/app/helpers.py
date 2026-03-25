"""
Shared helpers, constants, and template utilities for the Neurascape application.
"""
import os
import time
import base64
from io import BytesIO
from datetime import datetime, timezone
import markdown
import bleach
from markupsafe import Markup
from sqlalchemy.exc import OperationalError
from werkzeug.utils import secure_filename
from uuid import uuid4
from flask import current_app

from app.extensions import db, cache

# Allowed HTML tags and attributes for Bleach sanitization
ALLOWED_TAGS = [
    'p', 'br', 'strong', 'em', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'blockquote', 'code', 'pre'
]

ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height', 'style']
}

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

# Maximum upload file size (10 MB)
MAX_UPLOAD_SIZE = 10 * 1024 * 1024

# Spotify SDK constants
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1"
VISITOR_SPOTIFY_SCOPES = (
    "streaming user-read-email user-read-private "
    "user-read-playback-state user-modify-playback-state "
    "user-read-currently-playing"
)


def allowed_file(filename):
    """Check if a filename has an allowed image extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def markdown_safe(text):
    """Convert Markdown text to sanitized HTML."""
    if not text:
        return Markup('')
    html_content = markdown.markdown(
        text, extensions=['fenced_code', 'tables', 'codehilite']
    )
    safe_html = bleach.clean(
        html_content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True
    )
    return Markup(safe_html)


def retry_database_operation(func, *args, **kwargs):
    """Retry a database operation with exponential backoff."""
    max_retries = 3
    retry_delay = 1

    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except OperationalError:
            if attempt == max_retries - 1:
                raise
            time.sleep(retry_delay)
            retry_delay *= 2
            db.session.rollback()


def invalidate_content_caches(content_type=None):
    """Clear all cached page data after any content change."""
    cache.clear()


def published_filter(query):
    """Filter a Post query to exclude scheduled (future) posts.

    Posts with published_at=NULL are treated as immediately published.
    Posts with published_at in the future are hidden from all list pages.
    (Admins can view scheduled posts individually or via the admin dashboard.)
    """
    from app.models import Post

    now = datetime.now(timezone.utc)
    return query.filter(
        db.or_(Post.published_at.is_(None), Post.published_at <= now)
    )


def sync_tags(post, tag_string):
    """Parse a comma-separated tag string and sync with the post's tags.

    Creates new Tag records for any tags that don't exist yet.
    Clears tags if the string is empty.
    """
    from app.models import Tag

    if not tag_string or not tag_string.strip():
        post.tags = []
        return

    tag_names = [t.strip().lower() for t in tag_string.split(',') if t.strip()]
    tag_names = list(dict.fromkeys(tag_names))  # dedupe, preserve order

    tags = []
    for name in tag_names:
        tag = Tag.query.filter_by(name=name).first()
        if not tag:
            tag = Tag(name=name)
            db.session.add(tag)
            db.session.flush()
        tags.append(tag)

    post.tags = tags


def handle_image_upload(image_file, description=None):
    """Process an uploaded image and return a Photo object.

    Shared by both create and edit routes. Validates file size and dimensions,
    generates a unique filename, processes the image into size tiers, creates
    a Photo record, and flushes to the database (caller must commit).

    Args:
        image_file: The uploaded file from request.files
        description: Optional description for the Photo record

    Returns:
        Photo instance if successful, None if no valid file or processing failed
    """
    from flask import flash
    from PIL import Image
    from app.models import Photo
    from app.utils.image_utils import process_upload_image

    if not image_file or not allowed_file(image_file.filename):
        return None

    # --- File size validation (10 MB max) ---
    image_file.seek(0, os.SEEK_END)
    file_size = image_file.tell()
    image_file.seek(0)

    if file_size > MAX_UPLOAD_SIZE:
        size_mb = file_size / (1024 * 1024)
        flash(f'Image too large ({size_mb:.1f} MB). Maximum allowed is 10 MB.', 'error')
        current_app.logger.warning(f"Upload rejected: {file_size} bytes exceeds 10 MB limit")
        return None

    # --- Dimension check (warn if smaller than large tier) ---
    try:
        # Read bytes into a buffer so Image.open() doesn't consume the upload stream
        raw_bytes = image_file.read()
        image_file.seek(0)
        img_check = Image.open(BytesIO(raw_bytes))
        width, height = img_check.size
        img_check.close()

        if width < 1200 and height < 1200:
            flash(
                f'Heads up: this image is {width}×{height}px. '
                f'For best results, use images at least 1200px on one side.',
                'warning'
            )
            current_app.logger.info(f"Dimension warning: {width}x{height} < 1200px")
    except Exception as e:
        current_app.logger.warning(f"Could not check image dimensions: {e}")
        image_file.seek(0)

    # --- Process the image ---
    base_name, ext = os.path.splitext(secure_filename(image_file.filename))
    unique_filename = f"{uuid4().hex}{ext.lower()}"

    image_paths = process_upload_image(
        image_file, current_app.config['UPLOAD_FOLDER'], unique_filename
    )
    if not image_paths:
        current_app.logger.error(f"Failed to process image: {unique_filename}")
        return None

    current_app.logger.info(f"Image processed: {unique_filename}")

    existing = Photo.query.filter_by(filename=unique_filename).first()
    if existing:
        return existing

    # --- Generate LQIP (Low-Quality Image Placeholder) ---
    lqip_data = None
    try:
        medium_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'medium', unique_filename)
        if os.path.exists(medium_path):
            with Image.open(medium_path) as lqip_img:
                if lqip_img.mode == 'RGBA':
                    bg = Image.new('RGB', lqip_img.size, (255, 255, 255))
                    bg.paste(lqip_img, mask=lqip_img.split()[3])
                    lqip_img = bg
                elif lqip_img.mode != 'RGB':
                    lqip_img = lqip_img.convert('RGB')
                lqip_w = 20
                lqip_h = max(1, int(lqip_img.height * (lqip_w / lqip_img.width)))
                tiny = lqip_img.resize((lqip_w, lqip_h), Image.LANCZOS)
                buf = BytesIO()
                tiny.save(buf, format='JPEG', quality=30, optimize=True)
                b64 = base64.b64encode(buf.getvalue()).decode('ascii')
                lqip_data = f'data:image/jpeg;base64,{b64}'
            current_app.logger.info(f"LQIP generated for {unique_filename} ({len(lqip_data)} chars)")
    except Exception as e:
        current_app.logger.warning(f"LQIP generation failed for {unique_filename}: {e}")

    photo = Photo(filename=unique_filename, description=description or None, lqip=lqip_data)
    db.session.add(photo)
    db.session.flush()
    return photo


def replace_item_image(item, image_file, description=None):
    """Replace an item's image, cleaning up the old one if orphaned.

    Works with any model that has a photo_id / photo relationship.
    """
    from app.models import Photo
    from app.utils.image_utils import USING_SPACES, IMAGE_SIZES
    from app.utils.s3_utils import delete_files

    old_photo = item.photo
    new_photo = handle_image_upload(image_file, description=description)
    if not new_photo:
        return None

    item.photo_id = new_photo.id
    item.photo = new_photo

    # Clean up old photo if orphaned
    if old_photo and old_photo.id != new_photo.id:
        other_posts = [p for p in old_photo.linked_posts if p.id != item.id]
        other_projects = [p for p in old_photo.linked_projects if not hasattr(item, 'items') or p.id != item.id]
        if not other_posts and not other_projects:
            old_no_ext = os.path.splitext(old_photo.filename)[0]
            try:
                if USING_SPACES:
                    paths = []
                    for size in IMAGE_SIZES:
                        paths.append(f"{size}/{old_photo.filename}")
                        paths.append(f"{size}/{old_no_ext}.webp")
                    delete_files(paths)
                else:
                    for size in IMAGE_SIZES:
                        for fname in [old_photo.filename, f"{old_no_ext}.webp"]:
                            path = os.path.join(current_app.config['UPLOAD_FOLDER'], size, fname)
                            if os.path.exists(path):
                                os.remove(path)
            except Exception as e:
                current_app.logger.warning(f"Failed to delete old image files: {e}")
            db.session.delete(old_photo)

    return new_photo
