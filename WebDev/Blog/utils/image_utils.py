import os
from PIL import Image
from io import BytesIO
import re
import boto3
from botocore.client import Config
from werkzeug.utils import secure_filename

# Define max dimensions for different image sizes
IMAGE_SIZES = {
    'thumbnail': (300, 300),
    'medium': (800, 800),
    'large': (1200, 1200)
}

# JPEG compression quality (1-100)
JPEG_QUALITY = 85

# Check if we're in production with Spaces configured
if os.environ.get('DO_SPACE_KEY'):
    s3 = boto3.resource('s3',
        endpoint_url=f"https://{os.environ.get('DO_SPACE_REGION')}.digitaloceanspaces.com",
        aws_access_key_id=os.environ.get('DO_SPACE_KEY'),
        aws_secret_access_key=os.environ.get('DO_SPACE_SECRET'),
        config=Config(signature_version='s3v4')
    )
    DO_SPACE = s3.Bucket(os.environ.get('DO_SPACE_NAME'))
    SPACES_URL = f"https://{os.environ.get('DO_SPACE_NAME')}.{os.environ.get('DO_SPACE_REGION')}.digitaloceanspaces.com"
    USING_SPACES = True
else:
    USING_SPACES = False
    SPACES_URL = None

def optimize_image(img, output_path, max_size, quality=JPEG_QUALITY):
    """
    Resizes and compresses an image while maintaining aspect ratio
    """
    try:
        if isinstance(img, str):
            img = Image.open(img)

        # Convert RGBA to RGB for JPEG (if needed)
        if img.mode == 'RGBA':
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])  # Use alpha channel as mask
            img = bg

        # Calculate new dimensions while preserving aspect ratio
        width, height = img.size
        ratio = min(max_size[0] / width, max_size[1] / height)

        # Only resize if the image is larger than max_size
        if ratio < 1:
            new_width = int(width * ratio)
            new_height = int(height * ratio)
            img = img.resize((new_width, new_height), Image.LANCZOS)

        # Determine output format based on original
        format = img.format if img.format else os.path.splitext(output_path)[1][1:].upper()
        if format.lower() not in ['jpeg', 'jpg', 'png', 'gif']:
            format = 'JPEG'

        # Save to BytesIO object for either filesystem or cloud storage
        img_io = BytesIO()
        img.save(img_io, format=format, quality=quality, optimize=True)
        img_io.seek(0)

        if USING_SPACES and not output_path.startswith('/'):
            # For DO Spaces, upload to appropriate path
            content_type = f"image/{format.lower()}"
            DO_SPACE.upload_fileobj(
                img_io,
                output_path,
                ExtraArgs={
                    'ContentType': content_type,
                    'ACL': 'public-read'
                }
            )
        else:
            # For local filesystem
            # Create directory if it doesn't exist
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Save the optimized image to disk
            with open(output_path, 'wb') as f:
                f.write(img_io.getvalue())

        return True

    except Exception as e:
        print(f"Error optimizing image: {e}")
        return False


def process_upload_image(uploaded_file, upload_folder, filename=None):
    """
    Process an uploaded image file:
    1. Secure the filename
    2. Create optimized versions
    3. Return paths to the optimized images
    """
    if not uploaded_file:
        return None

    # Secure the filename
    if not filename:
        filename = secure_filename(uploaded_file.filename)

    # Ensure filename is unique
    base_name, extension = os.path.splitext(filename)
    extension = extension.lower()

    # Only process image files
    if extension not in ['.jpg', '.jpeg', '.png', '.gif']:
        return None

    # Create directories if they don't exist
    if not USING_SPACES:
        for size in IMAGE_SIZES:
            size_folder = os.path.join(upload_folder, size)
            os.makedirs(size_folder, exist_ok=True)

    # Store original file paths
    paths = {}

    try:
        # Open the image with PIL
        img = Image.open(uploaded_file)

        # Create resized versions
        for size, dimensions in IMAGE_SIZES.items():
            if USING_SPACES:
                # For DO Spaces, use path format size/filename
                size_path = f"{size}/{filename}"

                if optimize_image(img, size_path, dimensions):
                    # Store the relative path to be used in templates
                    paths[size] = f"{size}/{filename}"

            else:
                # For local filesystem
                size_path = os.path.join(upload_folder, size, filename)

                if optimize_image(img, size_path, dimensions):
                    # Store the relative path to be used in templates
                    paths[size] = os.path.join(size, filename)

        # If original size is needed, save it too
        # orig_path = os.path.join(upload_folder, 'original', filename)
        # os.makedirs(os.path.dirname(orig_path), exist_ok=True)
        # img.save(orig_path)

        return paths

    except Exception as e:
        print(f"Error processing uploaded image: {e}")
        return None


# Helper function to generate srcset for responsive images
def get_srcset(filename):
    """
    Generate srcset attribute for responsive images
    """
    if not filename:
        return ""

    base_name = os.path.basename(filename)
    srcset = []

    for size, dimensions in IMAGE_SIZES.items():
        # Use the maximum dimension for the width descriptor
        max_dim = max(dimensions)

        if USING_SPACES:
            # For DO Spaces, construct full URL
            path = f"{SPACES_URL}/{size}/{base_name}"
        else:
            # For local filesystem
            path = f"/static/images/{size}/{base_name}"

        srcset.append(f"{path} {max_dim}w")

    return ", ".join(srcset)