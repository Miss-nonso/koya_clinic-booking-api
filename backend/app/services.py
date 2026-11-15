"""Transactional booking operations. All coordination is in PostgreSQL."""
import base64
import hashlib
import hmac
import json
import math
from datetime import datetime
from uuid import uuid4
from pydantic import ValidationError
from sqlalchemy import delete, exists, func, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from .database import lock_state
from .models import Booking, IdempotencyRecord, RateBucket, Slot
from .schemas import BookingInput, BookingOutput, ResetInput


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def booking_json(booking: Booking) -> dict:
    return BookingOutput.model_validate(booking).model_dump(mode="json")


def error(status: int, message: str):
    return status, {"error": message}, {}


def count_attempt(factory, email: str):
    """Commit attempts independently, including subsequent booking failures."""
    key = digest(email)
    with factory.begin() as session:
        lock_state(session)
        session.execute(insert(RateBucket).values(email_hash=key, attempts=[])
                        .on_conflict_do_nothing())
        bucket = session.scalar(select(RateBucket).where(
            RateBucket.email_hash == key).with_for_update())
        # Read clock AFTER acquiring the row lock, never before waiting.
        now = session.scalar(select(func.clock_timestamp())).timestamp()
        attempts = [stamp for stamp in bucket.attempts if stamp > now - 60]
        if len(attempts) >= 5:
            return max(1, math.ceil(attempts[0] + 60 - now))
        bucket.attempts = attempts + [now]
    return None


def create_booking(factory, raw, key: str | None):
    if isinstance(raw, dict) and isinstance(raw.get("email"), str):
        email = raw["email"].strip().lower()
        if email:
            retry = count_attempt(factory, email)
            if retry is not None:
                return 429, {"error": "too many booking attempts"}, {"Retry-After": str(retry)}
    body_hash = digest(json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    key_hash = digest(key) if key is not None else None
    with factory.begin() as session:
        lock_state(session)
        if key_hash:
            # Same key serializes across workers; the record and booking commit together.
            lock_key = int(key_hash[:16], 16)
            if lock_key >= 2**63:
                lock_key -= 2**64
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            record = session.get(IdempotencyRecord, key_hash)
            if record:
                if record.body_hash != body_hash:
                    return error(422, "Idempotency-Key reused with a different body")
                return record.response_status, record.response_body, {}
        result = _book(session, raw)
        if key_hash:
            session.add(IdempotencyRecord(key_hash=key_hash, body_hash=body_hash,
                        response_status=result[0], response_body=result[1]))
        return result


def _book(session, raw):
    try:
        details = BookingInput.model_validate(raw)
    except ValidationError:
        return error(400, "slot_id, name and a valid email are required")
    slot = session.scalar(select(Slot).where(Slot.id == details.slot_id).with_for_update())
    if slot is None:
        return error(404, "slot not found")
    now = session.scalar(select(func.clock_timestamp()))
    if slot.start <= now:
        return error(400, "slot has already started")
    if session.scalar(select(exists().where(
        Booking.slot_id == slot.id, Booking.status == "confirmed"
    ))):
        return error(409, "slot already booked")
    booking = Booking(id=str(uuid4()), status="confirmed", **details.model_dump())
    session.add(booking)
    session.flush()
    return 201, booking_json(booking), {}


def reset(factory, details: ResetInput):
    with factory.begin() as session:
        lock_state(session, exclusive=True)
        for model in (IdempotencyRecord, Booking, Slot, RateBucket):
            session.execute(delete(model))
        session.add_all(Slot(**slot.model_dump()) for slot in details.slots)


def list_slots(factory):
    with factory.begin() as session:
        lock_state(session)
        occupied = exists().where(Booking.slot_id == Slot.id, Booking.status == "confirmed")
        rows = session.execute(select(Slot, occupied.label("occupied")).order_by(Slot.start, Slot.id))
        # Past slots are listed; availability means unoccupied, as distinct from bookability.
        return {"slots": [{"id": slot.id, "provider": slot.provider,
                 "start": slot.start, "end": slot.end, "available": not booked}
                for slot, booked in rows]}


def get_booking(factory, booking_id: str):
    with factory.begin() as session:
        lock_state(session)
        booking = session.get(Booking, booking_id)
        return (200, booking_json(booking), {}) if booking else error(404, "booking not found")


def cancel_booking(factory, booking_id: str):
    with factory.begin() as session:
        lock_state(session)
        booking = session.scalar(select(Booking).where(Booking.id == booking_id).with_for_update())
        if booking is None:
            return error(404, "booking not found")
        if booking.status == "cancelled":
            return error(409, "booking already cancelled")
        booking.status = "cancelled"
        session.flush()
        return 200, booking_json(booking), {}


def encode_cursor(booking: Booking, email: str, secret: str) -> str:
    payload = json.dumps([booking.created_at.isoformat(), booking.id, email], separators=(",", ":")).encode()
    signature = hmac.digest(secret.encode(), payload, "sha256")
    return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")


def decode_cursor(cursor: str, email: str, secret: str):
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        signature, payload = raw[:32], raw[32:]
        if not hmac.compare_digest(signature, hmac.digest(secret.encode(), payload, "sha256")):
            raise ValueError
        stamp, booking_id, owner = json.loads(payload)
        timestamp = datetime.fromisoformat(stamp)
        if owner != email or timestamp.tzinfo is None or not isinstance(booking_id, str):
            raise ValueError
        return timestamp, booking_id
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise ValueError("invalid cursor") from exc


def list_bookings(factory, email: str, limit: int, cursor: str | None, secret: str):
    email = email.strip().lower()
    after = decode_cursor(cursor, email, secret) if cursor else None
    with factory.begin() as session:
        lock_state(session)
        query = select(Booking).where(Booking.email == email)
        if after:
            query = query.where(tuple_(Booking.created_at, Booking.id) > after)
        rows = list(session.scalars(query.order_by(Booking.created_at, Booking.id).limit(limit + 1)))
        page = rows[:limit]
        return {"bookings": [booking_json(row) for row in page],
                "next_cursor": encode_cursor(page[-1], email, secret) if len(rows) > limit else None}
