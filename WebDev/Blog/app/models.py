"""
SQLAlchemy models for the Neurascape application.
"""
import sqlalchemy as sa
import sqlalchemy.orm as so
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone
from typing import Optional

from app.extensions import db, naming_convention


class User(UserMixin, db.Model):
    __tablename__ = "user"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    username: so.Mapped[str] = so.mapped_column(sa.String(64), unique=True, nullable=False)
    password_hash: so.Mapped[str] = so.mapped_column(sa.String(256), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Photo(db.Model):
    __tablename__ = "photos"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    filename: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False, unique=True)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.String(512), nullable=True)
    # Low-Quality Image Placeholder: tiny base64-encoded JPEG data URI
    # Generated during upload, used as blurred placeholder while full image loads
    lqip: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    linked_posts: so.Mapped[list["Post"]] = so.relationship("Post", foreign_keys="Post.photo_id", back_populates="photo")
    linked_projects: so.Mapped[list["Project"]] = so.relationship("Project", foreign_keys="Project.photo_id", back_populates="photo")


class Project(db.Model):
    __tablename__ = "projects"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    description: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(sa.DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc))
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    is_featured: so.Mapped[bool] = so.mapped_column(sa.Boolean, nullable=False, default=False, server_default=sa.false(), index=True)
    photo_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("photos.id", name=naming_convention["fk"] % {"table_name": "projects", "column_0_name": "photo_id", "referred_table_name": "photos"}, ondelete="SET NULL"), nullable=True, index=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", foreign_keys=[photo_id], back_populates="linked_projects", innerjoin=False)
    items: so.Mapped[list["Post"]] = so.relationship("Post", back_populates="project", cascade="all, delete-orphan")


# Many-to-many junction table for Post <-> Tag
post_tags = db.Table(
    'post_tags',
    sa.Column('post_id', sa.Integer, sa.ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True),
    sa.Column('tag_id', sa.Integer, sa.ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True),
)


class Tag(db.Model):
    __tablename__ = "tags"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    name: so.Mapped[str] = so.mapped_column(sa.String(64), unique=True, nullable=False, index=True)
    posts: so.Mapped[list["Post"]] = so.relationship("Post", secondary=post_tags, back_populates="tags")

    def __repr__(self):
        return f'<Tag {self.name}>'


class Post(db.Model):
    __tablename__ = "posts"
    id: so.Mapped[int] = so.mapped_column(sa.Integer, primary_key=True)
    type: so.Mapped[str] = so.mapped_column(sa.String(50), index=True)
    title: so.Mapped[str] = so.mapped_column(sa.String(120), nullable=False)
    content: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    date_posted: so.Mapped[datetime] = so.mapped_column(sa.DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc))
    # Scheduling: if set to a future datetime, post is hidden from public until then
    published_at: so.Mapped[Optional[datetime]] = so.mapped_column(sa.DateTime(timezone=True), nullable=True, index=True)
    github_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    photo_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("photos.id", name=naming_convention["fk"] % {"table_name": "posts", "column_0_name": "photo_id", "referred_table_name": "photos"}, ondelete="SET NULL"), nullable=True)
    photo: so.Mapped[Optional["Photo"]] = so.relationship("Photo", back_populates="linked_posts", foreign_keys=[photo_id], innerjoin=False)
    project_id: so.Mapped[Optional[int]] = so.mapped_column(sa.ForeignKey("projects.id", name=naming_convention["fk"] % {"table_name": "posts", "column_0_name": "project_id", "referred_table_name": "projects"}, ondelete="SET NULL"), nullable=True, index=True)
    project: so.Mapped[Optional["Project"]] = so.relationship("Project", back_populates="items", foreign_keys=[project_id])
    tags: so.Mapped[list["Tag"]] = so.relationship("Tag", secondary=post_tags, back_populates="posts")
    __mapper_args__ = {"polymorphic_on": type, "polymorphic_identity": "post", "with_polymorphic": "*"}


class MusicItem(Post):
    __tablename__ = "music_items"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "music_items", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)
    item_type: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False, index=True)
    artist: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    album_title: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    spotify_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    youtube_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    __mapper_args__ = {"polymorphic_identity": "music_item"}


class Video(Post):
    __tablename__ = "videos"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "videos", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)
    video_url: so.Mapped[Optional[str]] = so.mapped_column(sa.String(512), nullable=True)
    embed_code: so.Mapped[Optional[str]] = so.mapped_column(sa.Text, nullable=True)
    source_type: so.Mapped[Optional[str]] = so.mapped_column(sa.String(50), index=True, nullable=True)
    duration: so.Mapped[Optional[str]] = so.mapped_column(sa.String(20), nullable=True)
    __mapper_args__ = {"polymorphic_identity": "video"}


class Review(Post):
    __tablename__ = "reviews"
    id: so.Mapped[int] = so.mapped_column(sa.ForeignKey("posts.id", name=naming_convention["fk"] % {"table_name": "reviews", "column_0_name": "id", "referred_table_name": "posts"}, ondelete="CASCADE"), primary_key=True)
    item_title: so.Mapped[str] = so.mapped_column(sa.String(256), nullable=False)
    category: so.Mapped[str] = so.mapped_column(sa.String(50), nullable=False, index=True)
    rating: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    year_released: so.Mapped[Optional[int]] = so.mapped_column(sa.Integer, nullable=True)
    director_author: so.Mapped[Optional[str]] = so.mapped_column(sa.String(120), nullable=True)
    item_link: so.Mapped[Optional[str]] = so.mapped_column(sa.String(256), nullable=True)
    __mapper_args__ = {"polymorphic_identity": "review"}
