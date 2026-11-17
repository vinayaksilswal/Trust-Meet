import asyncio
from contextlib import asynccontextmanager, suppress
from hmac import compare_digest
from ipaddress import ip_address
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from redis.exceptions import RedisError

from . import conversations, eligibility, identity, matchmaking, realtimekit, rooms
from .config import settings
from .maintenance import maintain
from .runtime import cache, database_sqlstate, engine, require_maintenance


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = None if getattr(app.state, "dedicated_worker", False) else asyncio.create_task(maintain())
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
    await cache.aclose()
    await engine.dispose()


app = FastAPI(title="Trust Meet API", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def protect_browser_requests(request: Request, call_next):
    if settings.environment == "production" and request.url.path != "/health":
        supplied = request.headers.get("x-trust-meet-proxy-key", "")
        if not compare_digest(supplied.encode(), settings.web_proxy_secret.encode()):
            return JSONResponse({"detail": "Endpoint not found."}, 404, headers={"Cache-Control": "no-store"})
        try:
            request.state.trusted_client_ip = str(ip_address(request.headers.get("x-trust-meet-client-ip", "")))
        except ValueError:
            pass
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") != settings.web_origin:
            return JSONResponse({"detail": "Request origin is not allowed."}, 403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    fields = [".".join(str(piece) for piece in error["loc"] if piece != "body") for error in exc.errors()]
    return JSONResponse({"detail": "Check the submitted fields.", "fields": fields}, 422)


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc: SQLAlchemyError):
    logger.error("Database operation failed (%s, SQLSTATE %s)", type(exc).__name__, database_sqlstate(exc))
    return JSONResponse({"detail": "The service is temporarily unavailable."}, 503)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT version_num FROM alembic_version"))
            if settings.media_provider == "realtimekit":
                await connection.execute(text("SELECT 1 FROM realtime_meetings LIMIT 1"))
                await connection.execute(text("SELECT 1 FROM realtime_participants LIMIT 1"))
    except (SQLAlchemyError, OSError) as exc:
        logger.error("PostgreSQL readiness check failed (%s, SQLSTATE %s)", type(exc).__name__, database_sqlstate(exc))
        return JSONResponse({"status": "unavailable"}, 503)
    try:
        await cache.ping()
        if settings.media_provider == "realtimekit":
            media_status = await realtimekit.preset_readiness()
            if settings.enable_conversations and media_status != "ready":
                return JSONResponse({"status": "unavailable", "media": media_status}, 503)
        if settings.enable_conversations:
            await require_maintenance()
    except (RedisError, OSError) as exc:
        logger.error("Redis readiness check failed (%s)", type(exc).__name__)
        return JSONResponse({"status": "unavailable"}, 503)
    if settings.media_provider == "realtimekit":
        return {"status": "ready", "media": media_status}
    return {"status": "ready"}


app.include_router(identity.router)
app.include_router(eligibility.router)
app.include_router(conversations.router)
app.include_router(matchmaking.router)
app.include_router(rooms.router)
