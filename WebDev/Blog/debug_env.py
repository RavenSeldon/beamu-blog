import os
import sys
import datetime
from pathlib import Path


def check_env_variables():
    """Check environment variables and configuration"""
    print("=" * 50)
    print("ENVIRONMENT VARIABLES DIAGNOSTIC")
    print("=" * 50)
    print(f"Date/Time: {datetime.datetime.now()}")
    print(f"Python version: {sys.version}")
    print(f"Current working directory: {os.getcwd()}")

    # Try to import dotenv
    try:
        from dotenv import load_dotenv
        print("\n.env file check:")

        env_paths = [
            Path('.') / '.env',  # Current directory
            Path('..') / '.env',  # Parent directory
            Path('/etc/neurascape') / '.env',  # System config directory
        ]

        for env_path in env_paths:
            if env_path.exists():
                print(f"  ✅ Found .env file at: {env_path}")
            else:
                print(f"  ❌ No .env file at: {env_path}")
    except ImportError:
        print("\n❌ python-dotenv not installed. Install with:")
        print("   pip install python-dotenv")

    # Check critical environment variables
    critical_vars = [
        'DATABASE_URL',
        'ADMIN_PASSWORD',
        'SECRET_KEY',
        'FLASK_ENV',
        'BREVO_API_KEY'
    ]

    print("\nCritical environment variables:")
    for var in critical_vars:
        value = os.environ.get(var)
        if value:
            # Mask sensitive values
            if any(s in var.lower() for s in ['password', 'secret', 'key']):
                display_value = f"{value[:3]}...{value[-3:]}" if len(value) > 6 else "***"
                status = "✅ SET"
            else:
                display_value = value
                status = "✅ SET"
        else:
            display_value = "NOT SET"
            status = "❌ MISSING"

        print(f"  {var}: {status} - {display_value}")

    # Check Flask application configuration
    try:
        print("\nFlask application configuration:")
        from app import app

        # Check database URI
        with app.app_context():
            db_uri = app.config.get('SQLALCHEMY_DATABASE_URI', 'Not configured')
            # Mask sensitive parts of the URI
            if '@' in db_uri:
                # Split URI to hide username/password
                parts = db_uri.split('@')
                masked_uri = f"{parts[0].split('://')[0]}://***:***@{parts[1]}"
            else:
                masked_uri = db_uri

            print(f"  Database URI: {masked_uri}")

            # Check if database connection works
            try:
                from app import db
                connection = db.engine.connect()
                print("  ✅ Database connection successful!")
                connection.close()
            except Exception as e:
                print(f"  ❌ Database connection failed: {str(e)}")

    except ImportError as e:
        print(f"\n❌ Could not import Flask app: {str(e)}")
    except Exception as e:
        print(f"\n❌ Error checking Flask configuration: {str(e)}")

    print("\n" + "=" * 50)


if __name__ == "__main__":
    check_env_variables()