"""
Build script for preparing the application for production.
Minifies CSS and JS files, optimizes images, and prepares static assets.

Run this script before deploying to production:
    python build.py              # Full build (clean + minify + images)
    python build.py --minify-only
    python build.py --images-only
    python build.py --force      # Re-optimize existing images
"""

import os
import sys
import glob
import shutil
import argparse
from PIL import Image
import time

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

try:
    from app import create_app
    from app.utils.image_utils import optimize_image, IMAGE_SIZES
    from app.utils.minify_utils import minify_all_assets
except ImportError as e:
    print(f"Error importing application modules: {e}")
    print("Make sure you're running this script from the project root directory")
    sys.exit(1)

app = create_app()


def optimize_all_images(static_dir, force=False):
    """Optimize all images in static/images/ into size subdirectories."""
    images_dir = os.path.join(static_dir, 'images')
    if not os.path.exists(images_dir):
        print(f"Images directory not found: {images_dir}")
        return

    for size in IMAGE_SIZES:
        os.makedirs(os.path.join(images_dir, size), exist_ok=True)

    image_patterns = ['*.jpg', '*.jpeg', '*.png', '*.gif']
    image_files = []
    for pattern in image_patterns:
        image_files.extend(glob.glob(os.path.join(images_dir, pattern)))

    if not image_files:
        print("No images found to optimize")
        return

    print(f"Found {len(image_files)} images to optimize")

    for image_file in image_files:
        filename = os.path.basename(image_file)
        if os.path.dirname(image_file).endswith(tuple(IMAGE_SIZES.keys())):
            continue

        print(f"Processing {filename}...")

        for size, dimensions in IMAGE_SIZES.items():
            output_path = os.path.join(images_dir, size, filename)
            if os.path.exists(output_path) and not force:
                print(f"  {size} version already exists, skipping")
                continue

            try:
                with Image.open(image_file) as img:
                    optimize_image(img, output_path, dimensions)
                    print(f"  Created {size} version")
            except Exception as e:
                print(f"  Error creating {size} version: {e}")


def clean_build_artifacts(static_dir):
    """Remove previous build artifacts (static/min/ and asset_map.py)."""
    min_dir = os.path.join(static_dir, 'min')
    if os.path.exists(min_dir):
        print(f"Cleaning previous build artifacts in {min_dir}")
        shutil.rmtree(min_dir)
    os.makedirs(min_dir, exist_ok=True)

    asset_map_path = os.path.join(static_dir, 'asset_map.py')
    if os.path.exists(asset_map_path):
        os.remove(asset_map_path)
        print("Removed old asset_map.py")


def main():
    parser = argparse.ArgumentParser(description='Build script for production')
    parser.add_argument('--no-clean', action='store_true', help='Skip cleaning previous build artifacts')
    parser.add_argument('--force', action='store_true', help='Force re-optimization of images')
    parser.add_argument('--images-only', action='store_true', help='Only optimize images')
    parser.add_argument('--minify-only', action='store_true', help='Only minify CSS/JS')
    args = parser.parse_args()

    static_dir = app.static_folder
    start_time = time.time()

    print("=== Starting production build ===")

    # Always clean unless explicitly skipped
    if not args.no_clean:
        clean_build_artifacts(static_dir)

    # Minify CSS and JS
    if not args.images_only:
        print("\n=== Minifying CSS and JS files ===")
        with app.app_context():
            asset_map = minify_all_assets(app)
        css_count = len(asset_map.get('css', {}))
        js_count = len(asset_map.get('js', {}))
        print(f"Minified {css_count} CSS file(s) and {js_count} JS file(s)")

    # Optimize images
    if not args.minify_only:
        print("\n=== Optimizing images ===")
        optimize_all_images(static_dir, force=args.force)

    end_time = time.time()
    print(f"\n=== Build completed in {end_time - start_time:.2f} seconds ===")
    print("\nTo use optimized assets, set: export FLASK_ENV=production")


if __name__ == '__main__':
    main()
