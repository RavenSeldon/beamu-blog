"""
Extension instances for the Neurascape Flask application.
All extensions are created without an app instance and initialized via init_app() in create_app().
"""
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_mail import Mail
from flask_compress import Compress
from sqlalchemy import MetaData

naming_convention = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
}

db = SQLAlchemy(metadata=MetaData(naming_convention=naming_convention))
migrate = Migrate(render_as_batch=True)
login_manager = LoginManager()
csrf = CSRFProtect()
cache = Cache()
limiter = Limiter(get_remote_address, default_limits=[], storage_uri="memory://")
mail = Mail()
compress = Compress()
