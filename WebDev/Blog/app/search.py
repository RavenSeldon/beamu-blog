"""
Site-wide search: index sync helpers + dialect-aware query layer.

The search architecture is a single denormalized `search_index` table
(app.models.SearchDocument) covering Posts (all subtypes) and Projects.

Sync model: EXPLICIT calls from every create/edit/delete route, in the same
transaction as the source change (mirroring how sync_post_images() is invoked).
SQLAlchemy event listeners were deliberately avoided — explicit sync matches
the codebase's pattern and is easier to reason about with Neon's NullPool.
`flask search reindex` is a recovery/backfill tool only.

Query model:
    - Postgres: full-text search against the `search_vector` generated column
      (created in the Alembic migration, NOT ORM-mapped), via raw SQL.
    - SQLite (local dev fallback): case-insensitive LIKE over
      title/keywords/body with AND semantics per term.

Deferred (v2+), noted here once for the whole module:
    - Structured tag storage + tag filtering (tag names are currently indexed
      as plain text inside `keywords`, so searching a tag name works as FTS).
    - Gallery caption/alt-text indexing.
    - Cache version-token invalidation for /api/search.
    - pg_trgm trigram index for typo tolerance (Neon supports the extension).
    - SQLite FTS5 virtual table instead of the LIKE fallback.
    - Search analytics (log zero-result queries).
"""
import re
from datetime import datetime, timezone

import markdown
import sqlalchemy as sa
from bs4 import BeautifulSoup
from flask import url_for
from markupsafe import escape

from app.extensions import db
from app.helpers import strip_gallery_tokens_preserve_blocks

# ── Tunables ────────────────────────────────────────────────────────────────
BODY_MAX_CHARS = 50_000          # cap indexed body text (~50KB)
QUERY_MAX_CHARS = 100            # hard cap on raw query length
QUERY_MIN_CHARS = 2              # minimum query length
MAX_QUERY_TERMS = 8              # cap parsed terms (LIKE path / prefix branch)
SNIPPET_WINDOW = 120             # ± chars around first hit (SQLite snippets)
FALLBACK_EXCERPT_CHARS = 160     # body-start excerpt when no body match

SEARCHABLE_ENTITY_TYPES = ('post', 'music_item', 'video', 'review', 'project')

# Sentinels for ts_headline highlighting. The raw headline text is escaped
# BEFORE these are swapped for real <mark> tags, so body content can never
# smuggle HTML into the snippet.
_HL_START = '@@HL@@'
_HL_END = '@@/HL@@'
_TS_HEADLINE_OPTS = (
    f'StartSel={_HL_START}, StopSel={_HL_END}, MaxWords=30, MinWords=10'
)


# ─────────────────────────────────────────────────────────────────────────────
#  Phase 2 — document building + sync
# ─────────────────────────────────────────────────────────────────────────────

def _markdown_to_text(md_text):
    """Render Markdown to plain text (for indexing, never for display)."""
    if not md_text:
        return ""
    html = markdown.markdown(md_text, extensions=['fenced_code', 'tables'])
    text = BeautifulSoup(html, 'html.parser').get_text(' ')
    return re.sub(r'\s{2,}', ' ', text).strip()


def _plain_body(raw):
    """Gallery tokens stripped -> Markdown rendered to text -> truncated."""
    return _markdown_to_text(strip_gallery_tokens_preserve_blocks(raw or ''))[:BODY_MAX_CHARS]


def build_search_document(obj):
    """Map a Post (any subtype) or Project to SearchDocument field values.

    Returns a dict suitable for constructing/updating a SearchDocument row.
    Keywords carry tags plus the subtype-specific fields (weight B in the
    Postgres tsvector); body is the plain-text content (weight C).

    NOTE: gallery captions/alt text are intentionally NOT indexed in v1
    (deferred — see module docstring).
    """
    from app.models import Post, Project

    if isinstance(obj, Project):
        return {
            'entity_type': 'project',
            'entity_id': obj.id,
            'title': (obj.title or '')[:256],
            'keywords': '',
            'body': _plain_body(obj.description),
            'date_posted': obj.date_posted,
            'published_at': None,  # Projects have no scheduling — always visible
        }

    if not isinstance(obj, Post):
        raise TypeError(f"build_search_document() got unsupported object: {obj!r}")

    keyword_parts = [t.name for t in obj.tags]

    if obj.type == 'music_item':
        keyword_parts += [obj.artist, obj.album_title, obj.item_type]
    elif obj.type == 'video':
        keyword_parts += [obj.source_type]
    elif obj.type == 'review':
        keyword_parts += [obj.item_title, obj.category, obj.director_author]

    return {
        'entity_type': obj.type,
        'entity_id': obj.id,
        'title': (obj.title or '')[:256],
        'keywords': ' '.join(p for p in keyword_parts if p),
        'body': _plain_body(obj.content),
        'date_posted': obj.date_posted,
        'published_at': obj.published_at,
    }


def sync_search_document(obj):
    """Upsert the SearchDocument row for a Post/Project (by entity_type+id).

    Call inside the same transaction as the source change, after the object's
    fields (and tags) are final. Flushes so a freshly-added object has an id.
    The caller commits.
    """
    from app.models import SearchDocument

    db.session.flush()  # guarantee obj.id exists for new objects
    fields = build_search_document(obj)

    doc = SearchDocument.query.filter_by(
        entity_type=fields['entity_type'], entity_id=fields['entity_id']
    ).first()
    if doc is None:
        doc = SearchDocument(**fields)
        db.session.add(doc)
    else:
        for key, value in fields.items():
            setattr(doc, key, value)
    return doc


def delete_search_document(entity_type, entity_id):
    """Remove the SearchDocument row for a deleted entity (caller commits)."""
    from app.models import SearchDocument

    SearchDocument.query.filter_by(
        entity_type=entity_type, entity_id=entity_id
    ).delete(synchronize_session=False)


def rebuild_search_index():
    """Full re-index: recovery/backfill tool only (`flask search reindex`).

    Idempotent — wipes the table and rebuilds from source rows, so repeated
    runs never create duplicates. Eager-loads tags to avoid N+1 queries.
    Returns the number of indexed documents.
    """
    from app.models import Post, Project, SearchDocument

    SearchDocument.query.delete(synchronize_session=False)
    # Flush the wipe and drop any stale SearchDocument identities so re-added
    # rows can't collide with previously-loaded instances in this session.
    db.session.flush()
    db.session.expunge_all()

    count = 0
    posts = Post.query.options(sa.orm.selectinload(Post.tags)).all()
    for post in posts:
        db.session.add(SearchDocument(**build_search_document(post)))
        count += 1

    for project in Project.query.all():
        db.session.add(SearchDocument(**build_search_document(project)))
        count += 1

    db.session.commit()
    return count


# ─────────────────────────────────────────────────────────────────────────────
#  Phase 3 — query layer
# ─────────────────────────────────────────────────────────────────────────────

def _sanitize_query(q):
    """Strip + cap the raw query. Returns '' when below the minimum length."""
    q = (q or '').strip()[:QUERY_MAX_CHARS]
    return q if len(q) >= QUERY_MIN_CHARS else ''


def _prefix_tsquery(q):
    """Build a safe to_tsquery prefix expression ('term1 & term2:*') for
    typeahead, using only normalized alphanumeric lexemes. Returns None when
    the input can't be safely converted — the caller then skips the prefix
    branch (websearch_to_tsquery alone handles arbitrary input safely).
    """
    tokens = re.findall(r'[a-z0-9]+', q.lower())[:MAX_QUERY_TERMS]
    if not tokens:
        return None
    return ' & '.join([*tokens[:-1], tokens[-1] + ':*'])


def _escape_headline(raw):
    """Escape a ts_headline result, then swap sentinels for real <mark> tags.

    Order matters: everything except the <mark> tags themselves must be
    escaped, because body text is stored unescaped in the index.
    """
    return (
        str(escape(raw))
        .replace(_HL_START, '<mark>')
        .replace(_HL_END, '</mark>')
    )


def _like_terms(q):
    """Whitespace-split terms for the SQLite LIKE path (AND semantics)."""
    return [t for t in q.split() if t][:MAX_QUERY_TERMS]


def _escape_like(term):
    """Escape LIKE wildcards in a user term (used with ilike(..., escape='\\'))."""
    return term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def _sqlite_snippet(body, terms):
    """Manual ±SNIPPET_WINDOW-char snippet around the first term hit in body.

    Matched terms are wrapped in <mark>; all surrounding text is escaped
    BEFORE marks are inserted. Returns None when no term occurs in body.
    """
    if not body:
        return None
    lower = body.lower()
    first = -1
    for t in terms:
        p = lower.find(t.lower())
        if p != -1 and (first == -1 or p < first):
            first = p
    if first == -1:
        return None

    start = max(0, first - SNIPPET_WINDOW)
    end = min(len(body), first + SNIPPET_WINDOW)
    window = body[start:end]

    pattern = re.compile(
        '|'.join(re.escape(t) for t in sorted(terms, key=len, reverse=True)),
        re.IGNORECASE,
    )
    parts, last = [], 0
    for m in pattern.finditer(window):
        parts.append(str(escape(window[last:m.start()])))
        parts.append('<mark>' + str(escape(m.group(0))) + '</mark>')
        last = m.end()
    parts.append(str(escape(window[last:])))

    prefix = '…' if start > 0 else ''
    suffix = '…' if end < len(body) else ''
    return prefix + ''.join(parts) + suffix


def _entity_meta(entity_type, entity):
    """Short per-type metadata string for result display (plain text)."""
    if entity is None:
        return None
    if entity_type == 'review':
        title_part = entity.item_title or ''
        if entity.year_released:
            title_part = f'{title_part} ({entity.year_released})'.strip()
        parts = [
            (entity.category or '').replace('_', ' ').title() or None,
            title_part or None,
            entity.rating or None,
        ]
    elif entity_type == 'music_item':
        parts = [
            (entity.item_type or '').replace('_', ' ').title() or None,
            entity.artist,
            entity.album_title,
        ]
    elif entity_type == 'video':
        parts = [
            (entity.source_type or '').title() or None,
            entity.duration,
        ]
    elif entity_type == 'project':
        parts = ['Project']
    else:
        parts = []
    meta = ' · '.join(p for p in parts if p)
    return meta or None


def _result_url(entity_type, entity_id):
    """Canonical URL per entity type (blueprint-qualified endpoint names,
    confirmed against app/routes/posts.py and app/routes/projects.py)."""
    if entity_type == 'project':
        return url_for('projects_bp.project_detail', project_id=entity_id)
    return url_for('posts.post', post_id=entity_id)


def _snippet_fallback(snippet, body, entity_type, entity):
    """Fallback chain: body-match snippet -> escaped body-start excerpt ->
    metadata-derived snippet. Only <mark> tags are unescaped in the output."""
    if snippet and '<mark>' in snippet:
        return snippet
    if body:
        excerpt = body[:FALLBACK_EXCERPT_CHARS].strip()
        if excerpt:
            suffix = '…' if len(body) > FALLBACK_EXCERPT_CHARS else ''
            return str(escape(excerpt)) + suffix
    meta = _entity_meta(entity_type, entity)
    return str(escape(meta)) if meta else ''


def _load_entities(rows):
    """Batch-fetch the source Post/Project rows for a page of index rows.

    Returns {(entity_type, entity_id): entity}. Index rows whose source has
    vanished (stale index) get None and are dropped by the caller — this also
    guarantees every returned URL resolves to a live entity.
    """
    from app.models import Post, Project

    post_ids = [r['entity_id'] for r in rows if r['entity_type'] != 'project']
    project_ids = [r['entity_id'] for r in rows if r['entity_type'] == 'project']

    entities = {}
    if post_ids:
        for p in Post.query.filter(Post.id.in_(post_ids)).all():
            entities[(p.type, p.id)] = p
    if project_ids:
        for pr in Project.query.filter(Project.id.in_(project_ids)).all():
            entities[('project', pr.id)] = pr
    return entities


def _visibility_now():
    """Visibility cutoff matching published_filter() semantics exactly:
    published_at IS NULL OR published_at <= now (UTC)."""
    return datetime.now(timezone.utc)


def _search_postgres(q, entity_type, offset, fetch):
    """Postgres FTS path. Returns raw row dicts (pre-entity-resolution)."""
    prefix_q = _prefix_tsquery(q)

    def run(with_prefix):
        match_clause = "s.search_vector @@ websearch_to_tsquery('english', :q)"
        params = {'q': q, 'opts': _TS_HEADLINE_OPTS, 'now': _visibility_now(),
                  'limit': fetch, 'offset': offset}
        if with_prefix:
            match_clause = (
                "(" + match_clause +
                " OR s.search_vector @@ to_tsquery('english', :prefix_q))"
            )
            params['prefix_q'] = prefix_q

        type_clause = ""
        if entity_type:
            type_clause = "AND s.entity_type = :etype"
            params['etype'] = entity_type

        sql = sa.text(f"""
            SELECT s.entity_type, s.entity_id, s.title, s.body, s.date_posted,
                   ts_rank(s.search_vector, websearch_to_tsquery('english', :q))
                     + CASE
                         WHEN s.date_posted >= (now() - interval '90 days') THEN 0.05
                         WHEN s.date_posted >= (now() - interval '365 days') THEN 0.02
                         ELSE 0.0
                       END AS rank,
                   ts_headline('english', coalesce(s.body, ''),
                               websearch_to_tsquery('english', :q), :opts) AS headline
            FROM search_index s
            WHERE {match_clause}
              AND (s.published_at IS NULL OR s.published_at <= :now)
              {type_clause}
            ORDER BY rank DESC, s.date_posted DESC NULLS LAST
            LIMIT :limit OFFSET :offset
        """)
        return db.session.execute(sql, params).mappings().all()

    try:
        db_rows = run(with_prefix=bool(prefix_q))
    except sa.exc.DBAPIError:
        # Prefix branch failed on unusual input — skip it rather than failing
        # the whole search. websearch_to_tsquery alone is safe for any input.
        db.session.rollback()
        db_rows = run(with_prefix=False)

    return [
        {
            'entity_type': r['entity_type'],
            'entity_id': r['entity_id'],
            'title': r['title'],
            'body': r['body'],
            'date_posted': r['date_posted'],
            'snippet': _escape_headline(r['headline']) if r['headline'] else None,
        }
        for r in db_rows
    ]


def _search_sqlite(q, entity_type, offset, fetch):
    """SQLite LIKE fallback (local dev). AND semantics per whitespace term,
    ordered title-match-first then date_posted desc."""
    from app.models import SearchDocument

    terms = _like_terms(q)
    if not terms:
        return []

    query = db.session.query(SearchDocument)
    title_conditions = []
    for term in terms:
        like = f'%{_escape_like(term)}%'
        query = query.filter(sa.or_(
            SearchDocument.title.ilike(like, escape='\\'),
            SearchDocument.keywords.ilike(like, escape='\\'),
            SearchDocument.body.ilike(like, escape='\\'),
        ))
        title_conditions.append(SearchDocument.title.ilike(like, escape='\\'))

    # Visibility — must match published_filter() semantics exactly.
    query = query.filter(sa.or_(
        SearchDocument.published_at.is_(None),
        SearchDocument.published_at <= _visibility_now(),
    ))
    if entity_type:
        query = query.filter(SearchDocument.entity_type == entity_type)

    title_match_first = sa.case((sa.and_(*title_conditions), 0), else_=1)
    docs = (
        query.order_by(title_match_first, SearchDocument.date_posted.desc())
        .offset(offset).limit(fetch).all()
    )

    return [
        {
            'entity_type': d.entity_type,
            'entity_id': d.entity_id,
            'title': d.title,
            'body': d.body,
            'date_posted': d.date_posted,
            'snippet': _sqlite_snippet(d.body, terms),
        }
        for d in docs
    ]


def search_query(q, entity_type=None, page=1, per_page=10):
    """Site-wide search. Returns {'query', 'items', 'has_next'}.

    - q: raw user query (stripped, capped at 100 chars, min 2 chars).
    - entity_type: optional filter, one of SEARCHABLE_ENTITY_TYPES.
    - Pagination via page/per_page; fetches per_page+1 rows for has_next.
      No total count is computed (by design — see spec).

    The visibility filter (published_at IS NULL OR <= now) is applied inside
    the query itself, always, before any caching layer.
    """
    q = _sanitize_query(q)
    if not q:
        return {'query': q, 'items': [], 'has_next': False}

    if entity_type not in SEARCHABLE_ENTITY_TYPES:
        entity_type = None

    page = max(int(page or 1), 1)
    per_page = min(max(int(per_page or 10), 1), 25)
    offset = (page - 1) * per_page
    fetch = per_page + 1

    if db.engine.dialect.name == 'postgresql':
        rows = _search_postgres(q, entity_type, offset, fetch)
    else:
        rows = _search_sqlite(q, entity_type, offset, fetch)

    has_next = len(rows) > per_page
    rows = rows[:per_page]

    entities = _load_entities(rows)
    items = []
    for row in rows:
        key = (row['entity_type'], row['entity_id'])
        entity = entities.get(key)
        if entity is None:
            continue  # stale index row — source entity no longer exists
        items.append({
            'type': row['entity_type'],
            'id': row['entity_id'],
            'title': row['title'],
            'snippet': _snippet_fallback(
                row['snippet'], row['body'], row['entity_type'], entity
            ),
            'date': row['date_posted'].strftime('%Y-%m-%d') if row['date_posted'] else None,
            'meta': _entity_meta(row['entity_type'], entity),
            'url': _result_url(row['entity_type'], row['entity_id']),
        })

    return {'query': q, 'items': items, 'has_next': has_next}
