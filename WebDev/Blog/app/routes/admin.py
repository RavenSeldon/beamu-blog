"""Admin/debug routes (all login_required, gated in production)."""
import os
import time
from io import BytesIO
from PIL import Image, ImageDraw
from flask import Blueprint, render_template, url_for, redirect, flash, current_app
from flask_login import login_required, current_user

from app.extensions import db, cache
from app.models import User, Photo, Post, Project, MusicItem, Video, Review
from app.helpers import invalidate_content_caches
from app.utils.image_utils import process_upload_image, USING_SPACES, SPACES_URL, IMAGE_SIZES
from app.utils.s3_utils import get_s3_resource, get_bucket, upload_file

admin_bp = Blueprint('admin', __name__)

# ──────────────────────────────────────────────
#  Admin Dashboard
# ──────────────────────────────────────────────

@admin_bp.route('/admin')
@login_required
def admin_dashboard():
    """Admin dashboard with content counts, quick-create links, and recent content."""
    counts = {
        'posts': Post.query.filter_by(type='post').count(),
        'projects': Project.query.count(),
        'photos': Photo.query.count(),
        'music': MusicItem.query.count(),
        'videos': Video.query.count(),
        'reviews': Review.query.count(),
    }
    counts['total'] = sum(counts.values())

    recent_posts = Post.query.order_by(Post.date_posted.desc()).limit(10).all()
    recent_projects = Project.query.order_by(Project.date_posted.desc()).limit(5).all()

    return render_template('admin/dashboard.html',
                           counts=counts,
                           recent_posts=recent_posts,
                           recent_projects=recent_projects)


@admin_bp.route('/admin/clear-cache', methods=['POST'])
@login_required
def admin_clear_cache():
    """Manually invalidate all caches."""
    invalidate_content_caches()
    flash('All caches cleared.', 'success')
    return redirect(url_for('admin_dashboard'))


# ──────────────────────────────────────────────
#  Debug / Diagnostic Endpoints
# ──────────────────────────────────────────────

@admin_bp.route('/admin/check-image-files')
@login_required
def check_image_files():
    """Check if all image files exist in the expected locations."""
    photos = Photo.query.all()
    if not photos:
        from flask import flash, redirect
        flash('No photos found in the database', 'info')
        return redirect(url_for('photo_album'))

    results = []
    for photo in photos:
        photo_result = {'id': photo.id, 'filename': photo.filename, 'sizes': {}}
        for size in IMAGE_SIZES:
            file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], size, photo.filename)
            photo_result['sizes'][size] = {'path': file_path, 'exists': os.path.exists(file_path)}
        results.append(photo_result)

    html = """<!DOCTYPE html><html><head><title>Image Files Check</title>
    <style>body{font-family:sans-serif;padding:20px;background:#050518;color:#e0e6f0;}
    .photo{margin-bottom:20px;padding:15px;background:rgba(20,20,50,0.75);border-radius:10px;}
    .status{display:inline-block;width:15px;height:15px;border-radius:50%;margin-right:5px;}
    .exists{background:#4CAF50;}.missing{background:#F44336;}
    h1,h2,h3{color:#C4B5E2;}
    .return{margin-top:20px;display:inline-block;padding:10px 15px;background:#37B4F8;color:#000;text-decoration:none;border-radius:5px;}
    </style></head><body><h1>Image Files Check</h1><div class="results">"""

    all_exists = True
    for result in results:
        html += f'<div class="photo"><h3>Photo ID: {result["id"]}</h3><p>Filename: {result["filename"]}</p><ul>'
        for size, info in result['sizes'].items():
            status_class = "exists" if info['exists'] else "missing"
            status_text = "Exists" if info['exists'] else "Missing"
            if not info['exists']:
                all_exists = False
            html += f'<li><span class="status {status_class}"></span>{size}: {status_text} (Path: {info["path"]})</li>'
        html += '</ul></div>'

    overall = "All image files exist" if all_exists else "Some image files are missing"
    html += f'<h2>Summary: {overall}</h2><a href="{url_for("photo_album")}" class="return">Return to Photo Album</a></body></html>'
    return html


@admin_bp.route('/check-spaces', methods=['GET'])
@login_required
def check_spaces():
    """Debug endpoint to test DO Spaces configuration. Dev only."""
    if current_app.config.get('ENV') == 'production':
        return render_template('404.html'), 404

    try:
        output = ["<h2>Digital Ocean Spaces Check</h2>"]
        output.append(f"<h3>Environment Variables</h3>")
        output.append(f"USING_SPACES: {USING_SPACES}")
        output.append(f"DO_SPACE_KEY exists: {bool(os.environ.get('DO_SPACE_KEY'))}")
        output.append(f"DO_SPACE_SECRET exists: {bool(os.environ.get('DO_SPACE_SECRET'))}")
        output.append(f"DO_SPACE_NAME exists: {bool(os.environ.get('DO_SPACE_NAME'))}")
        output.append(f"DO_SPACE_REGION exists: {bool(os.environ.get('DO_SPACE_REGION'))}")
        if USING_SPACES:
            output.append(f"SPACES_URL: {SPACES_URL}")

        s3 = get_s3_resource()
        output.append(f"<h3>S3 Resource</h3>")
        output.append("S3 resource created" if s3 else "Failed to create S3 resource")

        bucket = get_bucket()
        if bucket:
            output.append(f"Bucket: {bucket.name}")
            try:
                objects = list(bucket.objects.limit(5))
                output.append(f"Listed {len(objects)} objects")
            except Exception as e:
                output.append(f"Error listing: {e}")

        return "<br>".join(output)
    except Exception as e:
        import traceback
        return f"Error: {str(e)}<br><pre>{traceback.format_exc()}</pre>"


@admin_bp.route('/test-image-upload')
@login_required
def test_image_upload():
    """Test endpoint for image upload processing. Dev only."""
    if current_app.config.get('ENV') == 'production':
        return render_template('404.html'), 404

    try:
        results = ["<h1>Image Processing Test</h1>"]
        img = Image.new('RGB', (800, 600), color='red')
        draw = ImageDraw.Draw(img)
        draw.rectangle(((200, 200), (600, 400)), fill="blue")
        draw.text((300, 300), f"Test {time.time()}", fill="white")

        img_io = BytesIO()
        img.save(img_io, 'JPEG')
        img_io.seek(0)

        test_filename = f"test_image_{int(time.time())}.jpeg"
        results.append(f"Test image created: {test_filename}")

        upload_folder = current_app.config['UPLOAD_FOLDER']
        from werkzeug.datastructures import FileStorage
        test_file = FileStorage(stream=img_io, filename=test_filename, content_type='image/jpeg')

        image_paths = process_upload_image(test_file, upload_folder, test_filename)
        results.append(f"Result: {image_paths}")

        if image_paths:
            results.append("<h2>Success</h2>")
            for size, path in image_paths.items():
                if USING_SPACES:
                    url = f"{SPACES_URL}/{path}"
                    results.append(f"<li>{size}: <a href='{url}'>{url}</a></li>")
                else:
                    results.append(f"<li>{size}: {path}</li>")
        else:
            results.append("<h2>Failed</h2>")

        return "<br>".join(results)
    except Exception as e:
        import traceback
        return f"Error: {str(e)}<br><pre>{traceback.format_exc()}</pre>"


@admin_bp.route('/test-logging')
@login_required
def test_logging():
    """Test endpoint for logging. Dev only."""
    if current_app.config.get('ENV') == 'production':
        return render_template('404.html'), 404
    current_app.logger.debug("This is a debug message")
    current_app.logger.info("This is an info message")
    current_app.logger.warning("This is a warning message")
    current_app.logger.error("This is an error message")
    print("This is a print statement")
    return "Log messages generated. Check your logs."

@admin_bp.route('/sdn')
def hello_world():
    1/0  # raises an error
    return "<p>Hello, World!</p>"