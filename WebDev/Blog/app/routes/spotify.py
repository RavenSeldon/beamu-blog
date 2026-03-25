"""Spotify OAuth and API proxy routes."""
import os
import base64
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, session, current_app
import requests as http_requests
from urllib.parse import urlencode

from app.helpers import SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, VISITOR_SPOTIFY_SCOPES

spotify_bp = Blueprint('spotify', __name__)


@spotify_bp.route('/spotify/initiate-auth')
def spotify_initiate_auth():
    csrf_state = os.urandom(16).hex()
    session['spotify_visitor_auth_state'] = csrf_state

    generated_redirect_uri = url_for('spotify_callback', _external=True)
    current_app.logger.info(f"Generated Spotify Redirect URI: {generated_redirect_uri}")
    print(f"Generated Spotify Redirect URI: {generated_redirect_uri}")

    auth_query_parameters = {
        "response_type": "code",
        "redirect_uri": url_for('spotify_callback', _external=True),
        "scope": VISITOR_SPOTIFY_SCOPES,
        "client_id": current_app.config['SPOTIFY_CLIENT_ID'],
        "state": csrf_state
    }
    auth_url = SPOTIFY_AUTH_URL + "?" + urlencode(auth_query_parameters)
    current_app.logger.info(f"Redirecting visitor to Spotify auth: {auth_url}")
    return redirect(auth_url)


@spotify_bp.route('/spotify/callback')
def spotify_callback():
    auth_code = request.args.get('code')
    error = request.args.get('error')
    state = request.args.get('state')

    stored_state = session.pop('spotify_visitor_auth_state', None)
    if not state or state != stored_state:
        flash("Spotify authorization failed: State mismatch. Please try connecting again.", "error")
        current_app.logger.warning(f"Spotify callback state mismatch. Received: {state}, Expected: {stored_state}")
        return redirect(url_for('music'))

    return render_template('spotify_callback_handler.html', auth_code=auth_code, error=error)


@spotify_bp.route('/api/spotify/exchange-visitor-code', methods=['POST'])
def exchange_visitor_code():
    data = request.get_json()
    auth_code = data.get('code')
    if not auth_code:
        return jsonify({"error": "Authorization code is missing."}), 400

    auth_str = f"{current_app.config['SPOTIFY_CLIENT_ID']}:{current_app.config['SPOTIFY_CLIENT_SECRET']}"
    b64_auth_str = base64.b64encode(auth_str.encode()).decode()

    payload = {
        "grant_type": "authorization_code",
        "code": str(auth_code),
        "redirect_uri": url_for('spotify_callback', _external=True)
    }
    headers = {"Authorization": f"Basic {b64_auth_str}"}

    try:
        post_request = http_requests.post(SPOTIFY_TOKEN_URL, data=payload, headers=headers)
        post_request.raise_for_status()
        token_info = post_request.json()
        return jsonify({
            "access_token": token_info["access_token"],
            "refresh_token": token_info.get("refresh_token"),
            "expires_in": token_info['expires_in']
        })
    except http_requests.exceptions.HTTPError as http_err:
        error_details = post_request.json() if post_request.content else {}
        current_app.logger.error(f"Spotify token exchange HTTP error: {http_err} - Response: {error_details}")
        return jsonify({"error": "Failed to exchange code for token.", "details": error_details.get("error_description", "Unknown error")}), post_request.status_code
    except Exception as e:
        current_app.logger.error(f"Error exchanging Spotify code: {e}")
        return jsonify({"error": "An unexpected error occurred during token exchange."}), 500


@spotify_bp.route('/api/spotify/refresh-visitor-token', methods=['POST'])
def refresh_visitor_token():
    data = request.get_json()
    refresh_token_from_client = data.get('refresh_token')
    if not refresh_token_from_client:
        return jsonify({"error": "Refresh token is missing."}), 400

    auth_str = f"{current_app.config['SPOTIFY_CLIENT_ID']}:{current_app.config['SPOTIFY_CLIENT_SECRET']}"
    b64_auth_str = base64.b64encode(auth_str.encode()).decode()
    payload = {"grant_type": "refresh_token", "refresh_token": refresh_token_from_client}
    headers = {"Authorization": f"Basic {b64_auth_str}"}

    try:
        r = http_requests.post(SPOTIFY_TOKEN_URL, data=payload, headers=headers)
        r.raise_for_status()
        token_info = r.json()
        return jsonify({
            "access_token": token_info["access_token"],
            "expires_in": token_info["expires_in"],
            "refresh_token": token_info.get("refresh_token")
        })
    except http_requests.exceptions.HTTPError as http_err:
        error_details = r.json() if r.content else {}
        current_app.logger.error(f"Spotify token refresh HTTP error: {http_err} - Response: {error_details}")
        return jsonify({"error": "Failed to refresh Spotify token.", "details": error_details.get("error_description", "Refresh token may be invalid or revoked.")}), r.status_code
    except Exception as e:
        current_app.logger.error(f"Unexpected error refreshing Spotify visitor token: {e}")
        return jsonify({"error": "Server error during token refresh."}), 500
