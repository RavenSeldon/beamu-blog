import os
import sys
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from flask_wtf.csrf import CSRFProtect, CSRFError, generate_csrf
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from wtforms.validators import none_of
from forms import LoginForm
from sqlalchemy import MetaData
import sqlalchemy as sa
import sqlalchemy.orm as so
from typing import Optional
import markdown
import bleach
import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException
from markupsafe import Markup
from flask_mail import Mail, Message
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from pathlib import Path
from utils.image_utils import process_upload_image, get_srcset, USING_SPACES, SPACES_URL, IMAGE_SIZES
from utils.minify_utils import asset_url
from utils.s3_utils import delete_file, delete_files, upload_file, get_bucket, get_s3_resource


app = Flask(__name__)
app.config.from_pyfile('config.py')

app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
csrf = CSRFProtect(app)

# Define allowed HTML tags and attributes for Bleach
ALLOWED_TAGS = [
    'p', 'br', 'strong', 'em', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'blockquote', 'code', 'pre'
]

ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height', 'style']
}

naming_convention = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
}

try:
    from dotenv import load_dotenv
    # Look for .env file in various locations
    env_paths = [
        Path('.') / '.env', # Current directory
        Path('..') / '.env', # Parent directory
        Path('/etc/neurascape') / '.env', # System config directory
    ]

    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)
            break

except ImportError:
    # python-dotenv not installed, continue without it
    pass

# Custom Jinja filter
@app.template_filter('markdown_safe')
def markdown_safe_filter(text):
    """
    Converts Markdown text to sanitized HTML.
    """
    # Convert Markdown to HTML
    html_content = markdown.markdown(text, extensions=['fenced_code', 'tables', 'codehilite']) # Enable extensions if desired

    # Sanitize the HTML
    safe_html = bleach.clean(
        html_content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True # Remove disallowed tags entirely
    )
    # Wrap in Markup to tell Jinja it's safe
    return Markup(safe_html)

db = SQLAlchemy(app, metadata=MetaData(naming_convention=naming_convention))
mail = Mail(app)
migrate = Migrate(app, db, render_as_batch=True) #keep batch mode for SQLite

# Setup Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'images')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


# Models
class User(UserMixin, db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    username: so.Mapped[str] = so.mapped_column(sa.String(64), unique=True, nullable=False)
    password_hash: so.Mapped[str] = so.mapped_column(sa.String(256), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Photo(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    filename: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False, unique=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(510), nullable=True)

    posts: so.Mapped[list["Post"]] = so.relationship("Post", back_populates="photo", foreign_keys="Post.image_filename")
    projects: so.Mapped[list["Project"]] = so.relationship("Project", back_populates="photo", foreign_keys="Project.image_filename")


class Project(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(db.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(index=True, default=lambda: datetime.now(timezone.utc))
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.ForeignKey(Photo.filename, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[image_filename], back_populates="projects", innerjoin=False)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)
    posts: so.Mapped[list["Post"]] = so.relationship("Post", back_populates="project", cascade="all, delete-orphan")


class Post(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    content: so.Mapped[str] = so.mapped_column(db.Text, nullable=False)
    date_posted: so.Mapped[datetime] = so.mapped_column(index=True, default=lambda: datetime.now(timezone.utc))
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.ForeignKey(Photo.filename, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[image_filename], back_populates="posts", innerjoin=False)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)
    project_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey(Project.id, name="fk_post_project"), nullable=True, index=True)
    project: so.Mapped[Optional["Project"]] = so.relationship("Project", back_populates="posts")

# Helper Functions
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# Create admin user
def create_admin_user():
    # Check if admin user already exists
    admin = User.query.filter_by(username='beamu').first()
    if not admin:
        admin = User(username='beamu')
        # Set password from environment variable or use default (not recommended for production)
        admin_password = os.environ.get('ADMIN_PASSWORD')
        admin.set_password(admin_password)
        db.session.add(admin)
        db.session.commit()
        print("Admin user created. Please change the default password!")


# Context Processor
@app.context_processor
def inject_now():
    return {'datetime': datetime, 'timezone': timezone, 'current_user': current_user}

@app.context_processor
def inject_csrf_token():
    token = generate_csrf()
    return dict(csrf_token=token)

@app.context_processor
def optimization_utils():
    return dict(
        asset_url=asset_url,
        get_srcset=get_srcset,
        USING_SPACES=USING_SPACES,
        SPACES_URL=SPACES_URL
    )

@app.shell_context_processor
def make_shell_context():
    return {"sa": sa, "so": so, "db": db, "Project": Project, "Post": Post, "User": User}

# Cookie Handling
@app.before_request
def make_session_permanent():
    session.permanent = True

# Routes
@app.route('/loading')
def loading():
    return render_template('loading.html')


@app.route('/')
def index():
    posts = Post.query.order_by(Post.date_posted.desc()).all()
    return render_template('index.html', posts=posts)


@app.route('/login', methods=['GET', 'POST'])
def login():
    # If user is already authenticated, redirect to home
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    form = LoginForm()

    #Force regeneration of CSRF token for the form
    if request.method == 'GET':
        # Generate a fresh token
        form.csrf_token.data = generate_csrf()

    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember.data)
            flash('Welcome, Ben.')
            return redirect(request.args.get('next') or url_for('index'))
        flash('Invalid credentials', 'error')

    return render_template('login.html', form=form)


@app.route('/logout')
def logout():
    logout_user()
    flash('You have been logged out successfully!', 'success')
    return redirect(url_for('index'))


@app.route('/about')
def about():
    return render_template('about.html')


@app.route('/photo_album')
def photo_album():
    photos = Photo.query.all()
    return render_template('photo_album.html', photos=photos)


@app.route('/projects')
def projects():
    projects = Project.query.all()
    return render_template('projects.html', projects=projects)


@app.route('/post/<int:post_id>')
def post(post_id):
    post = Post.query.get_or_404(post_id)
    return render_template('post.html', post=post)

@app.route('/project/<int:project_id>')
def project_detail(project_id):
    project = Project.query.get_or_404(project_id)
    return render_template('project_detail.html', project=project)


@app.route('/new_post', methods=['GET', 'POST'])
@login_required
def new_post():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form['content'][:20000]
        github_link = request.form.get('github_link', '')
        project_id = request.form.get('project_id')
        image = request.files.get('image')
        image_filename = None
        photo = None

        # Create the post first without the image
        post = Post(
            title=title,
            content=content,
            github_link=github_link if github_link else None,
            project_id=project_id if project_id else None
        )
        db.session.add(post)
        db.session.flush()  # This gives post an ID

        # Process image if provided
        if image and allowed_file(image.filename):
            # Generate a unique filename to prevent collisions
            base_name, ext = os.path.splitext(secure_filename(image.filename))
            unique_filename = f"{uuid4().hex}{ext.lower()}"

            # Process and optimize the image
            image_paths = process_upload_image(image, app.config['UPLOAD_FOLDER'], unique_filename)

            if image_paths:
                # Check if a photo with this filename already exists
                existing_photo = Photo.query.filter_by(filename=unique_filename).first()

                if not existing_photo:
                    # Create new photo record
                    photo = Photo(filename=unique_filename, description=title)
                    db.session.add(photo)
                    db.session.flush()  # This gives photo an ID
                else:
                    # Use existing photo
                    photo = existing_photo
                    app.logger.info(f"Using existing photo with ID {photo.id}")

                # Now establish the relationship between post and photo
                post.image_filename = unique_filename
                post.photo = photo

                # Debug info
                app.logger.info(f"Associated post ID {post.id} with photo ID {photo.id}")

        # Commit all changes at once
        db.session.commit()

        # Optionally refresh to verify
        db.session.refresh(post)
        if photo:
            db.session.refresh(photo)
            app.logger.info(f"After commit: Post image_filename = {post.image_filename}")
            app.logger.info(f"After commit: Photo posts count = {len(photo.posts)}")

        flash('Post created!', 'success')
        return redirect(url_for('index'))

    # For GET request
    projects = Project.query.all()
    return render_template('new_post.html', projects=projects)

@app.route('/new_project', methods=['GET', 'POST'])
@login_required
def new_project():
    if request.method == 'POST':
        title = request.form['title'].strip()
        description = request.form.get('description', '').strip()

        # Validate essential fields
        if not title:
            flash('Project title is required!', 'error')
            return redirect(url_for('new_project'))
        if not description:
            flash('Project description is required!', 'error')
            return redirect(url_for('new_project'))

        github_link = request.form.get('github_link', '').strip() or None
        image_file = request.files.get('image')

        if image_file and allowed_file(image_file.filename):
            # Generate a unique filename
            ext = os.path.splitext(secure_filename(image_file.filename))[1].lower()
            unique_filename = f"{uuid4().hex}{ext}"

            # Process and optimize the image
            image_paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)

            if image_paths:
                # Create the project first
                project = Project(
                    title=title,
                    description=description or None,
                    github_link=github_link,
                )
                db.session.add(project)
                db.session.flush()  # This assigns an ID to the project

                # Now create and associate the photo
                photo = Photo(filename=unique_filename, description=title)
                db.session.add(photo)
                db.session.flush()  # This assigns an ID to the photo

                # Set the relationship in both directions
                project.image_filename = unique_filename
                project.photo = photo

                # Add the project to the photo's projects list
                if project not in photo.projects:
                    photo.projects.append(project)

                # Debug info
                app.logger.info(f"Created photo with ID {photo.id} and filename {photo.filename}")
                app.logger.info(f"Associated with project ID {project.id}")

                db.session.commit()

                # Double-check the association after commit
                db.session.refresh(project)
                db.session.refresh(photo)
                app.logger.info(f"After commit: Project image_filename = {project.image_filename}")
                app.logger.info(f"After commit: Photo projects count = {len(photo.projects)}")
        else:
            # No image, just create the project
            project = Project(
                title=title,
                description=description or None,
                github_link=github_link,
            )
            db.session.add(project)
            db.session.commit()

        flash('Project created!', 'success')
        return redirect(url_for('projects'))

    return render_template('new_project.html')

@app.route('/new_photo', methods=['GET', 'POST'])
@login_required
def new_photo():
    if request.method == 'POST':
        photo_file = request.files.get('image')
        description = request.form.get('description', '').strip()

        if photo_file and allowed_file(photo_file.filename):
            # Generate unique filename
            ext = os.path.splitext(secure_filename(photo_file.filename))[1].lower()
            unique_filename = f"{uuid4().hex}{ext}"

            #Process and optimize the image
            image_paths = process_upload_image(photo_file, app.config['UPLOAD_FOLDER'], unique_filename)

            if image_paths:
                # Check if a photo with this file name already exists
                existing_photo = Photo.query.filter_by(filename=unique_filename).first()

                if not existing_photo:
                    # Create new photo record
                    photo = Photo(filename=unique_filename, description=description)
                    db.session.add(photo)
                    db.session.flush()

            db.session.commit()

            flash('Photo uploaded!', 'success')
            return redirect(url_for('new_photo'))

        else:
            flash(f'Error, photo required to be uploaded!', 'error')
            return redirect(url_for('new_photo'))

    return render_template('new_photo.html')

@app.route('/delete_post/<int:post_id>', methods=['POST'])
@login_required
def delete_post(post_id):
    post = Post.query.get_or_404(post_id)

    db.session.delete(post)
    db.session.commit()

    flash('Post deleted successfully', 'success')
    return redirect(url_for('index'))

@app.route('/delete_project/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)

    db.session.delete(project)
    db.session.commit()

    flash('Project deleted successfully', 'success')
    return redirect(url_for('projects'))

@app.route('/delete_photo/<int:photo_id>', methods=['POST'])
@login_required
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)

    filename = photo.filename

    # Delete the actual image files from storage
    try:
        if USING_SPACES:
            # Collect paths for all image sizes
            paths_to_delete = [f"{size}/{filename}" for size in IMAGE_SIZES]

            # Batch delete all image sizes
            delete_files(paths_to_delete)

        else:
            # Delete from local filesystem
            for size in IMAGE_SIZES:
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], size, filename)
                if os.path.exists(file_path):
                    os.remove(file_path)

    except Exception as e:
        flash(f'Error deleting image files: {str(e)}', 'error')

    db.session.delete(photo)
    db.session.commit()

    flash('Photo deleted successfully', 'success')
    return redirect(url_for('photo_album'))


@app.route('/contact', methods=['GET', 'POST'])
def contact():
    if request.method == 'POST':
        try:
            #Get form data
            name = request.form['name']
            email = request.form['email']
            message = request.form['message']

            app.logger.info(f"Processing contact form from {email}")

            # Configure API key authorization
            configuration = sib_api_v3_sdk.Configuration()
            configuration.api_key['api-key'] = os.environ.get('BREVO_API_KEY')

            # Create an API instance
            api_instance = sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(configuration))

            # Format the message with some basic HTML
            html_content = f"""
            <p><strong>Contact Form Submission</strong></p>
            <p><strong>From:</strong> {name} &lt;{email}&gt;</p>
            <p><strong>Message:</strong></p>
            <p>{message}</p>
            """
            #Create the email object
            sender = {"name": "Neurascape Transmission", "email": "faust@benamuwo.me"}
            to = [{"email": "faust@benamuwo.me", "name": "Ben's Neurascape"}]
            reply_to = {"email": email, "name": name}

            send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
                to=to,
                html_content=html_content,
                sender=sender,
                reply_to=reply_to,
                subject=f"Pending Neurascape Transmission: {name}"
            )

            # Send the email
            api_response = api_instance.send_transac_email(send_smtp_email)
            app.logger.info(f"Email sent successfully via API. Message ID: {api_response.message_id}")
            flash('Your message has been sent. We\'ll get back to you soon.', 'success')

        except ApiException as e:
            app.logger.error(f"API exception: {e}")
            flash('Sorry, there was a problem sending your message. Please try again later.', 'error')
        except Exception as e:
            app.logger.error(f"Unexpected error: {str(e)}")
            flash('Sorry, there was a problem processing your request.', 'error')

        return redirect(url_for('contact'))

    return render_template('contact.html')


@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404

@app.errorhandler(500)
def site_error(e):
    return render_template('500.html'), 500

@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    flash('The form has expired. Please try again.', 'error')
    # Log the error for debugging
    app.logger.warning(f"CSRF Error: {str(e)} on {request.path} from {request.remote_addr}")

    # Return to log in or contact with a fresh form
    if request.path == '/login':
        return redirect(url_for('login'))
    elif request.path == '/contact':
        return redirect(url_for('contact'))

    # For other forms, redirect back to the same page.
    return redirect(request.full_path)


@app.route('/admin/check-image-files')
@login_required
def check_image_files():
    """Check if all image files exist in the expected locations"""
    if not current_user.is_authenticated:
        flash('You must be logged in to access this page', 'error')
        return redirect(url_for('login'))

    # Get all photos from the database
    photos = Photo.query.all()

    if not photos:
        flash('No photos found in the database', 'info')
        return redirect(url_for('photo_album'))

    results = []

    for photo in photos:
        photo_result = {
            'id': photo.id,
            'filename': photo.filename,
            'sizes': {}
        }

        # Check each size
        for size in IMAGE_SIZES:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], size, photo.filename)
            photo_result['sizes'][size] = {
                'path': file_path,
                'exists': os.path.exists(file_path)
            }

        results.append(photo_result)

    # Return a simple HTML page with the results
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Image Files Check</title>
        <style>
            body { font-family: sans-serif; padding: 20px; background: #050518; color: #e0e6f0; }
            .results { margin-top: 20px; }
            .photo { margin-bottom: 20px; padding: 15px; background: rgba(20, 20, 50, 0.75); border-radius: 10px; }
            .status { display: inline-block; width: 15px; height: 15px; border-radius: 50%; margin-right: 5px; }
            .exists { background: #4CAF50; }
            .missing { background: #F44336; }
            h1, h2, h3 { color: #C4B5E2; }
            .return { margin-top: 20px; display: inline-block; padding: 10px 15px; background: #37B4F8; color: #000; text-decoration: none; border-radius: 5px; }
        </style>
    </head>
    <body>
        <h1>Image Files Check</h1>
        <p>Checking image files for all photos in the database.</p>

        <div class="results">
    """

    all_exists = True

    for result in results:
        html += f"""
        <div class="photo">
            <h3>Photo ID: {result['id']}</h3>
            <p>Filename: {result['filename']}</p>
            <ul>
        """

        for size, info in result['sizes'].items():
            status_class = "exists" if info['exists'] else "missing"
            status_text = "Exists" if info['exists'] else "Missing"

            if not info['exists']:
                all_exists = False

            html += f"""
            <li>
                <span class="status {status_class}"></span>
                {size}: {status_text} (Path: {info['path']})
            </li>
            """

        html += """
            </ul>
        </div>
        """

    overall_status = "All image files exist" if all_exists else "Some image files are missing"

    html += f"""
        <h2>Summary: {overall_status}</h2>
        <a href="{url_for('photo_album')}" class="return">Return to Photo Album</a>
    </body>
    </html>
    """

    return html

@app.route('/api/posts')
def api_posts():
    page = int(request.args.get('page', 1))
    per_page = 10
    posts = Post.query.order_by(Post.date_posted.desc()).paginate(page=page, per_page=per_page, error_out=False)
    data = []
    for post in posts.items:
        data.append({
            'id': post.id,
            'title': post.title,
            'content': post.content[:300] + ('...' if len(post.content) > 300 else ''),
            'date_posted': post.date_posted.strftime('%Y-%m-%d'),
            'image_filename': post.image_filename,
            'github_link': post.github_link
        })
    return {'posts': data, 'has_next': posts.has_next}

# API endpoint for image optimization info
@app.route('/api/image-info/<path:filename>')
def image_info(filename):
    """Return responsive image information for a given filename"""
    if not filename:
        return jsonify({'error': 'No filename provided'}), 400

    # Verify file exists
    if not os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], 'medium', filename)):
        return jsonify({'error': 'Image not found'}), 404

    return jsonify({
        'filename': filename,
        'srcset': get_srcset(filename),
        'sizes': '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 800px'
    })


