"""Explicit local SQLite server configuration; never defaults to anonymous access."""
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    database_path: Optional[str] = None
    frontend_origin: str = "http://127.0.0.1:8765"
    session_seconds: int = 28800
    database_timeout: float = 5.0

    def __post_init__(self):
        if self.environment not in {"development", "test", "production"}:
            raise ValueError("Unknown CR_ENV")
        origin = urlsplit(self.frontend_origin)
        if (origin.scheme not in {"http", "https"} or not origin.hostname
                or origin.path or origin.query or origin.fragment or origin.username
                or origin.password or "*" in self.frontend_origin):
            raise ValueError("CR_FRONTEND_ORIGIN must be an exact HTTP(S) origin")
        if self.database_path:
            if not Path(self.database_path).is_absolute() or self.database_path.startswith(("//", "\\\\")):
                raise ValueError("CR_DATABASE_PATH must be an absolute server-local path")
        if self.environment == "production":
            if not self.database_path or origin.scheme != "https":
                raise ValueError("Production requires a server-local SQLite path and HTTPS origin")
        if not 300 <= self.session_seconds <= 86400 or not 0 < self.database_timeout <= 30:
            raise ValueError("Invalid session lifetime or database timeout")

    @property
    def secure_cookie(self):
        return self.environment == "production" or self.frontend_origin.startswith("https://")

    @classmethod
    def from_env(cls):
        return cls(
            environment=os.environ.get("CR_ENV", "development"),
            database_path=os.environ.get("CR_DATABASE_PATH") or None,
            frontend_origin=os.environ.get("CR_FRONTEND_ORIGIN", "http://127.0.0.1:8765"),
        )
