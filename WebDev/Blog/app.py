import os
from flask import Flask, render_template, request, redirect, url_for, flash, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
import sqlalchemy as sa
import sqlalchemy.orm as so
from typing import Optional
from flask_mail import Mail, Message
from werkzeug.utils import secure_filename
from datetime import datetime, timezone

app = Flask(__name__)
app.config.from_pyfile('config.py')

db = SQLAlchemy(app)
mail = Mail(app)
migrate = Migrate(app, db)

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
    password_hash: so.Mapped[str] = so.mapped_column(sa.String(128), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Post(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    content: so.Mapped[str] = so.mapped_column(db.Text, nullable=False)
    date_posted: so.Mapped[datetime] = so.mapped_column(index=True, default=lambda: datetime.now(timezone.utc))
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)


class Photo(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    filename: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(510), nullable=True)


class Project(db.Model):
    id: so.Mapped[int] = so.mapped_column(primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(db.Text, nullable=True)
    image_filename: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(255), nullable=True)


# Helper Functions
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# Create admin user
def create_admin_user():
    # Check if admin user already exists
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(username='admin')
        # Set password from environment variable or use default (not recommended for production)
        admin_password = os.environ.get('ADMIN_PASSWORD', 'change-me-please')
        admin.set_password(admin_password)
        db.session.add(admin)
        db.session.commit()
        print("Admin user created. Please change the default password!")


# Context Processor
@app.context_processor
def inject_now():
    return {'datetime': datetime, 'timezone': timezone, 'current_user': current_user}


@app.shell_context_processor
def make_shell_context():
    return {"sa": sa, "so": so, "db": db, "Project": Project, "Post": Post, "User": User}


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

    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        remember = 'remember' in request.form

        user = User.query.filter_by(username=username).first()

        # Check if user exists and password is correct
        if user is None or not user.check_password(password):
            flash('Invalid username or password', 'error')
            return redirect(url_for('login'))

        # Log in user and redirect to home
        login_user(user, remember=remember)
        flash('You have been logged in successfully!', 'success')

        # Redirect to the page the user was trying to access
        next_page = request.args.get('next')
        if next_page:
            return redirect(next_page)
        return redirect(url_for('index'))

    return render_template('login.html')


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
        github_link = request.form.get('github_link')
        image = request.files.get('image')
        image_filename = None
        if image and allowed_file(image.filename):
            image_filename = secure_filename(image.filename)
            image.save(os.path.join(app.config['UPLOAD_FOLDER'], image_filename))
        post = Post(title=title, content=content, github_link=github_link, image_filename=image_filename)
        db.session.add(post)
        db.session.commit()
        flash('Post created!', 'success')
        return redirect(url_for('index'))
    return render_template('new_post.html')


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


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        create_admin_user()
    app.run(debug=True)