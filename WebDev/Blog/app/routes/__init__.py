"""
Blueprint registration for the Neurascape application.
"""


def register_blueprints(app):
    from app.routes.main import main_bp
    from app.routes.auth import auth_bp
    from app.routes.posts import posts_bp
    from app.routes.projects import projects_bp
    from app.routes.media import media_bp
    from app.routes.spotify import spotify_bp
    from app.routes.api import api_bp
    from app.routes.admin import admin_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(posts_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(media_bp)
    app.register_blueprint(spotify_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(admin_bp)
