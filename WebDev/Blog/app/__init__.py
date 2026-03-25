"""
Neurascape Application Factory.

Usage:
    from app import create_app
    app = create_app()
"""
import os
import logging
from pathlib import Path

import sentry_sdk
from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify
from flask_login import current_user
from flask_wtf.csrf import CSRFError, generate_csrf
from werkzeug.middleware.proxy_fix import ProxyFix
from datetime import datetime, timezone

from app.extensions import db, migrate, login_manager, csrf, cache, limiter, mail, compress
from app.helpers import markdown_safe


def create_app(config_filename='config.py'):
    """Create and configure the Flask application."""

    # Resolve paths relative to the project root (one level up from app/)
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

    app = Flask(
        __name__,
        template_folder=os.path.join(project_root, 'templates'),
        static_folder=os.path.join(project_root, 'static'),
    )

    # Load configuration
    config_path = os.path.join(project_root, config_filename)
    app.config.from_pyfile(config_path)

    # --- Sentry Error Monitoring ---
    sentry_dsn = os.environ.get('SENTRY_DSN')
    if sentry_dsn:
        sentry_sdk.init(
            dsn=sentry_dsn,
            traces_sample_rate=0.1,
            send_default_pii=False,
            environment=app.config.get('ENV', 'development'),
        )
        app.logger.info('Sentry error monitoring initialized')

    # ProxyFix for reverse proxy (DigitalOcean / Gunicorn)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    # --- Initialize Extensions ---
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    login_manager.login_view = 'login'
    csrf.init_app(app)
    cache.init_app(app)
    limiter.init_app(app)
    mail.init_app(app)
    compress.init_app(app)

    # --- Upload folder config ---
    upload_folder = os.path.join(app.static_folder, 'images')
    app.config['UPLOAD_FOLDER'] = upload_folder

    # --- Logging ---
    log_path = os.path.join(project_root, 'debug.log')
    file_handler = logging.FileHandler(log_path)
    file_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.info(f"Flask application startup - logs going to {log_path}")

    # --- Register Blueprints ---
    from app.routes import register_blueprints
    register_blueprints(app)

    # --- Endpoint Aliases (backward compatibility) ---
    # Blueprints namespace endpoints as 'blueprint.func' (e.g. 'main.index').
    # Templates use the original flat names (e.g. 'index').
    # This creates short-name aliases so url_for('index') still works.
    for rule in list(app.url_map.iter_rules()):
        ep = rule.endpoint
        if '.' in ep and ep != 'static':
            short_name = ep.split('.', 1)[1]
            if short_name not in app.view_functions:
                app.view_functions[short_name] = app.view_functions[ep]
                app.url_map._rules_by_endpoint.setdefault(short_name, [])
                app.url_map._rules_by_endpoint[short_name].extend(
                    app.url_map._rules_by_endpoint.get(ep, [])
                )

    # --- User Loader ---
    from app.models import User
    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # --- Jinja Template Filter ---
    @app.template_filter('markdown_safe')
    def markdown_safe_filter(text):
        return markdown_safe(text)

    # --- Context Processors ---
    from app.utils.image_utils import USING_SPACES, SPACES_URL, get_srcset, get_picture_data
    from app.utils.minify_utils import asset_url

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
            get_picture_data=get_picture_data,
            USING_SPACES=USING_SPACES,
            SPACES_URL=SPACES_URL
        )

    # --- Shell Context ---
    import sqlalchemy as sa
    import sqlalchemy.orm as so
    from app.models import Project, Post, MusicItem, Video, Review, Tag

    @app.shell_context_processor
    def make_shell_context():
        return {
            "sa": sa, "so": so, "db": db,
            "Project": Project, "Post": Post, "User": User,
            "MusicItem": MusicItem, "Video": Video, "Review": Review,
            "Tag": Tag
        }

    # --- Before Request ---
    @app.before_request
    def make_session_permanent():
        session.permanent = True

    # --- Error Handlers ---
    @app.errorhandler(404)
    def page_not_found(e):
        app.logger.warning(f"404 Not Found: {request.path}")
        return render_template('404.html'), 404

    @app.errorhandler(500)
    def internal_server_error(e):
        app.logger.error(f'500 Internal Server Error: {request.path} - {str(e)}')
        return render_template('500.html'), 500

    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        flash('The form has expired. Please try again.', 'error')
        app.logger.warning(f"CSRF Error: {str(e)} on {request.path} from {request.remote_addr}")
        if request.path == '/login':
            return redirect(url_for('login'))
        elif request.path == '/contact':
            return redirect(url_for('contact'))
        return redirect(request.full_path)

    @app.errorhandler(429)
    def ratelimit_handler(e):
        app.logger.warning(f"Rate limit exceeded: {request.path} from {request.remote_addr}")
        flash('Too many requests. Please wait a moment and try again.', 'error')
        if request.path == '/login':
            return redirect(url_for('login'))
        elif request.path == '/contact':
            return redirect(url_for('contact'))
        return render_template('500.html'), 429

    # --- Security Headers ---
    @app.after_request
    def set_security_headers(response):
        csp_directives = {
            'default-src': "'self'",
            'script-src': "'self' 'unsafe-inline' https://sdk.scdn.co https://cdn.jsdelivr.net",
            'style-src': "'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://cdn.jsdelivr.net",
            'font-src': "'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
            'img-src': "'self' data: https://*.digitaloceanspaces.com https://i.scdn.co",
            'connect-src': "'self' https://*.spotify.com wss://*.spotify.com https://accounts.spotify.com",
            'media-src': "'self'",
            'frame-src': "https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com https://sdk.scdn.co",
        }
        csp = '; '.join(f"{k} {v}" for k, v in csp_directives.items())
        response.headers['Content-Security-Policy'] = csp
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        return response

    # --- CLI Commands ---
    import click

    @app.cli.group()
    def user():
        """Admin user management commands."""
        pass

    @user.command('create')
    @click.argument('username')
    @click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True,
                  help='Password for the new user.')
    def create_user(username, password):
        """Create a new admin user.  Usage: flask user create <username>"""
        from app.models import User
        existing = User.query.filter_by(username=username).first()
        if existing:
            click.echo(f'Error: User "{username}" already exists.')
            return
        new_user = User(username=username)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()
        click.echo(f'Admin user "{username}" created successfully.')

    @user.command('update-password')
    @click.argument('username')
    @click.option('--password', prompt='New password', hide_input=True, confirmation_prompt=True,
                  help='New password.')
    def update_password(username, password):
        """Update an admin user's password.  Usage: flask user update-password <username>"""
        from app.models import User
        u = User.query.filter_by(username=username).first()
        if not u:
            click.echo(f'Error: User "{username}" not found.')
            return
        u.set_password(password)
        db.session.commit()
        click.echo(f'Password updated for "{username}".')

    @user.command('list')
    def list_users():
        """List all admin users."""
        from app.models import User
        users = User.query.all()
        if not users:
            click.echo('No users found.')
            return
        for u in users:
            click.echo(f'  ID: {u.id}  Username: {u.username}')

    return app
