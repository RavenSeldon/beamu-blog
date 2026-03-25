"""Authentication routes: login, logout."""
from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, current_user
from flask_wtf.csrf import generate_csrf

from app.extensions import limiter
from app.models import User
from app.forms import LoginForm

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/login', methods=['GET', 'POST'])
@limiter.limit("5 per minute")
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    form = LoginForm()

    if request.method == 'GET':
        form.csrf_token.data = generate_csrf()

    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember.data)
            flash('Welcome, Ben.')
            return redirect(request.args.get('next') or url_for('index'))
        flash('Invalid credentials', 'error')

    return render_template('login.html', form=form)


@auth_bp.route('/logout')
def logout():
    logout_user()
    flash('You have been logged out successfully!', 'success')
    return redirect(url_for('index'))
