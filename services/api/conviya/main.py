import asyncio
from contextlib import asynccontextmanager, suppress
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from redis.exceptions import RedisError

from . import conversations, eligibility, identity, matchmaking, rooms
from .config import settings
from .maintenance import maintain
from .runtime import cache, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = asyncio.create_task(maintain())
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
    await cache.aclose()
    await engine.dispose()


app = FastAPI(title="Trust Meet API", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def protect_browser_requests(request: Request, call_next):
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
    logging.getLogger(__name__).error("Database operation failed (%s)", type(exc).__name__)
    return JSONResponse({"detail": "The service is temporarily unavailable."}, 503)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT version_num FROM alembic_version"))
        await cache.ping()
    except (SQLAlchemyError, RedisError, OSError):
        return JSONResponse({"status": "unavailable"}, 503)
    return {"status": "ready"}


app.include_router(identity.router)
app.include_router(eligibility.router)
app.include_router(conversations.router)
app.include_router(matchmaking.router)
app.include_router(rooms.router)
