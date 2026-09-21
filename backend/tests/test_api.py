import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app(Settings(environment="test"))) as value:
        yield value


def test_health_is_live_but_not_ready_without_database(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["ready"] is False
    assert response.json()["api_version"] == "1"
    assert client.get("/api/v1/ready").status_code == 503


@pytest.mark.parametrize("path", ["/api/v1/me", "/api/v1/catalog", "/api/v1/capabilities"])
def test_business_data_needs_authentication(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"
    assert response.json()["request_id"]


def test_no_legacy_html_or_remote_swagger_resources(client):
    assert client.get("/").status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_validation_error_never_echoes_password(client):
    response = client.post("/api/v1/auth/login", json={"username": 7, "password": "do-not-echo"})
    assert response.status_code == 422
    assert "do-not-echo" not in response.text


def test_cors_only_allows_configured_frontend(client):
    assert client.options("/api/v1/auth/login", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"
    }).status_code == 400


def test_production_requires_https_origin_and_database():
    with pytest.raises(ValueError):
        Settings(environment="production")
    with pytest.raises(ValueError):
        Settings(environment="production", database_path="/tmp/test.sqlite", frontend_origin="http://host")


def test_streamed_oversize_body_is_rejected_without_content_length(client):
    response = client.post("/api/v1/auth/login", content=(b"x" * 1024 * 1024 for _ in range(9)))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
