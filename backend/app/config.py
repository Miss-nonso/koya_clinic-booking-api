"""Environment-only configuration; secrets never have production defaults."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    api_key: str
    cursor_secret: str

    @classmethod
    def from_env(cls) -> "Settings":
        values = {key: os.environ.get(key, "") for key in (
            "DATABASE_URL", "API_KEY", "CURSOR_SECRET"
        )}
        if any(not value for value in values.values()):
            raise RuntimeError("DATABASE_URL, API_KEY and CURSOR_SECRET must be set")
        if len(values["API_KEY"]) < 32 or len(values["CURSOR_SECRET"]) < 32:
            raise RuntimeError("API_KEY and CURSOR_SECRET must be at least 32 characters")
        url = values["DATABASE_URL"]
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        if not url.startswith("postgresql+psycopg://"):
            raise RuntimeError("PostgreSQL with psycopg is required")
        return cls(url, values["API_KEY"], values["CURSOR_SECRET"])
