from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from .config import Settings

# Shared advisory locks allow reset to exclude all other state operations.
RESET_LOCK = 1784136051


def make_session_factory(settings: Settings):
    engine = create_engine(settings.database_url, pool_pre_ping=True,
                           pool_size=5, max_overflow=10)
    return sessionmaker(engine, expire_on_commit=False)


def lock_state(session, *, exclusive: bool = False):
    function = "pg_advisory_xact_lock" if exclusive else "pg_advisory_xact_lock_shared"
    session.execute(text(f"SELECT {function}(:key)"), {"key": RESET_LOCK})
