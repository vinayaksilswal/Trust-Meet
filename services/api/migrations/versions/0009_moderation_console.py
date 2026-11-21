"""Add staff roles, report review state and the moderation audit log."""

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "staff_roles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("granted_by", sa.String(100), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('moderator', 'admin')", name="staff_role"),
    )
    op.create_table(
        "moderation_actions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("moderator_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("subject_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("report_ref", sa.String(90)),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_moderation_actions_subject_id", "moderation_actions", ["subject_id"])
    op.create_index("ix_moderation_actions_created_at", "moderation_actions", ["created_at"])
    for table in ("reports", "room_reports"):
        op.add_column(table, sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id")))
        op.add_column(table, sa.Column("reviewed_at", sa.DateTime(timezone=True)))
    op.add_column("room_reports", sa.Column("state", sa.String(12), server_default="open", nullable=False))


def downgrade():
    op.drop_column("room_reports", "state")
    for table in ("reports", "room_reports"):
        op.drop_column(table, "reviewed_at")
        op.drop_column(table, "reviewed_by")
    op.drop_index("ix_moderation_actions_created_at", table_name="moderation_actions")
    op.drop_index("ix_moderation_actions_subject_id", table_name="moderation_actions")
    op.drop_table("moderation_actions")
    op.drop_table("staff_roles")
