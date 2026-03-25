"""API routes: posts listing, image info."""
from flask import Blueprint, request, jsonify

from app.extensions import db, cache
from app.models import Post, Photo
from app.utils.image_utils import get_srcset
from app.helpers import published_filter

api_bp = Blueprint('api', __name__)


@api_bp.route('/api/posts')
@cache.cached(query_string=True)
def api_posts():
    page = int(request.args.get('page', 1))
    per_page = 10

    query = (
        published_filter(Post.query)
        .options(
            db.joinedload(Post.photo),
            db.joinedload(Post.project),
            db.selectinload(Post.tags),
        )
        .order_by(Post.date_posted.desc())
    )
    posts_pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    serialized_posts = []
    for post_item in posts_pagination.items:
        item_data = {
            'id': post_item.id,
            'type': post_item.type,
            'title': post_item.title,
            'content': (post_item.content or '')[:300] + ('...' if post_item.content and len(post_item.content) > 300 else ''),
            'date_posted': post_item.date_posted.strftime('%Y-%m-%d'),
            'photo_filename': post_item.photo.filename if post_item.photo else None,
            'github_link': post_item.github_link,
            'project_id': post_item.project_id,
            'project_title': post_item.project.title if post_item.project else None,
            'tags': [tag.name for tag in post_item.tags] if post_item.tags else []
        }
        if post_item.type == 'music_item':
            item_data.update({
                'item_type': post_item.item_type, 'artist': post_item.artist,
                'album_title': post_item.album_title, 'spotify_link': post_item.spotify_link,
                'youtube_link': post_item.youtube_link,
            })
        elif post_item.type == 'video':
            item_data.update({
                'video_url': post_item.video_url, 'embed_code': post_item.embed_code,
                'source_type': post_item.source_type, 'duration': post_item.duration,
            })
        elif post_item.type == 'review':
            item_data.update({
                'item_title': post_item.item_title, 'category': post_item.category,
                'rating': post_item.rating, 'year_released': post_item.year_released,
                'director_author': post_item.director_author, 'item_link': post_item.item_link,
            })
        serialized_posts.append(item_data)

    return jsonify({
        'posts': serialized_posts,
        'has_next': posts_pagination.has_next,
        'current_page': posts_pagination.page,
        'total_pages': posts_pagination.pages
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
