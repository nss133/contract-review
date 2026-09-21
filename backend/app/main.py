import secrets
import sqlite3
import sys
import time
import uuid
import json
from contextlib import asynccontextmanager
from pathlib import Path

import fastapi
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.schemas import (CapabilitiesResponse, DraftInput, ErrorResponse, HealthResponse,
                             LoginInput, MemberInput, ReviewInput)
from app.api.body_limit import BodyLimitMiddleware
from app.auth.service import COOKIE_NAME, AuthFailure, authenticate, digest, login
from app.config import Settings
from app.domain.compat import legacy_hash
from app.repositories.database import Database, audit


def failure(status, code, message):
    return HTTPException(status, detail={"code": code, "message": message})


def database(request: Request):
    value = request.app.state.database
    if value is None:
        raise failure(503, "database_unavailable", "저장소를 사용할 수 없습니다. 잠시 후 다시 시도하세요.")
    return value


def principal(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise failure(401, "authentication_required", "로그인이 필요합니다.")
    identity = authenticate(database(request), token)
    if not identity:
        raise failure(401, "authentication_required", "다시 로그인하세요.")
    return identity


def check_origin(request):
    if request.headers.get("origin") != request.app.state.settings.frontend_origin:
        raise failure(403, "origin_rejected", "허용된 앱 주소에서 요청하세요.")


def writer(request: Request, identity=Depends(principal)):
    check_origin(request)
    token = request.headers.get("x-csrf-token", "")
    if not secrets.compare_digest(token, identity["csrf_token"]):
        raise failure(403, "csrf_rejected", "세션을 확인한 뒤 다시 시도하세요.")
    return identity


def review_access(connection, review_id, identity, edit=False, owner=False):
    row = connection.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    membership = connection.execute("SELECT permission FROM review_memberships WHERE review_id=? AND user_id=?",
                                    (review_id, identity["id"])).fetchone()
    owns = bool(row and row["owner_id"] == identity["id"])
    if not row or not (owns or membership):
        # Do not reveal whether another user's contract exists.
        raise failure(404, "not_found", "검토 자료를 찾을 수 없습니다.")
    if owner and not owns:
        raise failure(403, "permission_denied", "공유 대상을 변경할 권한이 없습니다.")
    if edit and (identity["role"] == "reader" or not (owns or membership["permission"] == "edit")):
        raise failure(403, "permission_denied", "이 검토를 수정할 권한이 없습니다.")
    return row


def create_app(settings=None):
    settings = settings or Settings.from_env()
    if sys.version_info[:2] != (3, 9):
        raise RuntimeError("The contract review API requires Python 3.9")

    @asynccontextmanager
    async def lifespan(app):
        if settings.database_path:
            app.state.database = Database(settings.database_path, settings.database_timeout)
            app.state.database.initialize()
        yield

    app = FastAPI(title="계약서 리뷰 API", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None,
                  responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse},
                             409: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                             503: {"model": ErrorResponse}})
    app.state.settings = settings
    app.state.database = None

    def envelope(request, **data):
        return {"api_version": "1", "request_id": request.state.request_id, **data}

    @app.middleware("http")
    async def request_context(request, call_next):
        request.state.request_id = str(uuid.uuid4())
        # Bound JSON payloads before they reach validation/password hashing.
        # The production proxy also bounds upload and streamed request bodies.
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > 8 * 1024 * 1024):
            response = JSONResponse(envelope(request, error={"code": "request_too_large",
                "message": "요청 크기 제한을 초과했습니다.", "retryable": False}), status_code=413)
        else:
            response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "not_found" if exc.status_code == 404 else "request_failed",
                                                               "message": "요청을 처리할 수 없습니다."}
        return JSONResponse(envelope(request, error={**detail, "retryable": exc.status_code in {409, 503}}), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(envelope(request, error={"code": "invalid_request",
            "message": "입력 형식과 필수 항목을 확인하세요.", "retryable": False}), status_code=422)

    @app.exception_handler(sqlite3.OperationalError)
    async def storage_error(request, exc):
        return JSONResponse(envelope(request, error={"code": "storage_unavailable",
            "message": "저장소가 응답하지 않습니다. 입력을 유지하고 다시 시도하세요.", "retryable": True}), status_code=503)

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return JSONResponse(envelope(request, error={"code": "internal_error",
            "message": "요청을 처리하지 못했습니다. 관리자에게 요청 번호를 전달하세요.", "retryable": False}), status_code=500)

    @app.get("/api/v1/health", response_model=HealthResponse)
    def health(request: Request):
        db = app.state.database
        return envelope(request, status="ok", ready=bool(db and db.healthy()), scope="review_workflow")

    @app.get("/api/v1/ready")
    def ready(request: Request):
        if not app.state.database or not app.state.database.healthy():
            raise failure(503, "not_ready", "저장소 준비가 필요합니다.")
        return envelope(request, ready=True, scope="review_workflow")

    @app.post("/api/v1/auth/login")
    def sign_in(body: LoginInput, request: Request, response: Response):
        check_origin(request)
        db = database(request)
        try:
            token, csrf, identity = login(db, body.username, body.password,
                                          request.client.host if request.client else "unknown", settings.session_seconds)
        except AuthFailure as exc:
            raise failure(429 if exc.limited else 401, "login_limited" if exc.limited else "login_failed",
                          "잠시 후 다시 시도하세요." if exc.limited else "계정과 비밀번호를 확인하세요.")
        response.set_cookie(COOKIE_NAME, token, httponly=True, secure=settings.secure_cookie,
                            samesite="strict", max_age=settings.session_seconds, path="/api/v1")
        return envelope(request, user={k: identity[k] for k in ("id", "username", "display_name", "role")}, csrf_token=csrf)

    @app.post("/api/v1/auth/logout")
    def sign_out(request: Request, response: Response, identity=Depends(writer), db=Depends(database)):
        with db.transaction() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (digest(request.cookies[COOKIE_NAME]),))
            audit(connection, identity["id"], "logout")
        response.delete_cookie(COOKIE_NAME, path="/api/v1", secure=settings.secure_cookie, httponly=True, samesite="strict")
        return envelope(request, logged_out=True)

    @app.get("/api/v1/me")
    def me(request: Request, identity=Depends(principal)):
        return envelope(request, user={k: identity[k] for k in ("id", "username", "display_name", "role")}, csrf_token=identity["csrf_token"])

    @app.get("/api/v1/capabilities", response_model=CapabilitiesResponse)
    def capabilities(request: Request, identity=Depends(principal)):
        return envelope(request, python_version=".".join(map(str, sys.version_info[:3])), fastapi_version=fastapi.__version__,
                        features={"accounts": True, "catalog": True, "review_drafts": True,
                                  "analysis": True, "extraction": True, "migration": False, "complete": True,
                                  "automatic_verdicts": True}, file_formats=["txt", "pdf", "docx", "hwpx", "doc", "hwp"])

    @app.get("/api/v1/catalog")
    def catalog(request: Request, identity=Depends(principal)):
        content = json.loads((Path(__file__).parent / "data/catalog.json").read_text(encoding="utf-8"))
        return envelope(request, **content)

    @app.post("/api/v1/reviews", status_code=201)
    def create_review(body: ReviewInput, request: Request, identity=Depends(writer), db=Depends(database)):
        if identity["role"] not in {"reviewer", "knowledge_manager"}:
            raise failure(403, "permission_denied", "검토 작성 권한이 없습니다.")
        if body.revision != 0:
            raise failure(409, "revision_conflict", "새 검토의 초기 버전이 올바르지 않습니다.")
        review_id = str(uuid.uuid4())
        with db.transaction() as connection:
            connection.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?,?)", (review_id, identity["id"], body.title,
                body.text, legacy_hash(body.text), 0, time.time()))
            audit(connection, identity["id"], "review_created", review_id)
        return envelope(request, review_id=review_id, revision=0)

    @app.get("/api/v1/reviews")
    def list_reviews(request: Request, identity=Depends(principal), db=Depends(database)):
        with db.transaction(write=False) as connection:
            rows = connection.execute("SELECT DISTINCT r.id,r.title,r.revision,r.created_at FROM reviews r "
                "LEFT JOIN review_memberships m ON r.id=m.review_id WHERE r.owner_id=? OR m.user_id=? "
                "ORDER BY r.created_at DESC LIMIT 100", (identity["id"], identity["id"])).fetchall()
        return envelope(request, reviews=[dict(row) for row in rows])

    @app.get("/api/v1/reviews/{review_id}")
    def get_review(review_id: str, request: Request, identity=Depends(principal), db=Depends(database)):
        with db.transaction() as connection:
            row = review_access(connection, review_id, identity)
            audit(connection, identity["id"], "review_read", review_id)
            value = dict(row)
        return envelope(request, review=value)

    @app.patch("/api/v1/reviews/{review_id}")
    def update_review(review_id: str, body: ReviewInput, request: Request, identity=Depends(writer), db=Depends(database)):
        with db.transaction() as connection:
            row = review_access(connection, review_id, identity, edit=True)
            if row["revision"] != body.revision:
                raise failure(409, "revision_conflict", "다른 변경이 저장되었습니다. 최신 내용을 확인하세요.")
            connection.execute("UPDATE reviews SET text=?,title=?,legacy_hash=?,revision=revision+1 WHERE id=?",
                               (body.text, body.title, legacy_hash(body.text), review_id))
            audit(connection, identity["id"], "review_updated", review_id)
        return envelope(request, revision=body.revision + 1)

    @app.put("/api/v1/reviews/{review_id}/draft")
    def save_draft(review_id: str, body: DraftInput, request: Request, identity=Depends(writer), db=Depends(database)):
        with db.transaction() as connection:
            review_access(connection, review_id, identity, edit=True)
            row = connection.execute("SELECT revision FROM opinion_drafts WHERE review_id=? AND user_id=?", (review_id, identity["id"])).fetchone()
            if body.revision != (row[0] if row else 0):
                raise failure(409, "revision_conflict", "다른 탭의 초안이 저장되었습니다. 최신 내용을 확인하세요.")
            connection.execute("INSERT INTO opinion_drafts VALUES (?,?,?,?,?) ON CONFLICT(review_id,user_id) "
                               "DO UPDATE SET text=excluded.text,revision=excluded.revision,updated_at=excluded.updated_at",
                               (review_id, identity["id"], body.text, body.revision + 1, time.time()))
            audit(connection, identity["id"], "draft_saved", review_id)
        return envelope(request, revision=body.revision + 1)

    @app.get("/api/v1/reviews/{review_id}/draft")
    def get_draft(review_id: str, request: Request, identity=Depends(principal), db=Depends(database)):
        with db.transaction(write=False) as connection:
            review_access(connection, review_id, identity)
            row = connection.execute("SELECT text,revision FROM opinion_drafts WHERE review_id=? AND user_id=?", (review_id, identity["id"])).fetchone()
        return envelope(request, draft=dict(row) if row else {"text": "", "revision": 0})

    @app.put("/api/v1/reviews/{review_id}/members")
    def add_member(review_id: str, body: MemberInput, request: Request, identity=Depends(writer), db=Depends(database)):
        with db.transaction() as connection:
            review_access(connection, review_id, identity, owner=True)
            user = connection.execute("SELECT id FROM users WHERE id=? AND disabled=0", (body.user_id,)).fetchone()
            if not user:
                raise failure(404, "not_found", "사용자를 찾을 수 없습니다.")
            connection.execute("INSERT INTO review_memberships VALUES (?,?,?) ON CONFLICT(review_id,user_id) DO UPDATE SET permission=excluded.permission",
                               (review_id, body.user_id, body.permission))
            audit(connection, identity["id"], "membership_changed", review_id)
        return envelope(request, saved=True)

    from app.api.workflow import register
    register(app, envelope, database, principal, writer, review_access, failure)

    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin], allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "X-CSRF-Token"], expose_headers=["X-Request-ID"])
    return app
