import os
import re
import glob
import hashlib
import subprocess
import json
from csscompressor import compress as compress_css
from jsmin import jsmin
from flask import current_app


def get_file_hash(file_path):
    """
    Generate a hash of file contents for cache busting.

    Args:
        file_path: Path to the file

    Returns:
        str: Short hash of the file contents
    """
    with open(file_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()[:8]


def minify_css_file(input_path, output_path=None):
    """
    Minify a CSS file.

    Args:
        input_path: Path to the CSS file to minify
        output_path: Optional path for the minified output

    Returns:
        str: The filename of the minified file, or None if failed
    """
    if output_path is None:
        # Generate output filename if not provided
        filename, ext = os.path.splitext(input_path)
        output_path = f"{filename}.min{ext}"

    try:
        with open(input_path, 'r', encoding='utf-8') as css_file:
            css_content = css_file.read()

        # Minify the CSS
        minified_css = compress_css(css_content)

        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Write minified content to output file
        with open(output_path, 'w', encoding='utf-8') as output_file:
            output_file.write(minified_css)

        # Generate hash for cache busting
        file_hash = get_file_hash(output_path)

        # Create versioned file
        hash_output_path = f"{os.path.splitext(output_path)[0]}.{file_hash}{os.path.splitext(output_path)[1]}"
        os.replace(output_path, hash_output_path)

        print(f"Minified CSS: {input_path} → {hash_output_path} (Saved {len(css_content) - len(minified_css)} bytes)")
        return os.path.basename(hash_output_path)

    except Exception as e:
        print(f"Error minifying CSS file {input_path}: {e}")
        return None


def try_terser_minify(js_content, output_path):
    """
    Try to minify JavaScript using terser (better for modern JS).
    Falls back to jsmin if terser is not available.

    Args:
        js_content: Javascript content to minify
        output_path: Path to save minified output

    Returns:
        tuple: (success: bool, minified_content: str or None)
    """
    try:
        # Check if terser is available
        subprocess.run(['terser', '--version'], capture_output=True, check=True)

        # Create a temporary file for input
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as tmp:
            tmp.write(js_content)
            tmp_path = tmp.name

        try:
            # Run terser with options that preserve modern JS
            result = subprocess.run([
                'terser',
                tmp_path,
                '--compress',
                '--mangle',
                '--output', output_path,
                '--ecma', '2020',
                '--format', 'ascii_only=true,quote_style=3'
            ], capture_output=True, text=True)

            if result.returncode == 0:
                with open(output_path, 'r', encoding='utf-8') as f:
                    return True, f.read()
            else:
                print(f"Terser error: {result.stderr}")
                return False, None
        finally:
            # Clean up temp file
            os.unlink(tmp_path)

    except (subprocess.CalledProcessError, FileNotFoundError):
        # Terser not available, fall back to jsmin
        print("Terser not found, falling back to jsmin (may have issues with modern JS)")
        return False, None


def minify_js_file(input_path, output_path=None):
    """
    Minify a JavaScript file, with better support for modern JS.

    Args:
        input_path: Path to the JavaScript file to minify
        output_path: Optional path for the minified output

    Returns:
        str: The filename of the minified file, or None if failed
    """
    if output_path is None:
        # Generate output filename if not provided
        filename, ext = os.path.splitext(input_path)
        output_path = f"{filename}.min{ext}"

    try:
        with open(input_path, 'r', encoding='utf-8') as js_file:
            js_content = js_file.read()

        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Try terser first (better for modern JS), fall back to jsmin
        terser_success, minified_js = try_terser_minify(js_content, output_path)

        if not terser_success:
            # Fall back to jsmin
            try:
                minified_js = jsmin(js_content)
                with open(output_path, 'w', encoding='utf-8') as output_file:
                    output_file.write(minified_js)
            except Exception as jsmin_error:
                print(f"jsmin error for {input_path}: {jsmin_error}")
                # If minification fails, use original content
                minified_js = js_content
                with open(output_path, 'w', encoding='utf-8') as output_file:
                    output_file.write(minified_js)
                print(f"Warning: Using unminified content for {input_path}")

        # Generate hash for cache busting
        file_hash = get_file_hash(output_path)

        # Create versioned file
        hash_output_path = f"{os.path.splitext(output_path)[0]}.{file_hash}{os.path.splitext(output_path)[1]}"
        os.replace(output_path, hash_output_path)

        bytes_saved = len(js_content) - len(minified_js) if minified_js else 0
        print(f"Minified JS: {input_path} → {hash_output_path} (Saved {bytes_saved} bytes)")
        return os.path.basename(hash_output_path)

    except Exception as e:
        print(f"Error minifying JS file {input_path}: {e}")
        return None


def minify_all_assets(app):
    """
    Minify all CSS and JS files in the static directory.

    Args:
        app: Flask application instance

    Returns:
        dict: Mapping of original to minified filenames
    """
    # Get the static folder path
    static_dir = app.static_folder

    # Dictionary to store the mapping of original to minified filenames
    asset_map = {'css': {}, 'js': {}}

    # Create a directory for minified files if it doesn't exist
    os.makedirs(os.path.join(static_dir, 'min'), exist_ok=True)

    # Minify CSS files
    css_files = glob.glob(os.path.join(static_dir, 'css', '*.css'))
    for css_file in css_files:
        # Skip already minified files
        if '.min.' in css_file:
            continue

        filename = os.path.basename(css_file)
        output_path = os.path.join(static_dir, 'min', f"{os.path.splitext(filename)[0]}.min.css")

        minified_filename = minify_css_file(css_file, output_path)
        if minified_filename:
            asset_map['css'][filename] = minified_filename

    # Minify JS files
    js_files = glob.glob(os.path.join(static_dir, 'js', '*.js'))
    for js_file in js_files:
        # Skip already minified files
        if '.min.' in js_file:
            continue

        filename = os.path.basename(js_file)
        output_path = os.path.join(static_dir, 'min', f"{os.path.splitext(filename)[0]}.min.js")

        minified_filename = minify_js_file(js_file, output_path)
        if minified_filename:
            asset_map['js'][filename] = minified_filename

    # Save the asset map to a file for reference
    asset_map_path = os.path.join(static_dir, 'asset_map.py')
    with open(asset_map_path, 'w', encoding='utf-8') as f:
        f.write(f"# This file is auto-generated, do not edit\n\nasset_map = {asset_map}\n")

    return asset_map


def get_minified_url(asset_type, filename):
    """
    Get the URL for a minified asset.

    Args:
        asset_type: Type of asset ('css' or 'js')
        filename: Original filename

    Returns:
        str: URL to the minified asset, or to the original if no minified version exists
    """
    try:
        # Try to import the asset map
        import importlib.util

        # Get the path to the asset map
        static_dir = current_app.static_folder
        asset_map_path = os.path.join(static_dir, 'asset_map.py')

        # Load the asset map module
        spec = importlib.util.spec_from_file_location("asset_map", asset_map_path)
        asset_map_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(asset_map_module)

        # Get the asset map
        asset_map = getattr(asset_map_module, 'asset_map', {})

        if filename in asset_map.get(asset_type, {}):
            return f"/static/min/{asset_map[asset_type][filename]}"
    except (ImportError, FileNotFoundError):
        # Asset map doesn't exist yet
        pass
    except Exception as e:
        print(f"Error loading asset map: {e}")

    # Fall back to the original file
    return f"/static/{asset_type}/{filename}"


def asset_url(filename):
    """
    Generate URL for an asset, using minified version if available.

    Args:
        filename: Original filename with path relative to static directory

    Returns:
        str: URL to the asset (minified in production)
    """
    # Only use minified versions in production
    if current_app.config.get('ENV') != 'production':
        return f"/static/{filename}"

    if filename.startswith('css/') and filename.endswith('.css'):
        return get_minified_url('css', filename.replace('css/', '', 1))
    elif filename.startswith('js/') and filename.endswith('.js'):
        return get_minified_url('js', filename.replace('js/', '', 1))
    else:
        return f"/static/{filename}"