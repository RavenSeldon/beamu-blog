"""Add denormalized search_index table for site-wide search

Creates the search_index table on both dialects, plus (Postgres only) a
GENERATED tsvector column `search_vector` with A/B/C setweight over
title/keywords/body and a GIN index. SQLite skips the tsvector entirely and
is queried with a LIKE fallback instead.

Revision ID: e5a1c7d9b2f4
Revises: b7e3c9a1d4f2
Create Date: 2026-07-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e5a1c7d9b2f4'
down_revision = 'b7e3c9a1d4f2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'search_index',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('keywords', sa.Text(), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('date_posted', sa.DateTime(timezone=True), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_search_index')),
        sa.UniqueConstraint('entity_type', 'entity_id', name=op.f('uq_search_index_entity')),
    )
    with op.batch_alter_table('search_index', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_search_index_entity_type'), ['entity_type'], unique=False)
        batch_op.create_index(batch_op.f('ix_search_index_published_at'), ['published_at'], unique=False)

    # Postgres only: weighted tsvector generated column + GIN index.
    # Intentionally NOT part of the ORM model — the query layer references it
    # via raw SQL, so the mapped model stays identical on both dialects.
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(
            """
            ALTER TABLE search_index ADD COLUMN search_vector tsvector
            GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(keywords, '')), 'B') ||
                setweight(to_tsvector('english', coalesce(body, '')), 'C')
            ) STORED
            """
        )
        op.execute(
            "CREATE INDEX ix_search_index_search_vector "
            "ON search_index USING gin (search_vector)"
        )


def downgrade():
    # Dropping the table also drops the generated column and GIN index on
    # Postgres, so no dialect guard is needed here.
    with op.batch_alter_table('search_index', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_search_index_published_at'))
        batch_op.drop_index(batch_op.f('ix_search_index_entity_type'))
    op.drop_table('search_index')
