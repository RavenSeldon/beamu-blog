import os
from datetime import timedelta
basedir = os.path.abspath(os.path.dirname(__file__))

ENV = os.environ.get('FLASK_ENV', 'development')
SECRET_KEY = os.environ.get('SECRET_KEY', 'default-dev-key')
SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
    'sqlite:///' + os.path.join(basedir, 'instance', 'blog.db')
SQLALCHEMY_TRACK_MODIFICATIONS = False

PERMANENT_SESSION_LIFETIME = timedelta(days=1)

WTF_CSRF_TIME_LIMIT = 3600
WTF_CSRF_SSL_STRICT = False
WTF_CSRF_ENABLED = True

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'

MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'True').lower() in ['true', 'on', '1']
MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER')
MAIL_RECIPIENT = os.environ.get('MAIL_RECIPIENT')