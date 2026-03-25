"""Main routes: index, about, contact, sitemap, health."""
import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, Response, make_response, jsonify
from flask_login import current_user
from sqlalchemy.exc import OperationalError
import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException

from app.extensions import db, cache, limiter
from app.models import Post, Project
from app.helpers import retry_database_operation, published_filter

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
@cache.cached()
def index():
    try:
        posts = retry_database_operation(
            lambda: published_filter(Post.query).order_by(Post.date_posted.desc()).all()
        )
        featured_project = Project.query.filter_by(is_featured=True).first()
        return render_template('index.html', posts=posts, featured_project=featured_project)
    except OperationalError as e:
        current_app.logger.error(f"Database connection error: {str(e)}")
        flash('Database connection issue. Please try again in a moment.', 'error')
        return render_template('index.html', posts=[])


@main_bp.route('/about')
def about():
    return render_template('about.html')


@main_bp.route('/contact', methods=['GET', 'POST'])
@limiter.limit("3 per minute")
def contact():
    if request.method == 'POST':
        # Honeypot check: bots fill the hidden 'website' field, humans don't
        if request.form.get('website', ''):
            current_app.logger.info(f"Honeypot triggered from {request.remote_addr} — spam rejected")
            # Return success to avoid tipping off the bot
            flash('Your message has been sent. We\'ll get back to you soon.', 'success')
            return redirect(url_for('contact'))

        try:
            name = request.form['name'].strip()
            email = request.form['email'].strip()
            message = request.form['message'].strip()

            # Basic validation
            if not name or not email or not message:
                flash('Please fill in all fields.', 'error')
                return redirect(url_for('contact'))

            current_app.logger.info(f"Processing contact form from {email}")

            configuration = sib_api_v3_sdk.Configuration()
            configuration.api_key['api-key'] = os.environ.get('BREVO_API_KEY')

            api_instance = sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(configuration))

            # ── Send notification to site owner ──
            html_content = f"""
            <p><strong>Contact Form Submission</strong></p>
            <p><strong>From:</strong> {name} &lt;{email}&gt;</p>
            <p><strong>Message:</strong></p>
            <p>{message}</p>
            """
            sender = {"name": "Neurascape Transmission", "email": "faust@benamuwo.me"}
            to = [{"email": "faust@benamuwo.me", "name": "Ben's Neurascape"}]
            reply_to = {"email": email, "name": name}

            send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
                to=to, html_content=html_content, sender=sender,
                reply_to=reply_to, subject=f"Pending Neurascape Transmission: {name}"
            )

            api_response = api_instance.send_transac_email(send_smtp_email)
            current_app.logger.info(f"Email sent successfully. Message ID: {api_response.message_id}")

            # ── Send confirmation to the sender ──
            try:
                confirm_html = f"""
                <div style="font-family: system-ui, sans-serif; color: #e0e6f0; background: #050518; padding: 2em; border-radius: 12px;">
                    <h2 style="color: #C4B5E2;">Thanks for reaching out, {name}!</h2>
                    <p>This is a confirmation that your message was received through the Neurascape.</p>
                    <p style="padding: 1em; background: rgba(55,180,248,0.1); border-left: 3px solid #37B4F8; border-radius: 4px;">
                        <em>"{message[:300]}{'...' if len(message) > 300 else ''}"</em>
                    </p>
                    <p>I'll get back to you within 48 hours.</p>
                    <p style="color: #37B4F8;">— Ben Amuwo</p>
                </div>
                """
                confirm_email = sib_api_v3_sdk.SendSmtpEmail(
                    to=[{"email": email, "name": name}],
                    html_content=confirm_html,
                    sender=sender,
                    reply_to={"email": "faust@benamuwo.me", "name": "Ben Amuwo"},
                    subject="Neurascape — Message received"
                )
                api_instance.send_transac_email(confirm_email)
                current_app.logger.info(f"Confirmation email sent to {email}")
            except Exception as confirm_err:
                # Don't fail the whole request if confirmation email fails
                current_app.logger.warning(f"Confirmation email failed: {confirm_err}")

            flash('Your message has been sent. We\'ll get back to you soon.', 'success')

        except ApiException as e:
            current_app.logger.error(f"API exception: {e}")
            flash('Sorry, there was a problem sending your message. Please try again later.', 'error')
        except Exception as e:
            current_app.logger.error(f"Unexpected error: {str(e)}")
            flash('Sorry, there was a problem processing your request.', 'error')

        return redirect(url_for('contact'))

    return render_template('contact.html')


@main_bp.route('/sitemap.xml')
@cache.cached(timeout=3600)
def sitemap():
    """Generate XML sitemap for search engines."""
    base_url = request.host_url.rstrip('/')

    # Static pages
    pages = [
        {'loc': '/', 'priority': '1.0', 'changefreq': 'daily'},
        {'loc': '/about', 'priority': '0.8', 'changefreq': 'monthly'},
        {'loc': '/contact', 'priority': '0.6', 'changefreq': 'yearly'},
    ]

    # Section listing pages
    for path in ['/projects', '/photo_album', '/music', '/videos', '/reviews']:
        pages.append({'loc': path, 'priority': '0.7', 'changefreq': 'weekly'})

    # Individual posts (published only)
    posts = published_filter(Post.query).order_by(Post.date_posted.desc()).all()
    for post in posts:
        pages.append({
            'loc': f'/post/{post.id}',
            'lastmod': post.date_posted.strftime('%Y-%m-%d'),
            'priority': '0.6',
            'changefreq': 'monthly',
        })

    # Individual projects
    projects = Project.query.order_by(Project.date_posted.desc()).all()
    for project in projects:
        pages.append({
            'loc': f'/project/{project.id}',
            'lastmod': project.date_posted.strftime('%Y-%m-%d'),
            'priority': '0.6',
            'changefreq': 'monthly',
        })

    xml_lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    xml_lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for page in pages:
        xml_lines.append('  <url>')
        xml_lines.append(f'    <loc>{base_url}{page["loc"]}</loc>')
        if 'lastmod' in page:
            xml_lines.append(f'    <lastmod>{page["lastmod"]}</lastmod>')
        xml_lines.append(f'    <changefreq>{page["changefreq"]}</changefreq>')
        xml_lines.append(f'    <priority>{page["priority"]}</priority>')
        xml_lines.append('  </url>')
    xml_lines.append('</urlset>')

    response = make_response('\n'.join(xml_lines))
    response.headers['Content-Type'] = 'application/xml'
    return response


@main_bp.route('/health')
@limiter.exempt
def health():
    """Health check endpoint for uptime monitors (UptimeRobot, Betterstack, etc.)."""
    db_ok = False
    try:
        db.session.execute(db.text('SELECT 1'))
        db_ok = True
    except Exception as e:
        current_app.logger.error(f"Health check DB failure: {e}")

    status = 'ok' if db_ok else 'degraded'
    code = 200 if db_ok else 503
    return jsonify(status=status, db=db_ok), code
