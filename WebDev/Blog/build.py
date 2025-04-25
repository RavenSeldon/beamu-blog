"""
Build script for preparing the application for production.
Minifies CSS and JS files, optimizes images, and prepares static assets.

Run this script before deploying to production:
python build.py
"""

import os
import sys
import glob
import shutil
import argparse
from PIL import Image
import time

# Make sure the application directory is in the Python path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

# Try to import the application and utilities
try:
    from app import app
    from utils.image_utils import optimize_image, IMAGE_SIZES
    from utils.minify_utils import minify_all_assets
except ImportError as e:
    print(f"Error importing application modules: {e}")
    print("Make sure you're running this script from the project root directory")
    sys.exit(1)


def optimize_all_images(static_dir, force=False):
    """
    Optimize all images in the static/images directory.

    Args:
        static_dir: Path to the static directory
        force: Whether to force re-optimization of already optimized images
    """
    images_dir = os.path.join(static_dir, 'images')
    if not os.path.exists(images_dir):
        print(f"Images directory not found: {images_dir}")
        return

    # Create size directories if they don't exist
    for size in IMAGE_SIZES:
        size_dir = os.path.join(images_dir, size)
        os.makedirs(size_dir, exist_ok=True)

    # Find all images in the top-level images directory
    image_patterns = ['*.jpg', '*.jpeg', '*.png', '*.gif']
    image_files = []
    for pattern in image_patterns:
        image_files.extend(glob.glob(os.path.join(images_dir, pattern)))

    if not image_files:
        print("No images found to optimize")
        return

    print(f"Found {len(image_files)} images to optimize")

    # Process each image
    for image_file in image_files:
        filename = os.path.basename(image_file)

        # Skip already processed images
        if os.path.dirname(image_file).endswith(tuple(IMAGE_SIZES.keys())):
            continue

        print(f"Processing {filename}...")

        # Create optimized versions for each size
        for size, dimensions in IMAGE_SIZES.items():
            output_path = os.path.join(images_dir, size, filename)

            # Skip if file exists and not forcing re-optimization
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
    """
    Clean up previous build artifacts.

    Args:
        static_dir: Path to the static directory
    """
    min_dir = os.path.join(static_dir, 'min')
    if os.path.exists(min_dir):
        print(f"Cleaning up previous build artifacts in {min_dir}")
        shutil.rmtree(min_dir)
        os.makedirs(min_dir, exist_ok=True)

    # Also remove the asset map
    asset_map_path = os.path.join(static_dir, 'asset_map.py')
    if os.path.exists(asset_map_path):
        os.remove(asset_map_path)


def main():
    parser = argparse.ArgumentParser(description='Build script for production')
    parser.add_argument('--clean', action='store_true', help='Clean previous build artifacts')
    parser.add_argument('--force', action='store_true', help='Force re-optimization of images')
    parser.add_argument('--images-only', action='store_true', help='Only optimize images')
    parser.add_argument('--minify-only', action='store_true', help='Only minify CSS/JS')
    args = parser.parse_args()

    # Get the static directory from the Flask app
    static_dir = app.static_folder

    start_time = time.time()

    print("=== Starting production build ===")

    # Clean up if requested
    if args.clean:
        clean_build_artifacts(static_dir)

    # Minify CSS and JS
    if not args.images_only:
        print("\n=== Minifying CSS and JS files ===")
        asset_map = minify_all_assets(app)
        print(f"Minified {len(asset_map.get('css', {}))} CSS files and {len(asset_map.get('js', {}))} JS files")

    # Optimize images
    if not args.minify_only:
        print("\n=== Optimizing images ===")
        optimize_all_images(static_dir, force=args.force)

    # Report results
    end_time = time.time()
    print(f"\n=== Build completed in {end_time - start_time:.2f} seconds ===")

    print("\nTo use optimized assets in production, set the FLASK_ENV environment variable to 'production'")
    print("Example: export FLASK_ENV=production")


if __name__ == '__main__':
    main()