import hashlib
import secrets
import time
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from app.repositories.database import audit

HASHER = PasswordHasher()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
COOKIE_NAME = "cr_session"


class AuthFailure(Exception):
    def __init__(self, limited=False):
        self.limited = limited


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def create_user(database, username, password, role="reviewer", display_name=None):
    username = username.strip()
    if not username or len(username) > 80 or not 12 <= len(password) <= 1024:
        raise ValueError("Username required; password length must be 12–1024")
    if role not in {"operator", "knowledge_manager", "reviewer", "reader"}:
        raise ValueError("Unknown role")
    user_id = str(uuid.uuid4())
    password_hash = HASHER.hash(password)
    with database.transaction() as connection:
        connection.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
                           (user_id, username, display_name or username, password_hash, role, 0, time.time()))
        audit(connection, None, "account_created", user_id)
    return user_id


def login(database, username, password, peer, lifetime):
    now = time.time()
    # Count attempts before expensive password hashing, in a short transaction.
    keys = [(digest("user:" + username), 5), (digest("peer:" + peer), 30)]
    with database.transaction() as connection:
        connection.execute("DELETE FROM login_attempts WHERE expires_at<=?", (now,))
        for key, limit in keys:
            row = connection.execute("SELECT attempts FROM login_attempts WHERE key=?", (key,)).fetchone()
            if row and row[0] >= limit:
                raise AuthFailure(limited=True)
        for key, _ in keys:
            connection.execute("INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", (key, now + 900))
        user = connection.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    try:
        valid = HASHER.verify(user["password_hash"] if user else DUMMY_HASH, password)
    except VerificationError:
        valid = False
    if not valid or not user or user["disabled"]:
        with database.transaction() as connection:
            audit(connection, None, "login_failed")
        raise AuthFailure()
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with database.transaction() as connection:
        current = connection.execute("SELECT disabled,password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if current["disabled"] or current["password_hash"] != user["password_hash"]:
            raise AuthFailure()
        connection.execute("DELETE FROM login_attempts WHERE key=?", (keys[0][0],))
        connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
        connection.execute("INSERT INTO sessions VALUES (?,?,?,?)", (digest(token), user["id"], csrf, now + lifetime))
        audit(connection, user["id"], "login")
    return token, csrf, dict(user)


def authenticate(database, token):
    if not token or len(token) > 256:
        return None
    with database.transaction(write=False) as connection:
        row = connection.execute(
            "SELECT u.id,u.username,u.display_name,u.role,s.csrf_token FROM sessions s "
            "JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0",
            (digest(token), time.time())).fetchone()
    return dict(row) if row else None
