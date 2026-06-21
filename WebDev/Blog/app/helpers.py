"""
Shared helpers, constants, and template utilities for the Neurascape application.
"""
import os
import re
import json
import time
import base64
from io import BytesIO
from datetime import datetime, timezone
import markdown
import bleach
from markupsafe import Markup
from bs4 import BeautifulSoup, NavigableString, Comment
from sqlalchemy.exc import OperationalError
from werkzeug.utils import secure_filename
from uuid import uuid4
from flask import current_app, render_template

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

# --- Gallery / inline-image constants ---
# A stable, per-image token placed in the Markdown body to position a gallery image.
GALLERY_KEY_RE = re.compile(r'^[A-Za-z0-9_-]{1,16}$')
GALLERY_BODY_TOKEN_RE = re.compile(r'\[\[img:([A-Za-z0-9_-]{1,16})\]\]')
INLINE_IMAGE_TOKEN_TEXT_RE = re.compile(r'\s*\[\[img:[A-Za-z0-9_-]{1,16}\]\]\s*')
GALLERY_RENDER_TOKEN_RE = re.compile(r'<p>\s*\[\[img:([A-Za-z0-9_-]{1,16})\]\]\s*</p>')
# V1 supports block images only: token must be alone on its own Markdown line.
GALLERY_BLOCK_TOKEN_RE = re.compile(r'(?m)^\s*\[\[img:([A-Za-z0-9_-]{1,16})\]\]\s*$')
GALLERY_ALLOWED_ALIGNMENTS = {'left', 'right', 'center', 'full'}
MAX_GALLERY_IMAGES = 30
MAX_GALLERY_CAPTION_LEN = 512
MAX_GALLERY_ALT_LEN = 512


class GalleryValidationError(Exception):
    """Raised when a submitted gallery manifest fails validation.

    Carries a human-readable message suitable for flashing back to the admin.
    """
    pass


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
    lqip_data = generate_lqip_for(unique_filename)

    photo = Photo(filename=unique_filename, description=description or None, lqip=lqip_data)
    db.session.add(photo)
    db.session.flush()
    return photo


def generate_lqip_for(filename):
    """Generate a base64 LQIP (Low-Quality Image Placeholder) data URI for an image.

    Reads the already-processed 'medium' size tier for the given filename and
    returns a tiny inlined JPEG data URI, or None if the medium file is missing or
    generation fails. Shared by handle_image_upload() (new uploads) and edit_photo
    (in-place file replacement) so both always produce a fresh LQIP.
    """
    from PIL import Image

    try:
        medium_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'medium', filename)
        if not os.path.exists(medium_path):
            return None
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
        current_app.logger.info(f"LQIP generated for {filename} ({len(lqip_data)} chars)")
        return lqip_data
    except Exception as e:
        current_app.logger.warning(f"LQIP generation failed for {filename}: {e}")
        return None


def _delete_image_files(filename):
    """Delete every size-tier variant (original + WebP) for a filename from storage.

    Works on the local filesystem or DigitalOcean Spaces depending on config.
    Errors are logged, not raised — cleanup failures must not abort the caller.
    """
    from app.utils.image_utils import USING_SPACES, IMAGE_SIZES
    from app.utils.s3_utils import delete_files

    name_no_ext = os.path.splitext(filename)[0]
    try:
        if USING_SPACES:
            paths = []
            for size in IMAGE_SIZES:
                paths.append(f"{size}/{filename}")
                paths.append(f"{size}/{name_no_ext}.webp")
            delete_files(paths)
        else:
            for size in IMAGE_SIZES:
                for fname in (filename, f"{name_no_ext}.webp"):
                    path = os.path.join(current_app.config['UPLOAD_FOLDER'], size, fname)
                    if os.path.exists(path):
                        os.remove(path)
    except Exception as e:
        current_app.logger.warning(f"Failed to delete image files for {filename}: {e}")


def _delete_photo_files(photo):
    """Delete the underlying image files for a Photo (all size tiers + WebP)."""
    if photo and photo.filename:
        _delete_image_files(photo.filename)


def delete_photo_if_unreferenced(photo):
    """Delete a Photo's row and files only if nothing else references it.

    This is the ONLY sanctioned way to delete a Photo. It counts every reference
    that could keep the image alive — feature links (Post.photo_id, Project.photo_id)
    and gallery links (PostImage, ProjectImage) — and deletes only at a count of zero.

    The caller is responsible for first detaching the specific reference being
    removed (e.g. reassigning item.photo, or deleting the PostImage row). A flush
    is issued here so the counts reflect current session state, which means a Photo
    used twice by the same item (feature + inline) is correctly retained.

    Returns True if the Photo was deleted, False if it is still referenced.
    """
    from app.models import Post, Project, PostImage, ProjectImage

    if not photo:
        return False

    # Persist any pending reference changes so the counts below are accurate.
    db.session.flush()

    references = (
        db.session.query(Post).filter(Post.photo_id == photo.id).count()
        + db.session.query(Project).filter(Project.photo_id == photo.id).count()
        + db.session.query(PostImage).filter(PostImage.photo_id == photo.id).count()
        + db.session.query(ProjectImage).filter(ProjectImage.photo_id == photo.id).count()
    )
    if references > 0:
        return False

    _delete_photo_files(photo)
    db.session.delete(photo)
    return True


def replace_item_image(item, image_file, description=None):
    """Replace an item's feature image, cleaning up the old one if now orphaned.

    Works with any model that has a photo_id / photo relationship (Post and its
    subclasses, Project). The previous Photo's row and files are removed only if
    nothing else references it, via delete_photo_if_unreferenced() — so an old
    feature image that is still embedded inline (or used elsewhere) is preserved.
    """
    old_photo = item.photo
    new_photo = handle_image_upload(image_file, description=description)
    if not new_photo:
        return None

    item.photo_id = new_photo.id
    item.photo = new_photo

    if old_photo is not None and old_photo.id != new_photo.id:
        # Flush the feature-image reassignment before counting remaining references.
        db.session.flush()
        delete_photo_if_unreferenced(old_photo)

    return new_photo


def validate_gallery_manifest(item, content, manifest_raw, files):
    """Validate and normalize a submitted gallery manifest for create or edit.

    The manifest is a JSON object mapping each image's stable key to its metadata.
    Each entry declares kind="new" (a fresh upload, file under gallery_<key>) or
    kind="existing" (an already-attached image, referenced by its row id).

    Args:
        item: the Post/Project being created or edited. Its .images collection is
              used to confirm that "existing" entries actually belong to this item
              (on create the collection is empty, so any "existing" entry fails).
        content: the Markdown body, cross-checked so every [[img:KEY]] token has a
                 matching manifest entry.
        manifest_raw: the raw JSON string (request.form.get('gallery_manifest')).
        files: request.files (a MultiDict) for verifying uploads.

    Returns:
        dict {key: {kind, caption, alt_text, alignment, position, [image_id]}} with
        types coerced, text stripped and length-capped.

    Raises:
        GalleryValidationError with a human-readable message on any violation.
    """
    if not manifest_raw or not manifest_raw.strip():
        manifest = {}
    else:
        try:
            manifest = json.loads(manifest_raw)
        except (ValueError, TypeError):
            raise GalleryValidationError("Gallery data is not valid JSON.")

    if not isinstance(manifest, dict):
        raise GalleryValidationError("Gallery data must be a JSON object.")
    if len(manifest) > MAX_GALLERY_IMAGES:
        raise GalleryValidationError(
            f"Too many gallery images ({len(manifest)}). Maximum is {MAX_GALLERY_IMAGES}."
        )

    existing_ids = {img.id for img in getattr(item, 'images', [])}
    all_body_keys = set(GALLERY_BODY_TOKEN_RE.findall(content or ''))
    block_body_keys = set(GALLERY_BLOCK_TOKEN_RE.findall(content or ''))
    inline_only = all_body_keys - block_body_keys
    if inline_only:
        raise GalleryValidationError(
            "Image tokens must be on their own line: " + ", ".join(sorted(inline_only))
        )
    body_keys = block_body_keys
    normalized = {}
    seen_existing_ids = set()

    for key, meta in manifest.items():
        if not GALLERY_KEY_RE.match(key or ''):
            raise GalleryValidationError(f"Invalid image key: {key!r}.")
        if not isinstance(meta, dict):
            raise GalleryValidationError(f"Malformed entry for image {key!r}.")

        kind = meta.get('kind')
        if kind not in ('new', 'existing'):
            raise GalleryValidationError(f"Image {key!r} has an invalid kind: {kind!r}.")

        alignment = meta.get('alignment', 'center')
        if alignment not in GALLERY_ALLOWED_ALIGNMENTS:
            raise GalleryValidationError(f"Image {key!r} has an invalid alignment: {alignment!r}.")

        try:
            position = int(meta.get('position', 0))
        except (ValueError, TypeError):
            raise GalleryValidationError(f"Image {key!r} has a non-integer position.")

        caption = (meta.get('caption') or '').strip() or None
        if caption and len(caption) > MAX_GALLERY_CAPTION_LEN:
            raise GalleryValidationError(f"Caption for image {key!r} exceeds {MAX_GALLERY_CAPTION_LEN} characters.")

        alt_text = (meta.get('alt_text') or '').strip() or None
        if alt_text and len(alt_text) > MAX_GALLERY_ALT_LEN:
            raise GalleryValidationError(f"Alt text for image {key!r} exceeds {MAX_GALLERY_ALT_LEN} characters.")

        entry = {
            'kind': kind,
            'caption': caption,
            'alt_text': alt_text,
            'alignment': alignment,
            'position': position,
        }

        if kind == 'new':
            upload = files.get(f'gallery_{key}')
            if upload is None or not upload.filename:
                raise GalleryValidationError(f"Image {key!r} is marked new but has no uploaded file.")
            if not allowed_file(upload.filename):
                raise GalleryValidationError(f"Image {key!r} has an unsupported file type.")
        else:  # existing
            raw_image_id = (
                meta.get('image_id')
                or meta.get('post_image_id')
                or meta.get('project_image_id')
                or meta.get('association_id')
            )
            try:
                image_id = int(raw_image_id)
            except (ValueError, TypeError):
                raise GalleryValidationError(f"Image {key!r} is marked existing but has no valid id.")
            if image_id not in existing_ids:
                raise GalleryValidationError(f"Image {key!r} does not belong to this item.")
            if image_id in seen_existing_ids:
                raise GalleryValidationError(f"Image row {image_id} is listed more than once.")
            seen_existing_ids.add(image_id)
            entry['image_id'] = image_id

        normalized[key] = entry

    # Every uploaded gallery_<key> file must correspond to a "new" manifest entry.
    for field in files:
        if field.startswith('gallery_'):
            file_key = field[len('gallery_'):]
            if file_key not in normalized or normalized[file_key]['kind'] != 'new':
                raise GalleryValidationError(f"Uploaded file {field!r} has no matching new-image entry.")

    # Every [[img:KEY]] token in the body must resolve to a manifest entry.
    missing = body_keys - set(normalized.keys())
    if missing:
        raise GalleryValidationError(
            "These image tokens in the body have no matching image: " + ", ".join(sorted(missing))
        )

    return normalized

def _gallery_items_by_key(item):
    """Return this item's inline gallery rows keyed by placeholder_key."""
    images = getattr(item, "images", None) or []
    return {image.placeholder_key: image for image in images}


def _body_text_for_render(item):
    """Return the Markdown-bearing body field for a Post-like item or Project."""
    if hasattr(item, "content"):
        return item.content or ""
    if hasattr(item, "description"):
        return item.description or ""
    return ""


def render_body(item):
    """
    Render Markdown content/description and expand block gallery tokens.

    Supported v1 token form:

        [[img:abc123]]

    The token must be alone in its Markdown paragraph. Inline token placement is
    intentionally not supported.
    """
    body = _body_text_for_render(item)
    # Guarantee each block token sits in its own Markdown paragraph. Without this,
    # two tokens on adjacent lines collapse into one <p>...two tokens...</p>, which
    # the per-<p> render regex below cannot match, so neither image expands even
    # though validation (which checks per line) accepted them.
    body = GALLERY_BLOCK_TOKEN_RE.sub(lambda m: "\n\n" + m.group(0).strip() + "\n\n", body)
    html = str(markdown_safe(body))

    images_by_key = _gallery_items_by_key(item)

    def replace_token(match):
        key = match.group(1)
        gallery_item = images_by_key.get(key)
        if not gallery_item or not gallery_item.photo or not gallery_item.photo.filename:
            return ""

        return render_template(
            "_gallery_figure.html",
            gallery_item=gallery_item,
        )

    return Markup(GALLERY_RENDER_TOKEN_RE.sub(replace_token, html))

def _has_gallery_submission(form, files):
    """Return True only when the admin actually submitted gallery data.

    A submission is recognized by the hidden gallery_manifest field (always present
    when _image_studio.html is on the form) or any gallery_<KEY> file upload. When
    neither is present the request came from a surface without the Image Studio, so
    its absence must not be read as "delete every existing inline image" on edit.
    """
    return 'gallery_manifest' in form or any(field.startswith('gallery_') for field in files)


def _item_body_for_gallery(item):
    """Return the Markdown-ish field that may contain [[img:KEY]] tokens."""
    if hasattr(item, 'content'):
        return item.content or ''
    return getattr(item, 'description', '') or ''

def strip_gallery_tokens(text):
    """Remove inline image placeholder tokens from raw Markdown/excerpt text.

    Use this BEFORE markdown_safe() on previews, cards, and meta descriptions.
    render_body() should still be used for full detail pages.
    """
    if not text:
        return ""

    cleaned = INLINE_IMAGE_TOKEN_TEXT_RE.sub(" ", str(text))
    return re.sub(r'\s{2,}', ' ', cleaned).strip()

def strip_gallery_tokens_preserve_blocks(text):
    """Remove inline image placeholder tokens while preserving Markdown block structure.

    Unlike strip_gallery_tokens(), this intentionally preserves newlines/blank lines so
    blockquotes, lists, and paragraphs keep their original boundaries before markdown_safe()
    renders them.
    """
    if not text:
        return ""

    cleaned = str(text)

    # Remove block image tokens that appear alone on their own line.
    cleaned = GALLERY_BLOCK_TOKEN_RE.sub("", cleaned)
    # Remove any remaining inline image tokens defensively.
    cleaned = GALLERY_BODY_TOKEN_RE.sub("", cleaned)
    # Normalize horizontal whitespace only. Do not collapse newlines.
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    # Avoid giant blank gaps left by removed gallery tokens, while preserving
    # paragraph boundaries.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def truncate_html(html, length=250, ellipsis="…"):
    """Truncate sanitized HTML by visible text length while preserving valid HTML.
    This expects HTML that has already gone through markdown_safe()/Bleach.
    It counts only visible text, not tags, and removes nodes after the cutoff.

    """
    if html is None:
        return Markup("")

    try:
        length = int(length)

    except (TypeError, ValueError):
        length = 250

    if length <= 0:
        return Markup("")

    soup = BeautifulSoup(str(html), "html.parser")
    remaining = length
    truncated = False

    def walk(node):
        nonlocal remaining, truncated
        for child in list(getattr(node, "contents", [])):

            if isinstance(child, Comment):
                child.extract()
                continue

            if truncated:
                child.extract()
                continue

            if isinstance(child, NavigableString):
                text = str(child)
                if len(text) <= remaining:
                    remaining -= len(text)
                    continue

                cut = text[:remaining].rstrip()
                child.replace_with(cut + ellipsis)
                remaining = 0
                truncated = True
                continue
            walk(child)
    walk(soup)

    # Return only the fragment contents, not an artificial <html>/<body> wrapper.
    return Markup("".join(str(child) for child in soup.contents))

def post_excerpt(item, length=250):
    """Single source of truth for card/list excerpts.
    Pipeline:
    - choose content/description body
    - strip inline-gallery tokens
    - render Markdown safely
    - truncate sanitized HTML without breaking block-level markup
    """
    source = strip_gallery_tokens_preserve_blocks(_item_body_for_gallery(item) or "")

    if not source:
        return Markup("")
    rendered = markdown_safe(source)
    return truncate_html(rendered, length=length)

def sync_inline_images(item, form, files, association_cls):
    """Create/update/delete inline image association rows for a Post or Project.

    The submitted manifest is the source of truth only when gallery data is
    actually present in the form. This preserves existing rows when old templates
    submit normal edits without gallery_manifest.

    association_cls should be PostImage for Post/Post subclasses and ProjectImage
    for Project.
    """
    if not _has_gallery_submission(form, files):
        # Hardening guard: if the body carries [[img:KEY]] tokens but no gallery
        # payload was submitted, fail loudly instead of silently persisting orphan
        # tokens. Otherwise such tokens render as nothing and later trip edit-mode
        # validation with a confusing "no matching image" error.
        orphan_keys = set(GALLERY_BODY_TOKEN_RE.findall(_item_body_for_gallery(item)))
        if orphan_keys:
            raise GalleryValidationError(
                "These image tokens in the body have no matching image: "
                + ", ".join(sorted(orphan_keys))
            )
        return

    normalized = validate_gallery_manifest(
        item=item,
        content=_item_body_for_gallery(item),
        manifest_raw=form.get('gallery_manifest', '{}'),
        files=files,
    )

    current_by_id = {img.id: img for img in getattr(item, 'images', []) if img.id is not None}
    # Track kept associations by OBJECT IDENTITY, not primary key. A new row gets a
    # pk the instant any mid-loop flush runs (a later image's handle_image_upload, or
    # delete_photo_if_unreferenced's internal flush). A pk-based keep-set therefore
    # lets the removal loop below mistake freshly-created rows for ones the user
    # dropped, silently deleting every inline image on any multi-image submit.
    keep_assocs = set()

    for key, meta in normalized.items():
        if meta['kind'] == 'existing':
            assoc = current_by_id[meta['image_id']]
        else:
            upload = files.get(f'gallery_{key}')
            photo = handle_image_upload(upload, description=meta.get('caption') or meta.get('alt_text'))
            if not photo:
                raise GalleryValidationError(f"Image {key!r} could not be processed.")
            assoc = association_cls(photo=photo)
            item.images.append(assoc)

        assoc.placeholder_key = key
        assoc.caption = meta.get('caption')
        assoc.alt_text = meta.get('alt_text')
        assoc.alignment = meta.get('alignment', 'center')
        assoc.position = meta.get('position', 0)
        keep_assocs.add(assoc)

    # Remove only the associations the manifest actually dropped. Identity membership
    # keeps newly-created rows safe even once they have been flushed.
    for assoc in list(getattr(item, 'images', [])):
        if assoc not in keep_assocs:
            old_photo = assoc.photo
            item.images.remove(assoc)
            db.session.flush()
            delete_photo_if_unreferenced(old_photo)


def sync_post_images(post, form, files):
    """Sync inline/gallery images for Post and all Post subclasses."""
    from app.models import PostImage
    sync_inline_images(post, form, files, PostImage)


def sync_project_images(project, form, files):
    """Sync inline/gallery images for Project."""
    from app.models import ProjectImage
    sync_inline_images(project, form, files, ProjectImage)

