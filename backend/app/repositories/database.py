import hashlib
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


class Database:
    def __init__(self, path, timeout=5.0):
        self.path = Path(path)
        self.timeout = timeout

    def connect(self):
        connection = sqlite3.connect(str(self.path), timeout=self.timeout, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA busy_timeout=%d" % int(self.timeout * 1000))
        return connection

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        connection = self.connect()
        try:
            self.path.chmod(0o600)
            connection.execute("PRAGMA journal_mode=WAL")
        finally:
            connection.close()
        # The service owner controls the containing directory and these files.
        for suffix in ("", "-wal", "-shm"):
            file = Path(str(self.path) + suffix)
            if file.exists():
                file.chmod(0o600)
        with self.transaction() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)")
            paths = sorted((Path(__file__).parent / "migrations").glob("*.sql"))
            known = {path.name for path in paths}
            applied_names = {row[0] for row in connection.execute("SELECT name FROM schema_migrations")}
            if not applied_names <= known:
                raise RuntimeError("Database schema is newer than this application")
            for path in paths:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                applied = connection.execute("SELECT sha256 FROM schema_migrations WHERE name=?", (path.name,)).fetchone()
                if applied:
                    if applied[0] != digest:
                        raise RuntimeError("Applied database migration was modified")
                    continue
                for statement in path.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
                connection.execute("INSERT INTO schema_migrations VALUES (?,?)", (path.name, digest))

    @contextmanager
    def transaction(self, write=True):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def healthy(self):
        try:
            with self.transaction(write=False) as connection:
                return connection.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] > 0
        except sqlite3.Error:
            return False


def audit(connection, actor_id, action, target_id=""):
    connection.execute("INSERT INTO audit_events(at,actor_id,action,target_id) VALUES (?,?,?,?)",
                       (time.time(), actor_id, action, target_id))
