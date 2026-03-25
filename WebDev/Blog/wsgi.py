"""
WSGI entry point for the Neurascape application.

Usage:
    gunicorn wsgi:app
    flask --app wsgi run
"""
from app import create_app

app = create_app()
