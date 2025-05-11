# config.py
import os
from datetime import timedelta
from pathlib import Path


# Helper function to get environment variables with fallbacks
def get_env_var(var_name, default=None):
    value = os.environ.get(var_name)
    if value is None and default is not None:
        return default
    return value


# Try to load .env file if it exists and python-dotenv is installed
try:
    from dotenv import load_dotenv

    # Look for .env file in current directory and parent directories
    env_paths = [
        Path('.') / '.env',  # Current directory
        Path('..') / '.env',  # Parent directory
        Path('/etc/neurascape') / '.env',  # System config directory
    ]

    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)
            print(f"Loaded environment variables from {env_path}")
            break
except ImportError:
    # python-dotenv not installed, continue without it
    pass

# Base directory for file paths
basedir = os.path.abspath(os.path.dirname(__file__))

# Application settings
ENV = get_env_var('FLASK_ENV', 'development')
SECRET_KEY = get_env_var('SECRET_KEY', 'default-dev-key')

# Database configuration with special handling for PostgreSQL/Neon
DATABASE_URL = get_env_var('DATABASE_URL')

# If running in production mode but no DATABASE_URL is set, log a warning
if ENV == 'production' and not DATABASE_URL:
    print("WARNING: Running in production but DATABASE_URL is not set!")

# Fix SQLAlchemy PostgreSQL URI format if needed (postgres:// -> postgresql://)
if DATABASE_URL and DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

# Add SSL mode for PostgreSQL if needed
if DATABASE_URL and DATABASE_URL.startswith('postgresql://') and '?sslmode=' not in DATABASE_URL:
    DATABASE_URL += '?sslmode=require'

# Fallback to SQLite if no DATABASE_URL is provided
SQLALCHEMY_DATABASE_URI = DATABASE_URL or 'sqlite:///' + os.path.join(basedir, 'instance', 'blog.db')
SQLALCHEMY_TRACK_MODIFICATIONS = False

# Neon Specific Configurations
SQLALCHEMY_ENGINE_OPTIONS = {
    'pool_pre_ping': True,  # Verify connections before using them
    'pool_size': 5,
    'pool_recycle': 1800,  # Recycle connections after 30 minutes
    'pool_timeout': 30,
    'max_overflow': 10,
}

if DATABASE_URL and 'neon.tech' in DATABASE_URL:
    # Neon-specific connection options
    SQLALCHEMY_ENGINE_OPTIONS.update({
        'connect_args': {
            'sslmode': 'require',
            'connect_timeout': 10,
        }
    })

# Session and security settings
PERMANENT_SESSION_LIFETIME = timedelta(days=1)
WTF_CSRF_TIME_LIMIT = 3600
WTF_CSRF_SSL_STRICT = False
WTF_CSRF_ENABLED = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'

# Email configuration
MAIL_SERVER = get_env_var('MAIL_SERVER', 'smtp.gmail.com')
MAIL_PORT = int(get_env_var('MAIL_PORT', 587))
MAIL_USE_TLS = get_env_var('MAIL_USE_TLS', 'True').lower() in ['true', 'on', '1']
MAIL_USERNAME = get_env_var('MAIL_USERNAME')
MAIL_PASSWORD = get_env_var('MAIL_PASSWORD')
MAIL_DEFAULT_SENDER = get_env_var('MAIL_DEFAULT_SENDER')
MAIL_RECIPIENT = get_env_var('MAIL_RECIPIENT')

# Print active configuration (without sensitive info) to help with debugging
if ENV == 'development':
    print(f"Active configuration: ENV={ENV}, Database={SQLALCHEMY_DATABASE_URI.split('@')[0]}@...")