from concurrent.futures import ThreadPoolExecutor
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.auth.service import COOKIE_NAME, create_user
from app.config import Settings
from app.main import create_app
from app.repositories.database import Database

ORIGIN = "http://127.0.0.1:8765"
PASSWORD = "synthetic-only-test-password"


@pytest.fixture
def setup(tmp_path):
    settings = Settings(environment="test", database_path=str(tmp_path / "test.sqlite"), database_timeout=0.15)
    db = Database(settings.database_path)
    db.initialize()
    ids = {name: create_user(db, name, PASSWORD, role) for name, role in
           [("alice", "reviewer"), ("bob", "reviewer"), ("operator", "operator"), ("reader", "reader")]}
    with TestClient(create_app(settings)) as client:
        yield client, db, ids, settings


def signin(client, name="alice"):
    response = client.post("/api/v1/auth/login", headers={"Origin": ORIGIN}, json={"username": name, "password": PASSWORD})
    assert response.status_code == 200, response.text
    csrf = response.json()["csrf_token"]
    return {"Origin": ORIGIN, "X-CSRF-Token": csrf}


def review(client, headers):
    response = client.post("/api/v1/reviews", headers=headers, json={"text": "가😀 계약 원문", "title": "합성 계약"})
    assert response.status_code == 201
    return response.json()["review_id"]


def test_authenticated_catalog_and_capabilities_match_baseline(setup):
    client, _, _, _ = setup
    signin(client)
    catalog = client.get("/api/v1/catalog").json()
    assert len(catalog["common"]["checks"]) + sum(len(t["checks"]) for t in catalog["types"]) == 184
    caps = client.get("/api/v1/capabilities").json()
    assert caps["python_version"].startswith("3.9.")
    assert caps["fastapi_version"] == "0.128.8"
    assert caps["features"]["analysis"]
    assert caps["features"]["extraction"] and caps["features"]["complete"]
    assert client.get("/api/v1/ready").status_code == 200


def test_sessions_are_hashed_expire_and_logout_revokes(setup):
    client, db, _, _ = setup
    headers = signin(client)
    token = client.cookies.get(COOKIE_NAME)
    with db.transaction(write=False) as connection:
        stored = connection.execute("SELECT token_hash FROM sessions").fetchone()[0]
    assert stored != token and len(stored) == 64
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    signin(client)
    with db.transaction() as connection:
        connection.execute("UPDATE sessions SET expires_at=?", (time.time() - 1,))
    assert client.get("/api/v1/me").status_code == 401


def test_csrf_and_origin_required_for_writes(setup):
    client, _, _, _ = setup
    headers = signin(client)
    for invalid in [{}, {"Origin": ORIGIN}, {**headers, "Origin": "https://evil.example"}]:
        assert client.post("/api/v1/reviews", headers=invalid, json={"text": "계약"}).status_code == 403


def test_other_user_and_operator_cannot_read_contract_or_draft(setup):
    client, _, ids, _ = setup
    headers = signin(client)
    key = review(client, headers)
    for name in ["bob", "operator"]:
        signin(client, name)
        assert client.get("/api/v1/reviews/" + key).status_code == 404
        assert client.get("/api/v1/reviews/" + key + "/draft").status_code == 404
        assert client.get("/api/v1/reviews").json()["reviews"] == []
    headers = signin(client)
    assert client.put("/api/v1/reviews/" + key + "/members", headers=headers,
                      json={"user_id": ids["bob"], "permission": "read"}).status_code == 200
    headers = signin(client, "bob")
    assert client.get("/api/v1/reviews/" + key).status_code == 200
    assert client.put("/api/v1/reviews/" + key + "/draft", headers=headers,
                      json={"text": "권한 없음", "revision": 0}).status_code == 403
    assert client.put("/api/v1/reviews/" + key + "/members", headers=headers,
                      json={"user_id": ids["reader"], "permission": "read"}).status_code == 403


def test_drafts_are_user_scoped_and_survive_restart(setup):
    client, _, ids, settings = setup
    headers = signin(client)
    key = review(client, headers)
    url = "/api/v1/reviews/" + key
    assert client.put(url + "/draft", headers=headers, json={"text": "나의 수기 의견😀", "revision": 0}).status_code == 200
    assert client.put(url + "/members", headers=headers, json={"user_id": ids["bob"], "permission": "edit"}).status_code == 200
    signin(client, "bob")
    assert client.get(url + "/draft").json()["draft"] == {"text": "", "revision": 0}
    with TestClient(create_app(settings)) as reopened:
        signin(reopened)
        assert reopened.get(url + "/draft").json()["draft"] == {"text": "나의 수기 의견😀", "revision": 1}
        assert reopened.get(url).json()["review"]["text"] == "가😀 계약 원문"


def test_ten_concurrent_writers_cannot_overwrite_same_revision(setup):
    client, _, _, _ = setup
    headers = signin(client)
    key = review(client, headers)
    url = "/api/v1/reviews/" + key + "/draft"
    def save(index):
        return client.put(url, headers=headers, json={"text": "의견" + str(index), "revision": 0}).status_code
    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(pool.map(save, range(10)))
    assert statuses.count(200) == 1
    assert statuses.count(409) == 9
    assert client.get(url).json()["draft"]["revision"] == 1


def test_input_revision_conflicts_and_analysis_validation_are_explicit(setup):
    client, _, _, _ = setup
    headers = signin(client)
    key = review(client, headers)
    url = "/api/v1/reviews/" + key
    assert client.patch(url, headers=headers, json={"text": "최신 원문", "revision": 0}).status_code == 200
    assert client.patch(url, headers=headers, json={"text": "뒤늦은 원문", "revision": 0}).status_code == 409
    assert client.get(url).json()["review"]["text"] == "최신 원문"
    assert client.post(url + "/analyses", headers=headers).status_code == 422
    assert client.post(url + "/analyses", headers=headers, json={"revision":0,"type_id":"procurement"}).status_code == 409


def test_busy_database_is_retryable_not_false_success(setup):
    client, db, _, _ = setup
    headers = signin(client)
    key = review(client, headers)
    with db.transaction():
        result = client.put("/api/v1/reviews/" + key + "/draft", headers=headers, json={"text": "잠금 중", "revision": 0})
        assert result.status_code == 503
        assert result.json()["error"]["retryable"] is True
        assert "locked" not in result.text
    assert client.get("/api/v1/reviews/" + key + "/draft").json()["draft"]["revision"] == 0


def test_login_rate_limit_and_disabled_account(setup):
    client, db, ids, _ = setup
    for _ in range(5):
        assert client.post("/api/v1/auth/login", headers={"Origin": ORIGIN}, json={"username": "alice", "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/login", headers={"Origin": ORIGIN}, json={"username": "alice", "password": PASSWORD}).status_code == 429
    with db.transaction() as connection:
        connection.execute("UPDATE users SET disabled=1 WHERE id=?", (ids["bob"],))
    assert client.post("/api/v1/auth/login", headers={"Origin": ORIGIN}, json={"username": "bob", "password": PASSWORD}).status_code == 401


def test_audit_contains_no_source_or_opinion(setup):
    client, db, _, _ = setup
    headers = signin(client)
    key = review(client, headers)
    client.put("/api/v1/reviews/" + key + "/draft", headers=headers, json={"text": "민감 수기 의견", "revision": 0})
    with db.transaction(write=False) as connection:
        rows = [dict(row) for row in connection.execute("SELECT * FROM audit_events")]
    assert {r["action"] for r in rows} >= {"login", "review_created", "draft_saved"}
    assert "민감" not in str(rows) and "계약 원문" not in str(rows) and PASSWORD not in str(rows)


def test_transaction_rollback_and_database_integrity(setup):
    _, db, _, _ = setup
    with pytest.raises(RuntimeError):
        with db.transaction() as connection:
            connection.execute("INSERT INTO audit_events(at,action,target_id) VALUES (0,'rollback-test','')")
            raise RuntimeError("synthetic rollback")
    with db.transaction(write=False) as connection:
        assert connection.execute("SELECT count(*) FROM audit_events WHERE action='rollback-test'").fetchone()[0] == 0
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_ten_users_can_save_independent_drafts_concurrently(setup):
    client, db, _, _ = setup
    clients = []
    try:
        for index in range(10):
            username = "parallel-" + str(index)
            create_user(db, username, PASSWORD)
            local = TestClient(client.app)
            headers = signin(local, username)
            key = review(local, headers)
            clients.append((local, headers, key))
        def save(row):
            local, headers, key = row
            response = local.put("/api/v1/reviews/" + key + "/draft", headers=headers,
                                 json={"text": "독립 의견" + key, "revision": 0})
            return response.status_code
        with ThreadPoolExecutor(max_workers=10) as pool:
            assert list(pool.map(save, clients)) == [200] * 10
    finally:
        for local, _, _ in clients:
            local.close()


def test_secure_session_cookie_in_production(tmp_path):
    settings = Settings(environment="production", database_path=str(tmp_path / "prod.sqlite"), frontend_origin="https://review.internal.example")
    with TestClient(create_app(settings), base_url="https://review.internal.example") as client:
        create_user(client.app.state.database, "test", PASSWORD)
        response = client.post("/api/v1/auth/login", headers={"Origin": settings.frontend_origin}, json={"username": "test", "password": PASSWORD})
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie


def test_applied_migration_cannot_be_silently_changed(setup):
    _, db, _, _ = setup
    with db.transaction() as connection:
        connection.execute("UPDATE schema_migrations SET sha256='tampered'")
    with pytest.raises(RuntimeError, match="modified"):
        db.initialize()


def test_newer_database_cannot_be_opened_by_old_api(setup):
    _, db, _, _ = setup
    with db.transaction() as connection:
        connection.execute("INSERT INTO schema_migrations VALUES ('999_future.sql','future')")
    with pytest.raises(RuntimeError, match="newer"):
        db.initialize()
