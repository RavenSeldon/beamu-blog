import os
import sys
import logging
from io import BytesIO
from PIL import Image, ImageDraw
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
from sqlalchemy.exc import OperationalError
from typing import Optional
import markdown
import bleach
import time
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

# Use project directory for logs
log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'debug.log')

# Set up logging
file_handler = logging.FileHandler(log_path)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)

app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)
app.logger.info(f"Flask application startup - logs going to {log_path}")

# Custom Jinja filter
@app.template_filter('markdown_safe')
def markdown_safe_filter(text):
    """
    Converts Markdown text to sanitized HTML.
    """
    if not text:
        return Markup('')
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
Base = db.Model

class User(UserMixin, Base):
    __tablename__ = "user"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    username: so.Mapped[str] = so.mapped_column(sa.String(64), unique=True, nullable=False)
    password_hash: so.Mapped[str] = so.mapped_column(sa.String(256), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Photo(Base):
    __tablename__ = "photos"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    filename: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False, unique=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(512), nullable=True)

    # Back-references: Posts/Projects that use this Photo as their primary image
    linked_posts: so.Mapped[list["Post"]] = so.relationship("Post", foreign_keys="Post.photo_id", back_populates="photo")
    linked_projects: so.Mapped[list["Project"]] = so.relationship("Project", foreign_keys="Project.photo_id", back_populates="photo")



class Project(Base):
    __tablename__ = "projects"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(sa.DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc))
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)

    photo_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("photos.id", name=naming_convention["fk"] % {"table_name": "projects", "column_0_name": "photo_id", "referred_table_name": "photos"}, ondelete="SET NULL"), nullable=True, index=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[photo_id], back_populates="linked_projects", innerjoin=False)
    items: so.Mapped[list["Post"]] = so.relationship("Post", back_populates="project", cascade="all, delete-orphan")


class Post(Base):
    # Base post model (polymorphic). Subclasses: MusicItem, Video, Review.
    __tablename__ = "posts"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    type: so.Mapped[str] = so.mapped_column(sa.String(50), index=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    content: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(sa.DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc))
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)

    photo_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("photos.id", name=naming_convention["fk"] % {"table_name": "posts", "column_0_name": "photo_id", "referred_table_name": "photos"}, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", back_populates="linked_posts", foreign_keys=[photo_id], innerjoin=False)

    project_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("projects.id", name=naming_convention["fk"] % {"table_name": "posts", "column_0_name": "project_id", "referred_table_name": "projects"}, ondelete="SET NULL"), nullable=True, index=True)
    project: so.Mapped[Optional["Project"]] = so.relationship("Project", back_populates="items", foreign_keys=[project_id])

    __mapper_args__ = {
        "polymorphic_on": type,
        "polymorphic_identity": "post",
        "with_polymorphic": "*",
    }


class MusicItem(Post):
    # A music specific post.
    __tablename__ = "music_items"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "music_items", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)
    item_type: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False, index=True)
    artist: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    album_title: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    spotify_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    youtube_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)

    __mapper_args__ = {"polymorphic_identity": "music_item"}


class Video(Post):
    # A video-specific post with URL/embed and duration data.
    __tablename__ = "videos"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "videos", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)

    video_url: so.Mapped[Optional[str]] = so.mapped_column(sa.String(512), nullable=True)
    embed_code: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    source_type: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), index=True, nullable=True)
    duration: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)

    __mapper_args__ = {"polymorphic_identity": "video"}


class Review(Post):
    # A review-specific post.
    __tablename__ = "reviews"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "reviews", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)
    item_title: so.Mapped[str] = so.mapped_column(sa.String(256), nullable=False)
    category: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False, index=True)
    rating: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    year_released: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer, nullable=True)
    director_author: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    item_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)

    __mapper_args__ = {"polymorphic_identity": "review"}

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
        app.logger.info("Admin user 'beamu' created/ensured.")
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
    return {
        "sa": sa, "so": so, "db": db, "Project": Project, "Post": Post, "User": User,
        "MusicItem" : MusicItem, "Video": Video, "Review": Review
    }

# Cookie Handling
@app.before_request
def make_session_permanent():
    session.permanent = True

# Database retries
def retry_database_operation(func, *args, **kwargs):
    max_retries = 3
    retry_delay = 1

    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except OperationalError as e:
            if attempt == max_retries -1:
                raise
            time.sleep(retry_delay)
            retry_delay *= 2
            db.session.rollback()

# Routes
@app.route('/loading')
def loading():
    return render_template('loading.html')


@app.route('/')
def index():
    try:
        posts = retry_database_operation(lambda: Post.query.order_by(Post.date_posted.desc()).all())
        return render_template('index.html', posts=posts)
    except OperationalError as e:
        app.logger.error(f"Database connection error: {str(e)}")
        flash('Database connection issue. Please try again in a moment.', 'error')
        return render_template('index.html', posts=[])

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
    try:
        # Get projects with the newest first
        projects_list = Project.query.order_by(Project.date_posted.desc()).all()
        app.logger.info(f"Retrieved {len(projects_list)} projects")

        # Debug information about each project
        for project in projects_list:
            app.logger.info(f"Project ID: {project.id}, Title: {project.title}, Image: {project.photo_id}")

        return render_template('projects.html', projects=projects_list)
    except Exception as e:
        app.logger.error(f"Error retrieving projects: {str(e)}")
        flash(f'Error loading projects: {str(e)}', 'error')
        return render_template('projects.html', projects=[])

@app.route('/post/<int:post_id>')
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

@app.route('/project/<int:project_id>')
def project_detail(project_id):
    project = db.session.get(Project, project_id)
    if not project:
        return redirect(url_for('page_not_found_error', path=f'project/{project_id}'))
    return render_template('project_detail.html', project=project)


@app.route('/new_post', methods=['GET', 'POST'])
@login_required
def new_post():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form['content'][:20000]
        github_link = request.form.get('github_link', '')
        project_id = request.form.get('project_id')
        image_file = request.files.get('image')
        photo = None

        # Create the post first without the image
        post = Post(
            title=title,
            content=content,
            github_link=github_link if github_link else None,
            project_id=project_id if project_id else None,
            type='post'
        )
        db.session.add(post)
        db.session.flush()  # This gives post an ID

        # Process image if provided
        if image_file and allowed_file(image_file.filename):
            # Generate a unique filename to prevent collisions
            base_name, ext = os.path.splitext(secure_filename(image_file.filename))
            unique_filename = f"{uuid4().hex}{ext.lower()}"

            # Process and optimize the image
            image_paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)
            app.logger.info(f"Photo successfully processed {unique_filename}")

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
                post.photo_id = photo.id
                post.photo = photo

                # Debug info
                app.logger.info(f"Associated post ID {post.id} with photo ID {photo.id}")

        # Commit all changes at once
        db.session.commit()

        # Optionally refresh to verify
        db.session.refresh(post)
        if photo:
            db.session.refresh(photo)
            app.logger.info(f"After commit: Post Photo_id = {post.photo_id}")
            app.logger.info(f"After commit: Photo posts count = {len(photo.linked_posts)}")

        flash('Post created!', 'success')
        return redirect(url_for('index'))

    # For GET request
    projects = Project.query.order_by(Project.title).all()
    return render_template('new_post.html', projects=projects)

@app.route('/new_project', methods=['GET', 'POST'])
@login_required
def new_project():
    if request.method == 'POST':
        app.logger.info("Processing new project submission")
        title = request.form['title'].strip()
        description = request.form.get('description', '').strip()
        github_link = request.form.get('github_link', '').strip() or None
        image_file = request.files.get('image')
        photo = None

        # Validate essential fields
        if not title or not description:
            flash('Project title and description are required!', 'error')
            return redirect(url_for('new_project'))

        # Start a database transaction
        try:
            # Create the project
            project = Project(
                title=title,
                description=description,
                github_link=github_link or None
            )
            db.session.add(project)
            db.session.flush()


            if image_file and allowed_file(image_file.filename):
                app.logger.info(f"Processing image for project: {title}")

                # Generate a unique filename
                base_name, ext = os.path.splitext(secure_filename(image_file.filename))
                unique_filename = f"{uuid4().hex}{ext.lower()}"

                app.logger.info(f"Processing image: {unique_filename}")

                # Process and optimize the image
                image_paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)

                if image_paths:
                    app.logger.info(f"Image processed successfully: {unique_filename}")
                    existing_photo = Photo.query.filter_by(filename=unique_filename).first()

                    if not existing_photo:
                        # Now create and associate the photo
                        photo = Photo(filename=unique_filename, description=f"Cover for {title}")
                        db.session.add(photo)
                        db.session.flush()  # This assigns an ID to the photo
                    else:
                        photo = existing_photo

                    # Set the relationship in both directions
                    project.photo_id = photo.id
                    project.photo = photo

                # Debug info
                app.logger.info(f"Created photo with ID {photo.id} and filename {photo.filename}")
                app.logger.info(f"Associated with project ID {project.id}")

            db.session.commit()

            # Double-check the association after commit
            db.session.refresh(project)
            if photo:
                db.session.refresh(photo)
            app.logger.info(f"After commit: Project photo_id = {project.photo_id}")
            app.logger.info(f"After commit: Photo projects count = {len(photo.linked_projects)}")

            flash('Project created!', 'success')
            return redirect(url_for('projects'))

        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Error creating project: {str(e)}")
            flash(f'Error creating project: {str(e)}', 'error')
            return redirect(url_for('new_project'))

    return render_template('new_project.html')

@app.route('/new_photo', methods=['GET', 'POST'])
@login_required
def new_photo():
    if request.method == 'POST':
        app.logger.info("Processing new photo submission")
        photo_file = request.files.get('image')
        description = request.form.get('description', '').strip()

        if not photo_file or not allowed_file(photo_file.filename):
            flash("No photo submitted!", "error")
            return redirect(url_for('new_photo'))

        ext = os.path.splitext(secure_filename(photo_file.filename))[1].lower()
        unique_filename = f"{uuid4().hex}{ext}"

        #Process and optimize the image
        image_paths = process_upload_image(photo_file, app.config['UPLOAD_FOLDER'], unique_filename)

        if image_paths:
            # Check if a photo with this file name already exists
            existing_photo = Photo.query.filter_by(filename=unique_filename).first()

            if not existing_photo:
                # Create new photo record
                photo = Photo(filename=unique_filename,
                              description=description or None
                              )
                db.session.add(photo)
                db.session.flush()

            else:
                flash("Photo already exists. Change the name!", "error")
                return redirect(url_for('new_photo'))

        db.session.commit()

        flash('Photo uploaded!', 'success')
        return redirect(url_for('new_photo'))

    # For the GET request
    projects = Project.query.order_by(Project.title).all()
    posts = Post.query.order_by(Post.title).all()
    return render_template('new_photo.html', posts=posts, projects=projects)

@app.route('/music')
def music():
    items = MusicItem.query.order_by(MusicItem.date_posted.desc()).all()
    return render_template('music.html', items=items)

@app.route('/new_music_item', methods=['GET', 'POST'])
@login_required
def new_music_item():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None

        # MusicItem specific fields
        item_type = request.form['item_type']
        artist = request.form.get('artist')
        album_title = request.form.get('album_title')
        spotify_link = request.form.get('spotify_link')
        youtube_link = request.form.get('youtube_link')

        image_file = request.files.get('image')
        photo = None

        music_item = MusicItem(
            title=title,
            content=content,
            type='music_item',
            project_id=project_id,
            item_type=item_type,
            artist=artist,
            album_title=album_title,
            spotify_link=spotify_link or None,
            youtube_link=youtube_link or None
        )
        db.session.add(music_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            base, ext = os.path.splitext(secure_filename(image_file.filename))
            unique_filename = f"{uuid4().hex}{ext.lower()}"
            paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)
            if paths:
                photo = Photo.query.filter_by(filename=unique_filename).first()
                if not photo:
                    photo = Photo(filename=unique_filename, description=f"Cover for {title}")
                    db.session.add(photo)
                    db.session.flush()
                music_item.photo_id = photo.id

        db.session.commit()
        flash('Music item added!', 'success')
        return redirect(url_for('music'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_music_item.html', projects=projects)


@app.route('/videos')
def videos():
    video_items = Video.query.order_by(Video.date_posted.desc()).all()
    return render_template('videos.html', videos=video_items)

@app.route('/new_video_item', methods=['GET', 'POST'])
@login_required
def new_video_item():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content', '')
        project_id = request.form.get('project_id') if request.form.get('project_id') else None

        # Video Specific entries
        video_url = request.form.get('video_url')
        embed_code = request.form.get('embed_code')
        source_type = request.form.get('source_type')
        duration = request.form.get('duration')

        image_file = request.files.get('image')
        photo = None

        video_item = Video(
            title=title,
            content=content,
            type='video',
            project_id=project_id,
            video_url=video_url or None,
            embed_code=embed_code or None,
            source_type=source_type or None,
            duration=duration or None
        )
        db.session.add(video_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            base, ext = os.path.splitext(secure_filename(image_file.filename))
            unique_filename = f"{uuid4().hex}{ext.lower()}"
            paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)
            if paths:
                photo = Photo.query.filter_by(filename=unique_filename).first()
                if not photo:
                    photo = Photo(filename=unique_filename, description=f"Thumbnail for {title}")
                    db.session.add(photo)
                    db.session.flush()
                video_item.photo_id = photo.id

        db.session.commit()
        flash('Video item added!', 'success')
        return redirect(url_for('videos'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_video_item.html', projects=projects)

@app.route('/reviews')
def reviews():
    review_items = Review.query.order_by(Review.date_posted.desc()).all()
    return render_template('reviews.html', reviews=review_items)

@app.route('/new_review', methods=['GET', 'POST'])
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
        photo = None

        review_item = Review(
            title=title,
            content=content,
            type='review',
            project_id=project_id,
            item_title=item_title,
            category=category,
            rating=rating,
            year_released=year_released,
            director_author=director_author or None,
            item_link=item_link or None
        )
        db.session.add(review_item)
        db.session.flush()

        if image_file and allowed_file(image_file.filename):
            base, ext = os.path.splitext(secure_filename(image_file.filename))
            unique_filename = f"{uuid4().hex}{ext.lower()}"
            paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)
            if paths:
                photo = Photo.query.filter_by(filename=unique_filename).first()
                if not photo:
                    photo = Photo(filename=unique_filename, description=f"Cover for{item_title}")
                    db.session.add(photo)
                    db.session.flush()
                review_item.photo_id = photo.id

        db.session.commit()
        flash('Review added!', 'success')
        return redirect(url_for('reviews'))

    projects = Project.query.order_by(Project.title).all()
    return render_template('new_review.html', projects=projects )



@app.route('/delete_post/<int:post_id>', methods=['POST'])
@login_required
def delete_post(post_id):
    post = Post.query.get_or_404(post_id)

    if not post:
        flash('Post not found.', 'error')
        return redirect(url_for('index'))

    db.session.delete(post)
    db.session.commit()

    flash(f'{post.type.capitalize()} deleted successfully', 'success')
    return redirect(url_for('index'))

@app.route('/delete_project/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if not project:
        flash('Project not found.', 'error')
        return redirect(url_for('projects'))

    db.session.delete(project)
    db.session.commit()

    flash('Project and all associated items deleted successfully', 'success')
    return redirect(url_for('projects'))

@app.route('/delete_photo/<int:photo_id>', methods=['POST'])
@login_required
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)
    if not photo:
        flash('Photo not found.', 'error')
        return redirect(url_for('photo_album'))

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
    app.logger.warning(f"404 Not Found: {request.path}")
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_server_error(e):
    app.logger.error(f'500 Internal Server Error.: {request.path} - {str(e)}')
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

@app.route('/check-spaces', methods=['GET'])
@login_required
def check_spaces():
    """Debug endpoint to test Digital Ocean Spaces configuration"""
    try:
        output = ["<h2>Digital Ocean Spaces Check</h2>"]

        # Check environment variables
        output.append("<h3>Environment Variables</h3>")
        output.append(f"USING_SPACES: {USING_SPACES}")
        output.append(f"DO_SPACE_KEY exists: {bool(os.environ.get('DO_SPACE_KEY'))}")
        output.append(f"DO_SPACE_SECRET exists: {bool(os.environ.get('DO_SPACE_SECRET'))}")
        output.append(f"DO_SPACE_NAME exists: {bool(os.environ.get('DO_SPACE_NAME'))}")
        output.append(f"DO_SPACE_REGION exists: {bool(os.environ.get('DO_SPACE_REGION'))}")

        if USING_SPACES:
            output.append(f"SPACES_URL: {SPACES_URL}")

        # Try to create S3 resource
        output.append("<h3>S3 Resource</h3>")
        s3 = get_s3_resource()
        if s3:
            output.append("✓ S3 resource created successfully")
        else:
            output.append("✗ Failed to create S3 resource")

        # Try to get bucket
        output.append("<h3>S3 Bucket</h3>")
        bucket = get_bucket()
        if bucket:
            output.append(f"✓ Bucket retrieved: {bucket.name}")

            # Try listing objects
            try:
                objects = list(bucket.objects.limit(5))
                output.append(f"✓ Listed {len(objects)} objects from bucket")
                if objects:
                    output.append("<ul>")
                    for obj in objects:
                        output.append(f"<li>{obj.key}</li>")
                    output.append("</ul>")
            except Exception as list_error:
                output.append(f"✗ Error listing objects: {str(list_error)}")

            # Test direct upload
            output.append("<h3>Test Upload</h3>")
            try:
                # Create a simple test file
                test_data = BytesIO(b"This is a test file created at " + str(time.time()).encode())
                test_path = f"test/test_file_{int(time.time())}.txt"

                # Try uploading
                output.append(f"Attempting to upload test file to: {test_path}")
                upload_file(test_data, test_path, content_type="text/plain")

                output.append(f"✓ Test upload appears successful")
                output.append(f"Test file URL would be: {SPACES_URL}/{test_path}")

                # Check if it's accessible
                import requests
                test_url = f"{SPACES_URL}/{test_path}"
                resp = requests.head(test_url)
                if resp.status_code == 200:
                    output.append(f"✓ Test file accessible at: <a href='{test_url}' target='_blank'>{test_url}</a>")
                else:
                    output.append(f"✗ Test file not accessible (status code: {resp.status_code})")

            except Exception as upload_error:
                output.append(f"✗ Error during test upload: {str(upload_error)}")
                import traceback
                output.append("<pre>" + traceback.format_exc() + "</pre>")
        else:
            output.append("✗ Failed to get bucket")

        return "<br>".join(output)
    except Exception as e:
        import traceback
        return f"Error: {str(e)}<br><pre>{traceback.format_exc()}</pre>"

@app.route('/test-image-upload')
@login_required
def test_image_upload():
    # Test endpoint that does a real image upload and processing
    try:
        results = []
        results.append("<h1>Image Processing Test</h1>")

        # Create a test image
        img = Image.new('RGB', (800, 600), color = 'red')

        # Draw something on it
        draw = ImageDraw.Draw(img)
        draw.rectangle(((200, 200), (600, 400)), fill="blue")
        draw.text((300, 300), f"Test {time.time()}", fill="white")

        # Save to BytesIO
        img_io = BytesIO()
        img.save(img_io, 'JPEG')
        img_io.seek(0)

        # Create a test filename
        test_filename = f"test_image_{int(time.time())}.jpeg"
        results.append(f"Test image created: {test_filename}")

        # Log the upload folder
        upload_folder = app.config['UPLOAD_FOLDER']
        results.append(f"Upload folder: {upload_folder}")
        results.append(f"Upload folder exists: {os.path.exists(upload_folder)}")

        # Process the image like in a real upload
        results.append("<h2>Starting Image Processing</h2>")

        # Create a file-like object from BytesIO
        from werkzeug.datastructures import FileStorage
        test_file = FileStorage(
            stream=img_io,
            filename=test_filename,
            content_type='image/jpeg',
        )

        # Process the image:
        results.append("Calling process_upload_image...")
        image_paths = process_upload_image(test_file, upload_folder, test_filename)

        results.append(f"Result from process_upload_image: {image_paths}")

        if image_paths:
            results.append("<h2>Image Processing Successful</h2>")
            results.append("<ul>")
            for size, path in image_paths.items():
                if USING_SPACES:
                    url = f"{SPACES_URL}/{path}"
                    results.append(f"<li>{size}: <a href='{url}' target='_blank'>{url}</a></li>")
                else:
                    results.append(f"<li>{size}: {path}</li>")
            results.append("</ul>")
        else:
            results.append("<h2>Image Processing Failed</h2>")

        # Check debug log
        if os.path.exists('/tmp/flask_debug.log'):
            results.append("<h2>Debug Log Contents</h2>")
            with open('/tmp/flask_debug.log', 'r') as f:
                log_content = f.read()
            results.append(f"<pre>{log_content}</pre>")

        return "<br>".join(results)


    except Exception as e:
        import traceback
        return f"Error during test: {str(e)}<br><pre>{traceback.format_exc()}</pre>"

@app.route('/test-logging')
def test_logging():
    app.logger.debug("This is a debug message")
    app.logger.info("This is an info message")
    app.logger.warning("This is a warning message")
    app.logger.error("This is an error message")
    print("This is a print statement")
    return "Log messages generated. Check your logs."

@app.route('/api/posts')
def api_posts():
    page = int(request.args.get('page', 1))
    per_page = 10

    query = Post.query.order_by(Post.date_posted.desc())
    posts_pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    serialized_posts = []
    for post_item in posts_pagination.items:
        item_data = {
            'id': post_item.id,
            'type': post_item.type,
            'title': post_item.title,
            'content': (post_item.content or '')[:300] + ('...' if post_item.content and len(post_item.content) > 300 else ''),
            'date_posted': post_item.date_posted.strftime('%Y-%m-%d'),
            'photo_filename': post_item.photo.filename if post_item.photo else None,
            'github_link': post_item.github_link,
            'project_id' : post_item.project_id,
            'project_title': post_item.project.title if post_item.project else None
        }
        # Add type-specific fields
        if post_item.type == 'music_item':
            item_data.update({
                'item_type': post_item.item_type,
                'artist': post_item.artist,
                'album_title': post_item.album_title,
                'spotify_link': post_item.spotify_link,
                'youtube_link': post_item.youtube_link,
            })
        elif post_item.type == 'video':
            item_data.update({
                'video_url': post_item.video_url,
                'embed_code': post_item.embed_code,
                'source_type': post_item.source_type,
                'duration': post_item.duration,
            })
        elif post_item.type == 'review':
            item_data.update({
                'item_title': post_item.item_title,
                'category': post_item.category,
                'rating': post_item.rating,
                'year_released': post_item.year_released,
                'director_author': post_item.director_author,
                'item_link': post_item.item_link,
            })
        serialized_posts.append(item_data)

    return jsonify({
        'posts': serialized_posts,
        'has_next': posts_pagination.has_next,
        'current_page': posts_pagination.page,
        'total_pages': posts_pagination.pages
    })


# API endpoint for image optimization info
@app.route('/api/image-info/<int:photo_id>')
def image_info(photo_id):
    """Return responsive image information for a given filename"""
    photo = db.session.get(Photo, photo_id)
    if not photo:
        return jsonify({'error': 'No file found'}), 404

    return jsonify({
        'photo_id': photo.id,
        'filename': photo.filename,
        'description': photo.description,
        'srcset': get_srcset(photo.filename),
        'sizes': '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 800px'
    })


