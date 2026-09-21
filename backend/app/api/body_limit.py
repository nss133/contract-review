"""Bound streamed bodies even if Content-Length is absent or inaccurate."""
import uuid

from starlette.responses import JSONResponse


class BodyLimitMiddleware:
    def __init__(self, app, maximum=8 * 1024 * 1024):
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"}:
            await self.app(scope, receive, send)
            return
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.maximum:
                request_id = str(uuid.uuid4())
                response = JSONResponse({"api_version": "1", "request_id": request_id,
                    "error": {"code": "request_too_large", "message": "요청 크기 제한을 초과했습니다.", "retryable": False}},
                    status_code=413, headers={"Cache-Control": "no-store", "X-Request-ID": request_id})
                await response(scope, receive, send)
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
