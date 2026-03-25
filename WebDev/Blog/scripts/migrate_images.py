#!/usr/bin/env python3
"""
One-time migration: generate WebP variants for all existing images,
and (optionally) populate LQIP base64 placeholders in the database.

Usage (from Blog/ root):
    python scripts/migrate_images.py              # WebP only
    python scripts/migrate_images.py --lqip       # WebP + LQIP
    python scripts/migrate_images.py --dry-run    # Preview only
"""
import os, sys, argparse, base64
from io import BytesIO
from pathlib import Path

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

from PIL import Image

WEBP_QUALITY = 80
LQIP_WIDTH = 20


def generate_webp_local(src_path, webp_path, dry_run=False):
    if os.path.exists(webp_path):
        return 'skip'
    if dry_run:
        return 'dry-run'
    try:
        with Image.open(src_path) as img:
            if img.mode == 'RGBA':
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                img = bg
            img.info.pop('exif', None)
            img.info.pop('icc_profile', None)
            img.save(webp_path, format='WEBP', quality=WEBP_QUALITY, method=4)
        return 'ok'
    except Exception as e:
        return f'error: {e}'


def generate_webp_spaces(bucket, src_key, webp_key, dry_run=False):
    try:
        bucket.Object(webp_key).load()
        return 'skip'
    except Exception:
        pass
    if dry_run:
        return 'dry-run'
    try:
        buf = BytesIO()
        bucket.download_fileobj(src_key, buf)
        buf.seek(0)
        with Image.open(buf) as img:
            if img.mode == 'RGBA':
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                img = bg
            img.info.pop('exif', None)
            img.info.pop('icc_profile', None)
            webp_buf = BytesIO()
            img.save(webp_buf, format='WEBP', quality=WEBP_QUALITY, method=4)
            webp_buf.seek(0)
        bucket.upload_fileobj(webp_buf, webp_key, ExtraArgs={
            'ACL': 'public-read', 'ContentType': 'image/webp',
            'CacheControl': 'public, max-age=31536000',
        })
        return 'ok'
    except Exception as e:
        return f'error: {e}'


def generate_lqip(img_source):
    try:
        with Image.open(img_source) as img:
            if img.mode == 'RGBA':
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                img = bg
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            ratio = LQIP_WIDTH / img.width
            new_h = max(1, int(img.height * ratio))
            tiny = img.resize((LQIP_WIDTH, new_h), Image.LANCZOS)
            buf = BytesIO()
            tiny.save(buf, format='JPEG', quality=30, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode('ascii')
            return f'data:image/jpeg;base64,{b64}'
    except Exception as e:
        print(f'    LQIP error: {e}')
        return None


def main():
    parser = argparse.ArgumentParser(description='Migrate images to WebP + LQIP')
    parser.add_argument('--lqip', action='store_true', help='Also generate LQIP (needs DB migration)')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing')
    args = parser.parse_args()

    from app import create_app
    from app.models import Photo
    from app.extensions import db
    from app.utils.image_utils import IMAGE_SIZES, USING_SPACES

    app = create_app()
    with app.app_context():
        photos = Photo.query.all()
        print(f'Found {len(photos)} photos in database.\n')
        if not photos:
            print('Nothing to do.')
            return

        upload_folder = app.config['UPLOAD_FOLDER']
        stats = {'webp_ok': 0, 'webp_skip': 0, 'webp_err': 0, 'lqip_ok': 0, 'lqip_skip': 0}

        bucket = None
        if USING_SPACES:
            from app.utils.s3_utils import get_bucket
            bucket = get_bucket()
            if not bucket:
                print('ERROR: USING_SPACES but no bucket.')
                return

        for photo in photos:
            filename = photo.filename
            name_no_ext, ext = os.path.splitext(filename)
            is_gif = ext.lower() == '.gif'
            print(f'[{photo.id}] {filename}')

            # --- WebP ---
            if not is_gif:
                for size in IMAGE_SIZES:
                    if USING_SPACES:
                        result = generate_webp_spaces(
                            bucket, f'{size}/{filename}',
                            f'{size}/{name_no_ext}.webp', dry_run=args.dry_run)
                    else:
                        src = os.path.join(upload_folder, size, filename)
                        dst = os.path.join(upload_folder, size, f'{name_no_ext}.webp')
                        if not os.path.exists(src):
                            result = f'error: source missing'
                        else:
                            result = generate_webp_local(src, dst, dry_run=args.dry_run)

                    icon = {'ok': '+', 'skip': '-', 'dry-run': '~'}.get(result, '!')
                    print(f'    [{icon}] WebP {size}: {result}')
                    if result == 'ok': stats['webp_ok'] += 1
                    elif result == 'skip': stats['webp_skip'] += 1
                    else: stats['webp_err'] += 1
            else:
                print('    WebP: skipped (GIF)')

            # --- LQIP ---
            if args.lqip:
                if not hasattr(photo, 'lqip'):
                    print('    LQIP ERROR: no "lqip" column. Run DB migration first:')
                    print('      flask --app wsgi db migrate -m "add lqip to photos"')
                    print('      flask --app wsgi db upgrade')
                    return
                if photo.lqip:
                    print('    [-] LQIP: already set')
                    stats['lqip_skip'] += 1
                    continue
                if args.dry_run:
                    print('    [~] LQIP: dry-run')
                    continue

                if USING_SPACES:
                    try:
                        buf = BytesIO()
                        bucket.download_fileobj(f'medium/{filename}', buf)
                        buf.seek(0)
                        lqip = generate_lqip(buf)
                    except Exception as e:
                        lqip = None
                        print(f'    [!] LQIP download error: {e}')
                else:
                    med = os.path.join(upload_folder, 'medium', filename)
                    lqip = generate_lqip(med) if os.path.exists(med) else None

                if lqip:
                    photo.lqip = lqip
                    print(f'    [+] LQIP: {len(lqip)} chars')
                    stats['lqip_ok'] += 1
                else:
                    print(f'    [!] LQIP: failed')

        if args.lqip and not args.dry_run:
            db.session.commit()
            print('\nLQIP committed to database.')

        print(f'\n=== Summary ===')
        print(f'WebP:  {stats["webp_ok"]} created, {stats["webp_skip"]} existed, {stats["webp_err"]} errors')
        if args.lqip:
            print(f'LQIP:  {stats["lqip_ok"]} generated, {stats["lqip_skip"]} skipped')


if __name__ == '__main__':
    main()
