import os
import boto3
from botocore.client import Config

# Cache the S3 client to avoid creating it multiple times
_s3_resource = None
_bucket = None


def get_s3_resource():
    """
    Get or create the S3 resource for Digital Ocean Spaces.
    Returns None if not configured.
    """
    global _s3_resource

    if _s3_resource is None and os.environ.get('DO_SPACE_KEY'):
        _s3_resource = boto3.resource('s3', endpoint_url=f"https://{os.environ.get('DO_SPACE_REGION')}.digitaloceanspaces.com",
                                      aws_access_key_id=os.environ.get('DO_SPACE_KEY'),
                                      aws_secret_access_key=os.environ.get('DO_SPACE_SECRET'),
                                      config=Config(signature_version='s3v4')
                                      )

    return _s3_resource

def get_bucket():
    """
    Get or create the S3 bucket object.
    Returns None if not configured.
    """
    global _bucket

    if _bucket is None and os.environ.get('DO_SPACE_NAME'):
        s3 = get_s3_resource()
        if s3:
            _bucket = s3.Bucket(os.environ.get('DO_SPACE_NAME'))

    return _bucket

def delete_file(path):
    """
    Delete a file from the S3 bucket.
    """
    bucket = get_bucket()
    if bucket:
        return bucket.Object(path).delete()
    return None


def upload_file(file_obj, path, content_type=None, acl='public-read'):
    """
    Upload a file to the s3 bucket with detailed error reporting
    """
    print(f"Attempting to upload file to path: {path}")
    print(f"Content-Type: {content_type}, ACL: {acl}")

    bucket = get_bucket()
    if bucket:
        try:
            extra_args = {'ACL': acl}
            if content_type:
                extra_args['ContentType'] = content_type

            print(f"Extra args: {extra_args}")

            # Try to upload
            result = bucket.upload_fileobj(file_obj, path, ExtraArgs=extra_args)
            print(f"Upload successful, result: {result}")
            return True
        except Exception as e:
            print(f"Error uploading file to {path}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    else:
        print("Cannot upload - bucket is None")
        return False

def delete_files(paths):
    """
    Delete multiple files from the S3 bucket.
    """
    bucket = get_bucket()
    if bucket and paths:
        objects = [{'Key': path} for path in paths if path]
        if objects:
            return bucket.delete_objects(Delete={'Objects': objects})
    return None

