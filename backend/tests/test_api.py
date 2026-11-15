from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from app.main import create_app
from app.models import Booking, RateBucket
from .conftest import KEY


def body(slot="s0", email="ada@example.com"):
    return {"slot_id": slot, "name": "Ada Obi", "email": email}


@pytest.mark.parametrize("method,path", [("GET", "/slots"), ("POST", "/reset"), ("POST", "/bookings"),
    ("GET", "/bookings?email=a@example.com"), ("GET", "/bookings/missing"),
    ("DELETE", "/bookings/missing"), ("GET", "/health")])
@pytest.mark.parametrize("key", [None, "wrong"])
def test_authentication(app, method, path, key):
    with TestClient(app) as client:
        response = client.request(method, path, headers={"X-API-Key": key} if key else {})
    assert response.status_code == 401
    assert set(response.json()) == {"error"}


def test_lifecycle_and_persistence(client, slots, settings):
    listed = client.get("/slots").json()["slots"]
    assert len(listed) == len(slots)
    assert all(slot["available"] for slot in listed)
    result = client.post("/bookings", json={**body(), "name": "  Ada Obi  ", "email": " ADA@EXAMPLE.COM "})
    assert result.status_code == 201
    booking = result.json()
    assert set(booking) == {"id", "slot_id", "name", "email", "status", "created_at"}
    assert booking["name"] == "Ada Obi" and booking["email"] == "ada@example.com"
    assert booking["status"] == "confirmed"
    assert datetime.fromisoformat(booking["created_at"].replace("Z", "+00:00")).tzinfo
    other_app = create_app(settings)
    with TestClient(other_app, headers={"X-API-Key": KEY}) as other:
        assert other.get(f'/bookings/{booking["id"]}').json() == booking
    other_app.state.session_factory.kw["bind"].dispose()
    assert not next(s for s in client.get("/slots").json()["slots"] if s["id"] == "s0")["available"]
    assert client.delete(f'/bookings/{booking["id"]}').json()["status"] == "cancelled"
    assert client.get(f'/bookings/{booking["id"]}').json()["status"] == "cancelled"
    assert client.delete(f'/bookings/{booking["id"]}').status_code == 409
    assert client.post("/bookings", json=body(email="other@example.com")).status_code == 201
    assert len(client.get("/bookings?email=ADA@EXAMPLE.COM").json()["bookings"]) == 1


@pytest.mark.parametrize("field", ["slot_id", "name", "email"])
@pytest.mark.parametrize("value", [None, "", "   ", 123, [], {}])
def test_invalid_fields(client, slots, field, value):
    payload = body()
    payload[field] = value
    result = client.post("/bookings", json=payload)
    assert result.status_code == 400
    assert set(result.json()) == {"error"}


@pytest.mark.parametrize("field", ["slot_id", "name", "email"])
def test_missing_fields(client, slots, field):
    payload = body()
    del payload[field]
    assert client.post("/bookings", json=payload).status_code == 400


@pytest.mark.parametrize("email", ["not-an-email", "a@", "@example.com", "a b@example.com"])
def test_email_validation(client, slots, email):
    assert client.post("/bookings", json=body(email=email)).status_code == 400


def test_missing_and_past_slots(client, slots):
    assert client.post("/bookings", json=body("missing")).status_code == 404
    assert client.post("/bookings", json=body("past")).status_code == 400
    assert client.get("/bookings/missing").status_code == 404
    assert client.delete("/bookings/missing").status_code == 404


def test_double_booking(client, slots):
    assert client.post("/bookings", json=body()).status_code == 201
    assert client.post("/bookings", json=body(email="other@example.com")).status_code == 409


def race(app, calls):
    barrier = Barrier(len(calls))
    def run(call):
        with TestClient(app, headers={"X-API-Key": KEY}) as client:
            barrier.wait(timeout=15)
            return call(client)
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def test_concurrent_booking(app, slots):
    responses = race(app, [lambda client, i=i: client.post("/bookings", json=body(email=f"p{i}@example.com")) for i in range(12)])
    assert sorted(r.status_code for r in responses) == [201] + [409] * 11
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Booking)) == 1


def test_constraint_guards_direct_writes(app, client, slots):
    client.post("/bookings", json=body())
    with pytest.raises(IntegrityError), app.state.session_factory.begin() as session:
        session.add(Booking(id="direct", slot_id="s0", name="Other", email="other@example.com", status="confirmed"))


def test_idempotency_replay_conflict_and_cancellation(client, slots):
    headers = {"Idempotency-Key": "stable-key"}
    first = client.post("/bookings", json=body(), headers=headers)
    second = client.post("/bookings", json=dict(reversed(list(body().items()))), headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert client.post("/bookings", json=body("s1"), headers=headers).status_code == 422
    client.delete(f'/bookings/{first.json()["id"]}')
    replay = client.post("/bookings", json=body(), headers=headers)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert client.get(f'/bookings/{first.json()["id"]}').json()["status"] == "cancelled"


def test_idempotency_caches_failures(client, slots):
    headers = {"Idempotency-Key": "failure"}
    first = client.post("/bookings", json=body("missing"), headers=headers)
    replay = client.post("/bookings", json=body("missing"), headers=headers)
    assert first.status_code == replay.status_code == 404
    assert first.json() == replay.json()


def test_concurrent_idempotency(app, slots):
    responses = race(app, [lambda client: client.post("/bookings", json=body(), headers={"Idempotency-Key": "race"}) for _ in range(5)])
    assert all(r.status_code == 201 for r in responses)
    assert len({r.json()["id"] for r in responses}) == 1
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Booking)) == 1


def test_concurrent_conflicting_idempotency(app, slots):
    responses = race(app, [lambda client, i=i: client.post("/bookings", json=body(f"s{i}"), headers={"Idempotency-Key": "conflict"}) for i in range(2)])
    assert sorted(r.status_code for r in responses) == [201, 422]


def test_concurrent_cancellation(app, client, slots):
    booking = client.post("/bookings", json=body()).json()
    responses = race(app, [lambda client: client.delete(f'/bookings/{booking["id"]}') for _ in range(2)])
    assert sorted(r.status_code for r in responses) == [200, 409]


def test_pagination_order_ties_and_email_scope(app, client, slots):
    expected = []
    for i in range(5):
        booking = client.post("/bookings", json=body(f"s{i}")).json()
        expected.append(booking["id"])
    client.delete(f"/bookings/{expected[0]}")
    with app.state.session_factory.begin() as session:
        session.execute(update(Booking).values(created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)))
    seen = []
    cursor = None
    while True:
        query = {"email": "ADA@EXAMPLE.COM", "limit": 2}
        if cursor:
            query["cursor"] = cursor
        response = client.get("/bookings", params=query)
        assert response.status_code == 200
        page = response.json()
        seen.extend(item["id"] for item in page["bookings"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert client.get("/bookings", params={"email": "other@example.com", "cursor": cursor}).status_code == 400
    assert seen == sorted(expected)
    assert len(seen) == len(set(seen)) == 5
    assert client.get("/bookings?email=nobody@example.com").json() == {"bookings": [], "next_cursor": None}


@pytest.mark.parametrize("limit", ["0", "51", "-1", "1.5", "abc", "", "true"])
def test_invalid_limit(client, limit):
    assert client.get("/bookings", params={"email": "ada@example.com", "limit": limit}).status_code == 400


def test_invalid_cursor_and_missing_email(client):
    assert client.get("/bookings?email=ada@example.com&cursor=tampered").status_code == 400
    assert client.get("/bookings").status_code == 400


def test_rate_limit_failures_normalization_other_email_and_expiry(app, client, slots):
    for i in range(5):
        assert client.post("/bookings", json=body("missing", " ADA@EXAMPLE.COM ")).status_code == 404
    blocked = client.post("/bookings", json=body())
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert client.post("/bookings", json=body(email="different@example.com")).status_code == 201
    with app.state.session_factory.begin() as session:
        for bucket in session.scalars(select(RateBucket)):
            bucket.attempts = [timestamp - 61 for timestamp in bucket.attempts]
    assert client.post("/bookings", json=body("s1")).status_code == 201


def test_rate_limit_shared_across_apps(client, slots, settings):
    for _ in range(5):
        client.post("/bookings", json=body("missing"))
    other_app = create_app(settings)
    with TestClient(other_app, headers={"X-API-Key": KEY}) as other:
        assert other.post("/bookings", json=body()).status_code == 429
    other_app.state.session_factory.kw["bind"].dispose()


def test_concurrent_rate_limit(app, slots):
    responses = race(app, [lambda client: client.post("/bookings", json=body("missing")) for _ in range(10)])
    assert sorted(r.status_code for r in responses) == [404] * 5 + [429] * 5
    assert all(r.headers.get("Retry-After", "1").isdecimal() for r in responses)


def test_reset_clears_history_idempotency_and_limits(client, slots):
    headers = {"Idempotency-Key": "reset-key"}
    first = client.post("/bookings", json=body(), headers=headers).json()
    for _ in range(4):
        client.post("/bookings", json=body("missing"))
    assert client.post("/reset", json={"slots": slots}).status_code == 200
    assert client.get(f'/bookings/{first["id"]}').status_code == 404
    result = client.post("/bookings", json=body(), headers=headers)
    assert result.status_code == 201 and result.json()["id"] != first["id"]


def test_reset_invalid_is_atomic(client, slots):
    assert client.post("/reset", json={"slots": [slots[0], slots[0]]}).status_code == 400
    assert len(client.get("/slots").json()["slots"]) == len(slots)
    invalid = {**slots[0], "end": slots[0]["start"]}
    assert client.post("/reset", json={"slots": [invalid]}).status_code == 400
    assert client.post("/reset", json={"slots": []}).status_code == 200
    assert client.get("/slots").json() == {"slots": []}


@pytest.mark.parametrize("payload", ["{", "null", "[]", '"string"'])
def test_invalid_json_or_body_shape(client, payload):
    response = client.post("/bookings", content=payload, headers={"Content-Type": "application/json"})
    assert response.status_code == 400 and set(response.json()) == {"error"}
