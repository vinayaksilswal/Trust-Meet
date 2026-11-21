"""Add self-declared gender, premium day passes and their Razorpay orders."""

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("gender", sa.String(8)))
    op.create_check_constraint("user_gender", "users", "gender IN ('male', 'female', 'other')")
    op.create_table(
        "premium_access",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "pass_orders",
        sa.Column("order_id", sa.String(40), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pass_id", sa.String(8), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("payment_id", sa.String(40), unique=True),
    )
    op.create_index("ix_pass_orders_user_id", "pass_orders", ["user_id"])


def downgrade():
    op.drop_index("ix_pass_orders_user_id", table_name="pass_orders")
    op.drop_table("pass_orders")
    op.drop_table("premium_access")
    op.drop_constraint("user_gender", "users", type_="check")
    op.drop_column("users", "gender")
