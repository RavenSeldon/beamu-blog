"""API routes: posts listing, image info."""
from flask import Blueprint, request, jsonify

from app.extensions import db, cache
from app.models import Post, Photo, PostImage
from app.utils.image_utils import get_srcset
from app.helpers import published_filter, markdown_safe, strip_gallery_tokens, post_excerpt

api_bp = Blueprint('api', __name__)


@api_bp.route('/api/posts')
@cache.cached(query_string=True)
def api_posts():
    try:
        offset = max(int(request.args.get('offset', 0)), 0)
        limit = min(max(int(request.args.get('limit', 10)), 1), 25)
    except ValueError:
        offset = 0
        limit = 10

    query = (
        published_filter(Post.query)
        .options(
            db.joinedload(Post.photo),
            db.joinedload(Post.project),
            db.selectinload(Post.tags),
            db.selectinload(Post.images).joinedload(PostImage.photo),
        )
        .order_by(Post.date_posted.desc())
    )

    # Fetch one extra row so we can determine whether more posts exist.
    posts = query.offset(offset).limit(limit + 1).all()
    has_next = len(posts) > limit
    posts = posts[:limit]

    serialized_posts = []

    for post_item in posts:
        truncated_content = str(post_excerpt(post_item, length=300))

        card_photo = post_item.photo
        if card_photo is None:
            first_inline = next(
                (
                    image
                    for image in sorted(post_item.images, key=lambda image: image.position or 0)
                    if image.photo and image.photo.filename
                ),
                None
            )
            card_photo = first_inline.photo if first_inline else None

        item_data = {
            'id': post_item.id,
            'type': post_item.type,
            'title': post_item.title,
            'content': truncated_content,
            'date_posted': post_item.date_posted.strftime('%Y-%m-%d'),
            'photo_filename': card_photo.filename if card_photo else None,
            'photo_is_inline_fallback': bool(card_photo and post_item.photo is None),
            'github_link': post_item.github_link,
            'project_id': post_item.project_id,
            'project_title': post_item.project.title if post_item.project else None,
            'tags': [tag.name for tag in post_item.tags] if post_item.tags else []
        }

        if post_item.type == 'music_item':
            item_data.update({
                'item_type': post_item.item_type,
                'artist': post_item.artist,
                'album_title': post_item.album_title,
                'spotify_link': post_item.spotify_link,
                'youtube_link': post_item.youtube_link,
            })

        elif post_item.type == 'video':
            item_data.update({
                'video_url': post_item.video_url,
                'embed_code': post_item.embed_code,
                'source_type': post_item.source_type,
                'duration': post_item.duration,
            })

        elif post_item.type == 'review':
            item_data.update({
                'item_title': post_item.item_title,
                'category': post_item.category,
                'rating': post_item.rating,
                'year_released': post_item.year_released,
                'director_author': post_item.director_author,
                'item_link': post_item.item_link,
            })

        serialized_posts.append(item_data)

    return jsonify({
        'posts': serialized_posts,
        'has_next': has_next,
        'offset': offset,
        'limit': limit,
        'next_offset': offset + len(serialized_posts)
    })


@api_bp.route('/api/image-info/<int:photo_id>')
def image_info(photo_id):
    """Return responsive image information for a given photo."""
    photo = db.session.get(Photo, photo_id)
    if not photo:
        return jsonify({'error': 'No file found'}), 404

    return jsonify({
        'photo_id': photo.id,
        'filename': photo.filename,
        'description': photo.description,
        'srcset': get_srcset(photo.filename),
        'sizes': '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 800px'
    })
