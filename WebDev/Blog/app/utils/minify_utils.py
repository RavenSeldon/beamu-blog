"""
Minification utilities for CSS and JS assets.

Handles:
- CSS: Resolves @import statements, concatenates modules, minifies, hashes for cache busting
- JS: Minifies via terser (preferred) or jsmin fallback, hashes for cache busting
- Asset URL resolution for production builds
"""
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
    """Generate a short MD5 hash of file contents for cache busting."""
    with open(file_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()[:8]


def resolve_css_imports(css_path):
    """
    Read a CSS file and recursively resolve @import url("...") statements
    by inlining the referenced files. Handles relative paths.

    Args:
        css_path: Absolute path to the CSS file

    Returns:
        str: Concatenated CSS with all imports resolved
    """
    css_dir = os.path.dirname(css_path)

    with open(css_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match @import url("...") or @import url('...') — skip external URLs
    import_pattern = re.compile(
        r'@import\s+url\(["\']([^"\']+)["\']\)\s*;',
        re.IGNORECASE
    )

    def replace_import(match):
        url = match.group(1)
        # Skip external URLs (http/https)
        if url.startswith(('http://', 'https://')):
            return match.group(0)  # Keep external imports as-is
        # Resolve relative path
        import_path = os.path.normpath(os.path.join(css_dir, url))
        if os.path.isfile(import_path):
            print(f"  Inlining: {url}")
            return resolve_css_imports(import_path)  # Recurse for nested imports
        else:
            print(f"  Warning: Cannot resolve import '{url}' (file not found: {import_path})")
            return match.group(0)

    resolved = import_pattern.sub(replace_import, content)
    return resolved


def minify_css_file(input_path, output_path=None):
    """Minify a CSS file. Returns the hashed output filename, or None on failure."""
    if output_path is None:
        filename, ext = os.path.splitext(input_path)
        output_path = f"{filename}.min{ext}"

    try:
        # Resolve @import statements into a single concatenated string
        css_content = resolve_css_imports(input_path)

        minified_css = compress_css(css_content)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as output_file:
            output_file.write(minified_css)

        file_hash = get_file_hash(output_path)
        hash_output_path = f"{os.path.splitext(output_path)[0]}.{file_hash}{os.path.splitext(output_path)[1]}"
        os.replace(output_path, hash_output_path)

        saved = len(css_content) - len(minified_css)
        print(f"Minified CSS: {input_path} → {os.path.basename(hash_output_path)} (Saved {saved} bytes)")
        return os.path.basename(hash_output_path)

    except Exception as e:
        print(f"Error minifying CSS file {input_path}: {e}")
        return None


def try_terser_minify(js_content, output_path):
    """
    Try to minify JavaScript using terser (better for modern JS).
    Falls back to jsmin if terser is not available.

    Returns:
        tuple: (success: bool, minified_content: str or None)
    """
    try:
        subprocess.run(['terser', '--version'], capture_output=True, check=True)

        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as tmp:
            tmp.write(js_content)
            tmp_path = tmp.name

        try:
            result = subprocess.run([
                'terser', tmp_path,
                '--compress', '--mangle',
                '--output', output_path,
                '--ecma', '2020',
                '--format', 'ascii_only=true'
            ], capture_output=True, text=True)

            if result.returncode == 0:
                with open(output_path, 'r', encoding='utf-8') as f:
                    return True, f.read()
            else:
                print(f"Terser error: {result.stderr}")
                return False, None
        finally:
            os.unlink(tmp_path)

    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Terser not found, falling back to jsmin")
        return False, None


def minify_js_file(input_path, output_path=None):
    """Minify a JavaScript file. Returns the hashed output filename, or None on failure."""
    if output_path is None:
        filename, ext = os.path.splitext(input_path)
        output_path = f"{filename}.min{ext}"

    try:
        with open(input_path, 'r', encoding='utf-8') as js_file:
            js_content = js_file.read()

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        terser_success, minified_js = try_terser_minify(js_content, output_path)

        if not terser_success:
            try:
                minified_js = jsmin(js_content)
                with open(output_path, 'w', encoding='utf-8') as output_file:
                    output_file.write(minified_js)
            except Exception as jsmin_error:
                print(f"jsmin error for {input_path}: {jsmin_error}")
                minified_js = js_content
                with open(output_path, 'w', encoding='utf-8') as output_file:
                    output_file.write(minified_js)
                print(f"Warning: Using unminified content for {input_path}")

        file_hash = get_file_hash(output_path)
        hash_output_path = f"{os.path.splitext(output_path)[0]}.{file_hash}{os.path.splitext(output_path)[1]}"
        os.replace(output_path, hash_output_path)

        bytes_saved = len(js_content) - len(minified_js) if minified_js else 0
        print(f"Minified JS: {input_path} → {os.path.basename(hash_output_path)} (Saved {bytes_saved} bytes)")
        return os.path.basename(hash_output_path)

    except Exception as e:
        print(f"Error minifying JS file {input_path}: {e}")
        return None


def minify_all_assets(app):
    """
    Minify all CSS and JS files in the static directory.

    CSS: Processes style.css (entry point), resolving all @import statements
         into a single concatenated+minified file.
    JS:  Processes all .js files in static/js/.

    Returns:
        dict: Mapping of original to minified filenames {'css': {...}, 'js': {...}}
    """
    static_dir = app.static_folder
    asset_map = {'css': {}, 'js': {}}

    os.makedirs(os.path.join(static_dir, 'min'), exist_ok=True)

    # ── Minify CSS (entry point resolves @imports) ──
    css_entry = os.path.join(static_dir, 'css', 'style.css')
    if os.path.isfile(css_entry):
        print("Processing CSS entry point (resolving @import modules)...")
        output_path = os.path.join(static_dir, 'min', 'style.min.css')
        minified_filename = minify_css_file(css_entry, output_path)
        if minified_filename:
            asset_map['css']['style.css'] = minified_filename
    else:
        # Fallback: minify all CSS files individually
        css_files = glob.glob(os.path.join(static_dir, 'css', '*.css'))
        for css_file in css_files:
            if '.min.' in css_file:
                continue
            filename = os.path.basename(css_file)
            output_path = os.path.join(static_dir, 'min', f"{os.path.splitext(filename)[0]}.min.css")
            minified_filename = minify_css_file(css_file, output_path)
            if minified_filename:
                asset_map['css'][filename] = minified_filename

    # ── Minify JS files ──
    js_files = glob.glob(os.path.join(static_dir, 'js', '*.js'))
    for js_file in js_files:
        if '.min.' in js_file:
            continue
        filename = os.path.basename(js_file)
        output_path = os.path.join(static_dir, 'min', f"{os.path.splitext(filename)[0]}.min.js")
        minified_filename = minify_js_file(js_file, output_path)
        if minified_filename:
            asset_map['js'][filename] = minified_filename

    # Save the asset map
    asset_map_path = os.path.join(static_dir, 'asset_map.py')
    with open(asset_map_path, 'w', encoding='utf-8') as f:
        f.write(f"# Auto-generated by build.py — do not edit\n\nasset_map = {asset_map}\n")

    return asset_map


def get_minified_url(asset_type, filename):
    """
    Get the URL for a minified asset.

    Args:
        asset_type: 'css' or 'js'
        filename: Original filename (without directory prefix)

    Returns:
        str: URL to the minified asset, or to the original if unavailable
    """
    try:
        import importlib.util

        static_dir = current_app.static_folder
        asset_map_path = os.path.join(static_dir, 'asset_map.py')

        spec = importlib.util.spec_from_file_location("asset_map", asset_map_path)
        asset_map_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(asset_map_module)

        asset_map = getattr(asset_map_module, 'asset_map', {})

        if filename in asset_map.get(asset_type, {}):
            return f"/static/min/{asset_map[asset_type][filename]}"
    except (ImportError, FileNotFoundError):
        pass
    except Exception as e:
        print(f"Error loading asset map: {e}")

    # Fall back to the original file
    return f"/static/{asset_type}/{filename}"


def asset_url(filename):
    """
    Generate URL for an asset, using minified version if available in production.

    Args:
        filename: Path relative to static directory (e.g. 'css/style.css', 'js/main.js')

    Returns:
        str: URL to the asset (minified+hashed in production, original in dev)
    """
    if current_app.config.get('ENV') != 'production':
        return f"/static/{filename}"

    if filename.startswith('css/') and filename.endswith('.css'):
        return get_minified_url('css', filename[4:])   # Strip 'css/' prefix
    elif filename.startswith('js/') and filename.endswith('.js'):
        return get_minified_url('js', filename[3:])     # Strip 'js/' prefix
    else:
        return f"/static/{filename}"
