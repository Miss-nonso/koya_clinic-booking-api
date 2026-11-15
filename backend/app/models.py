"""Persistent booking state and shared coordination tables."""
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Slot(Base):
    __tablename__ = "slots"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    __table_args__ = (CheckConstraint('"end" > start', name="slot_positive_duration"),)


class Booking(Base):
    __tablename__ = "bookings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    slot_id: Mapped[str] = mapped_column(ForeignKey("slots.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()"), nullable=False
    )
    __table_args__ = (
        CheckConstraint("status IN ('confirmed', 'cancelled')", name="booking_status"),
        Index("one_confirmed_booking_per_slot", "slot_id", unique=True,
              postgresql_where=text("status = 'confirmed'")),
        Index("bookings_email_order", "email", "created_at", "id"),
    )


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict] = mapped_column(JSONB, nullable=False)


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Only the five accepted attempt timestamps are retained per email.
    attempts: Mapped[list] = mapped_column(JSONB, nullable=False)
