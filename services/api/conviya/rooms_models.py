from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base


class PrivateRoom(Base):
    __tablename__ = "private_rooms"
    __table_args__ = (
        sa.CheckConstraint("mode IN ('text', 'audio', 'video')", name="private_room_mode"),
        sa.CheckConstraint("capacity BETWEEN 2 AND 12", name="private_room_capacity"),
        sa.CheckConstraint("ends_at > starts_at", name="private_room_time_range"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(sa.String(80))
    mode: Mapped[str] = mapped_column(sa.String(5))
    capacity: Mapped[int]
    password_hash: Mapped[str | None] = mapped_column(sa.Text)
    approval_required: Mapped[bool]
    locked: Mapped[bool] = mapped_column(server_default=sa.false())
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime] = mapped_column(index=True)
    closed_at: Mapped[datetime | None]
    media_closed_at: Mapped[datetime | None]
    media_retry_at: Mapped[datetime | None]


class RoomInvitation(Base):
    __tablename__ = "room_invitations"

    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    room_id: Mapped[UUID] = mapped_column(sa.ForeignKey("private_rooms.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(index=True)


class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (
        sa.CheckConstraint("state IN ('waiting', 'approved', 'left', 'removed')", name="room_member_state"),
    )

    room_id: Mapped[UUID] = mapped_column(sa.ForeignKey("private_rooms.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    state: Mapped[str] = mapped_column(sa.String(8))
    updated_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())
    media_granted_at: Mapped[datetime | None]
    media_revoked_at: Mapped[datetime | None]
    media_retry_at: Mapped[datetime | None]


class RoomReport(Base):
    __tablename__ = "room_reports"

    room_id: Mapped[UUID] = mapped_column(sa.ForeignKey("private_rooms.id"), primary_key=True)
    reporter_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id"), primary_key=True)
    category: Mapped[str] = mapped_column(sa.String(24))
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now(), index=True)
    state: Mapped[str] = mapped_column(sa.String(12), server_default="open")
    reviewed_by: Mapped[UUID | None] = mapped_column(sa.ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None]
