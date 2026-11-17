"""Track RealtimeKit meetings and participants for media cleanup."""

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "realtime_meetings",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("meeting_id", sa.Uuid(), nullable=False, unique=True),
    )
    op.create_table(
        "realtime_participants",
        sa.Column("meeting_name", sa.String(64), sa.ForeignKey("realtime_meetings.name", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("participant_id", sa.Uuid(), nullable=False),
    )


def downgrade():
    op.drop_table("realtime_participants")
    op.drop_table("realtime_meetings")
