import os
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
from markupsafe import Markup
from flask_mail import Mail, Message
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from utils.image_utils import process_upload_image, get_srcset, USING_SPACES, SPACES_URL, IMAGE_SIZES
from utils.minify_utils import asset_url


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

    posts: so.Mapped[list["Post"]] = so.relationship("Post", primaryjoin="Post.image_filename == Photo.filename", viewonly=True)
    project: so.Mapped[list["Project"]] = so.relationship("Project", primaryjoin="Project.image_filename == Photo.filename", viewonly=True)


class Project(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(db.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(index=True, default=lambda: datetime.now(timezone.utc))
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.ForeignKey(Photo.filename, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[image_filename], innerjoin=False)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)
    posts: so.Mapped[list["Post"]] = so.relationship(back_populates="project", cascade="all, delete-orphan")


class Post(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    content: so.Mapped[str] = so.mapped_column(db.Text, nullable=False)
    date_posted: so.Mapped[datetime] = so.mapped_column(index=True, default=lambda: datetime.now(timezone.utc))
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.ForeignKey(Photo.filename, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[image_filename], innerjoin=False)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)
    project_id: so.Mapped[int] = so.mapped_column(sa.ForeignKey(Project.id, name="fk_post_project"), nullable=True, index=True)
    project: so.Mapped[Optional["Project"]] = so.relationship(back_populates="posts")

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


@app.route('/new_post', methods=['GET', 'POST'])
@login_required
def new_post():
    if request.method == 'POST':
        title = request.form['title']
        content = request.form['content'][:20000]
        github_link = request.form.get('github_link', '')
        image = request.files.get('image')
        image_filename = None

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
                    db.session.flush()
                # Store the original filename or the medium size in the database
                image_filename = unique_filename

        # Create the post with the optimized image information
        post = Post(
            title=title,
            content=content,
            image_filename=image_filename,
            github_link=github_link if github_link else None
        )

        db.session.add(post)
        db.session.commit()
        flash('Post created!', 'success')
        return redirect(url_for('index'))

    return render_template('new_post.html')

@app.route('/new_project', methods=['GET', 'POST'])
@login_required
def new_project():
    if request.method == 'POST':
        title = request.form['title'].strip()
        description = request.form.get('description', '').strip()
        github_link = request.form.get('github_link', '').strip() or None
        image_file = request.files.get('image')
        image_filename = None

        if image_file and allowed_file(image_file.filename):
            # Generate a unique filename
            ext = os.path.splitext(secure_filename(image_file.filename))[1].lower()
            unique_filename = f"{uuid4().hex}{ext}"

            # Process and optimize the image
            image_paths = process_upload_image(image_file, app.config['UPLOAD_FOLDER'], unique_filename)

            if image_paths:
                # Check if a photo with this filename already exists
                existing_photo = Photo.query.filter_by(filename=unique_filename).first()

                if not existing_photo:
                    # Create new photo record
                    photo = Photo(filename=unique_filename, description=title)
                    db.session.add(photo)
                    db.session.flush()

                image_filename = unique_filename

        project = Project(
            title=title,
            description=description or None,
            image_filename=image_filename,
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
            image_paths = process_upload_image(photo_file, app.config['UPLOAD FOLDER'], unique_filename)

            if image_paths:
                # Check if a photo with this file name already exists
                existing_photo = Photo.query.filter_by(filename=unique_filename).first()

                if not existing_photo:
                    # Create new photo record
                    photo = Photo(filename=unique_filename, description=description)
                    db.session.add(photo)
                    db.session.flush()

            db.session.commit()

            flash('Project created!', 'success')
            return redirect(url_for('new_photo'))

        else:
            flash(f'Error, photo required to be uploaded!', 'error')
            return redirect(url_for('new_photo'))

    return render_template('new_photo.html')

@app.route('/delete_photo/<int:photo_id>', methods=['POST'])
@login_required
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)

    # Delete the actual image files from storage
    try:
        for size in IMAGE_SIZES:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], size, photo.filename)
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
        name = request.form['name']
        email = request.form['email']
        message = request.form['message']
        msg = Message(subject=f"Contact Form: {name}",
                      sender=app.config['MAIL_DEFAULT_SENDER'],
                      recipients=[app.config['MAIL_RECIPIENT']],
                      body=f"From: {name} <{email}>\n\n{message}")
        mail.send(msg)
        flash('Message sent!', 'success')
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

    # Return to login or contact with a fresh form
    if request.path == '/login':
        return redirect(url_for('login'))
    elif request.path == '/contact':
        return redirect(url_for('contact'))

    # For other forms, redirect back to the same page.
    return redirect(request.full_path)


@app.route('/api/posts')
def api_posts():
    page = int(request.args.get('page', 1))
    per_page = 5
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


