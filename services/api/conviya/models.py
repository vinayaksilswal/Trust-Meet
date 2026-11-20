from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {datetime: sa.DateTime(timezone=True)}


class User(Base):
    __tablename__ = "users"
    __table_args__ = (sa.CheckConstraint("status IN ('active', 'suspended')", name="user_status"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(sa.String(254), unique=True)
    display_name: Mapped[str] = mapped_column(sa.String(60))
    password_hash: Mapped[str] = mapped_column(sa.Text)
    email_verified_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(sa.String(12), server_default="active")
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(index=True)


class AccountToken(Base):
    __tablename__ = "account_tokens"

    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(sa.String(12))
    expires_at: Mapped[datetime] = mapped_column(index=True)


class Eligibility(Base):
    __tablename__ = "eligibility"

    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_adult: Mapped[bool]
    provider: Mapped[str] = mapped_column(sa.String(40))
    checked_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())


class BetaAdmission(Base):
    __tablename__ = "beta_admissions"

    email: Mapped[str] = mapped_column(sa.String(254), primary_key=True)
    reviewed_by: Mapped[str] = mapped_column(sa.String(100))
    reviewed_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())
    suspended_by: Mapped[str | None] = mapped_column(sa.String(100))
    suspended_at: Mapped[datetime | None]


class AgeVerificationSession(Base):
    __tablename__ = "age_verification_sessions"

    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider_session_id: Mapped[UUID] = mapped_column(unique=True)
    resume_url: Mapped[str] = mapped_column(sa.Text)
    expires_at: Mapped[datetime] = mapped_column(index=True)


class AccountSuspension(Base):
    __tablename__ = "account_suspensions"

    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id"), primary_key=True)
    suspended_by: Mapped[str] = mapped_column(sa.String(100))
    suspended_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        sa.CheckConstraint("mode IN ('text', 'audio', 'video')", name="conversation_mode"),
        sa.CheckConstraint("state IN ('invited', 'active', 'ended')", name="conversation_state"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    mode: Mapped[str] = mapped_column(sa.String(5))
    state: Mapped[str] = mapped_column(sa.String(8))
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())
    invite_hash: Mapped[str | None] = mapped_column(sa.String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(index=True)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    media_closed_at: Mapped[datetime | None]
    media_retry_at: Mapped[datetime | None]


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        sa.Index("ix_participants_user_id", "user_id"),
        sa.Index("one_active_conversation_per_user", "user_id", unique=True, postgresql_where=sa.text("released_at IS NULL")),
    )

    conversation_id: Mapped[UUID] = mapped_column(sa.ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    consented_at: Mapped[datetime | None]
    media_granted_at: Mapped[datetime | None]
    released_at: Mapped[datetime | None]


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (sa.CheckConstraint("user_id <> blocked_id", name="block_other_user"),)

    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())


class RealtimeMeeting(Base):
    __tablename__ = "realtime_meetings"

    name: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    meeting_id: Mapped[UUID] = mapped_column(unique=True)


class RealtimeParticipant(Base):
    __tablename__ = "realtime_participants"

    meeting_name: Mapped[str] = mapped_column(sa.ForeignKey("realtime_meetings.name", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    participant_id: Mapped[UUID]


class Subscription(Base):
    __tablename__ = "subscriptions"

    user_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider_subscription_id: Mapped[str] = mapped_column(sa.String(40), unique=True)
    plan_id: Mapped[str] = mapped_column(sa.String(40))
    status: Mapped[str] = mapped_column(sa.String(16))
    current_end: Mapped[datetime | None]
    cancel_requested_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())


class BillingEvent(Base):
    __tablename__ = "billing_events"

    event_id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(sa.String(48))
    received_at: Mapped[datetime] = mapped_column(server_default=sa.func.now(), index=True)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (sa.UniqueConstraint("reporter_id", "conversation_id", name="one_report_per_conversation"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    reporter_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id"))
    subject_id: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id"), index=True)
    conversation_id: Mapped[UUID] = mapped_column(sa.ForeignKey("conversations.id"))
    category: Mapped[str] = mapped_column(sa.String(24))
    state: Mapped[str] = mapped_column(sa.String(12), server_default="open")
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())
