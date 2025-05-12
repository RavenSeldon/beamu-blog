import os
from PIL import Image
from io import BytesIO
import re
from werkzeug.utils import secure_filename
from .s3_utils import upload_file, get_bucket
import traceback

# Define max dimensions for different image sizes
IMAGE_SIZES = {
    'thumbnail': (300, 300),
    'medium': (800, 800),
    'large': (1200, 1200)
}

# JPEG compression quality (1-100)
JPEG_QUALITY = 85

space_name = os.environ.get('DO_SPACE_NAME')
space_region = os.environ.get('DO_SPACE_REGION')

# Check if we're in production with Spaces configured
USING_SPACES = bool(os.environ.get('DO_SPACE_KEY'))
if USING_SPACES:
    # Construct CDN URL
    if space_name and space_region: # Ensure the variables are set
        SPACES_URL = f"https://{space_name}.{space_region}.cdn.digitaloceanspaces.com"
    else:
        print(f"Error loading DO_SPACE_NAME or DO_SPACE_REGION environment variables")
        SPACES_URL = None
else:
    SPACES_URL = None

def optimize_image(img, output_path, max_size, quality=JPEG_QUALITY):
    """
    Resizes and compresses an image while maintaining aspect ratio
    """
    print(f"Optimizing image to: {output_path} with size: {max_size}")
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
        ext = os.path.splitext(output_path)[1][1:].upper()

        # Fix format name - JPG should be JPEG for PIL
        if ext == 'JPG':
            format = 'JPEG'
        elif ext in ['JPEG', 'PNG', 'GIF']:
            format = ext
        else:
            format = 'JPEG'

        print(f"Using format: {format} for saving")

        # Save to BytesIO object for either filesystem or cloud storage
        img_io = BytesIO()
        img.save(img_io, format=format, quality=quality, optimize=True)
        img_io.seek(0)

        if USING_SPACES and not output_path.startswith('/'):
            # For DO Spaces, upload to appropriate path
            content_type = f"image/{format.lower()}"
            return upload_file(img_io, output_path, content_type=content_type)
        else:
            # For local filesystem
            dir_path = os.path.dirname(output_path)
            print(f"Creating directory: {dir_path}")
            # Create directory if it doesn't exist
            os.makedirs(dir_path, exist_ok=True)
            print(f"Directory exists after makedirs: {os.path.exists(dir_path)}")

            # Save the optimized image to disk
            print(f"Writing to file: {output_path}")
            with open(output_path, 'wb') as f:
                f.write(img_io.getvalue())
            print(f"File exists after write: {os.path.exists(output_path)}")

        return True

    except Exception as e:
        print(f"Error optimizing image: {e}")
        traceback.print_exc()
        return False


def process_upload_image(uploaded_file, upload_folder, filename=None):
    """
    Process an uploaded image file:
    1. Secure the filename
    2. Create optimized versions
    3. Return paths to the optimized images
    """

    if not uploaded_file:
        print("No file provided to process_upload_image")
        return None

    # Ensure upload directory exists
    if not os.path.exists(upload_folder):
        print(f"Creating upload directory: {upload_folder}")
        os.makedirs(upload_folder, exist_ok=True)

    # Secure the filename
    if not filename:
        filename = secure_filename(uploaded_file.filename)

    print(f"Processing upload for file: {filename}")
    print(f"Upload folder: {upload_folder}")
    print(f"Upload folder exists: {os.path.exists(upload_folder)}")

    # Ensure filename is unique
    base_name, extension = os.path.splitext(filename)
    extension = extension.lower()

    # Only process image files
    if extension not in ['.jpg', '.jpeg', '.png', '.gif']:
        print(f"Invalid file extension: {extension}")
        return None

    # Store original file paths
    paths = {}

    try:
        # Save uploaded file to temp location
        temp_path = os.path.join(upload_folder, "temp_" + filename)
        print(f"Saving temp file to: {temp_path}")
        uploaded_file.save(temp_path)
        print(f"Temp file exists: {os.path.exists(temp_path)}")
        print(f"Temp file size: {os.path.getsize(temp_path) if os.path.exists(temp_path) else 'N/A'}")

        # Create directories if they don't exist
        if not USING_SPACES:
            for size in IMAGE_SIZES:
                size_folder = os.path.join(upload_folder, size)
                print(f"Creating directory: {size_folder}")
                os.makedirs(size_folder, exist_ok=True)
                print(f"Directory exists: {os.path.exists(size_folder)}")

        # Create resized versions
        for size, dimensions in IMAGE_SIZES.items():
            try:
                # Reopen the image for each size
                with Image.open(temp_path) as img:
                    if USING_SPACES:
                        # For DO Spaces, use path format size/filename
                        size_path = f"{size}/{filename}"
                        print(f"Processing {size} for DO Spaces: {size_path}")

                        if optimize_image(img, size_path, dimensions):
                            # Store the relative path to be used in templates
                            paths[size] = f"{size}/{filename}"
                            print(f"Successfully saved {size} to Spaces")

                    else:
                        # For local filesystem
                        size_path = os.path.join(upload_folder, size, filename)
                        print(f"Processing size {size} to path: {size_path}")

                        if optimize_image(img, size_path, dimensions):
                            # Store the relative path to be used in templates
                            paths[size] = os.path.join(size, filename)
                            print(f"Successfully saved {size} version to {size_path}")
                        else:
                            print(f"Failed to save {size} version to {size_path}")

            except Exception as size_error:
                print(f"Error processing size {size}: {str(size_error)}")
                traceback.print_exc()

        # If original size is needed, save it too
        # orig_path = os.path.join(upload_folder, 'original', filename)
        # os.makedirs(os.path.dirname(orig_path), exist_ok=True)
        # img.save(orig_path)

        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return paths

    except Exception as e:
        print(f"Error processing uploaded image: {e}")
        traceback.print_exc()
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