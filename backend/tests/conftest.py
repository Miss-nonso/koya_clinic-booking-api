"""Integration tests require a disposable PostgreSQL database, never SQLite."""
import os
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from app.config import Settings
from app.main import create_app

KEY = "test-api-key-" + "a" * 40
SECRET = "test-cursor-secret-" + "b" * 40


@pytest.fixture(scope="session")
def settings():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.fail("Set TEST_DATABASE_URL to a disposable, migrated PostgreSQL database")
    return Settings(url, KEY, SECRET)


@pytest.fixture
def app(settings):
    instance = create_app(settings)
    yield instance
    instance.state.session_factory.kw["bind"].dispose()


@pytest.fixture
def client(app):
    with TestClient(app, headers={"X-API-Key": KEY}) as connection:
        yield connection


@pytest.fixture(autouse=True)
def clean_database(settings):
    engine = create_engine(settings.database_url)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE idempotency_records, rate_buckets, bookings, slots"))
    engine.dispose()


@pytest.fixture
def slots(client):
    now = datetime.now(timezone.utc)
    rows = [{"id": f"s{i}", "provider": "Dr Ade", "start": (now + timedelta(days=2, hours=i)).isoformat(),
             "end": (now + timedelta(days=2, hours=i, minutes=30)).isoformat()} for i in range(12)]
    rows.append({"id": "past", "provider": "Dr Past", "start": (now - timedelta(hours=2)).isoformat(),
                 "end": (now - timedelta(hours=1)).isoformat()})
    assert client.post("/reset", json={"slots": rows}).status_code == 200
    return rows
