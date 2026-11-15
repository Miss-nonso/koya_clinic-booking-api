"""Create slots, bookings, idempotency records and shared rate buckets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("slots", sa.Column("id", sa.String(), primary_key=True),
                    sa.Column("provider", sa.String(), nullable=False),
                    sa.Column("start", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("end", sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint('"end" > start', name="slot_positive_duration"))
    op.create_table("bookings", sa.Column("id", sa.String(), primary_key=True),
                    sa.Column("slot_id", sa.String(), sa.ForeignKey("slots.id"), nullable=False),
                    sa.Column("name", sa.String(), nullable=False),
                    sa.Column("email", sa.String(), nullable=False),
                    sa.Column("status", sa.String(), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                              server_default=sa.text("clock_timestamp()")),
                    sa.CheckConstraint("status IN ('confirmed', 'cancelled')", name="booking_status"))
    op.create_index("one_confirmed_booking_per_slot", "bookings", ["slot_id"], unique=True,
                    postgresql_where=sa.text("status = 'confirmed'"))
    op.create_index("bookings_email_order", "bookings", ["email", "created_at", "id"])
    op.create_table("idempotency_records",
                    sa.Column("key_hash", sa.String(64), primary_key=True),
                    sa.Column("body_hash", sa.String(64), nullable=False),
                    sa.Column("response_status", sa.Integer(), nullable=False),
                    sa.Column("response_body", postgresql.JSONB(), nullable=False))
    op.create_table("rate_buckets", sa.Column("email_hash", sa.String(64), primary_key=True),
                    sa.Column("attempts", postgresql.JSONB(), nullable=False))

    # Supabase exposes public-schema tables through its Data API.
    # No anon/authenticated policies: only the backend database owner accesses data.
    for table in ("slots", "bookings", "idempotency_records", "rate_buckets"):
        op.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))


def downgrade():
    for table in ("rate_buckets", "idempotency_records", "bookings", "slots"):
        op.drop_table(table)
