from datetime import UTC, datetime
import hashlib
import os
import secrets

from fastapi import HTTPException, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .config import settings


if os.getenv("VERCEL") == "1" and settings.environment == "production":
    engine = create_async_engine(
        settings.database_connection_url, poolclass=NullPool,
        connect_args={"connect_timeout": 5, "prepare_threshold": None},
    )
else:
    engine = create_async_engine(settings.database_connection_url, pool_pre_ping=True)
Sessions = async_sessionmaker(engine, expire_on_commit=False)
cache = Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)
MAINTENANCE_KEY = "conviya:maintenance:alive"
RATE_LIMIT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""


async def database():
    async with Sessions() as session:
        yield session


def database_sqlstate(error: Exception) -> str | None:
    if isinstance(error, DBAPIError):
        return getattr(error.orig, "sqlstate", None)
    return None


def now():
    return datetime.now(UTC)


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def new_token():
    return secrets.token_urlsafe(32)


async def throttle(scope: str, key: str, limit: int, seconds: int):
    try:
        count = await cache.eval(RATE_LIMIT, 1, f"conviya:limit:{scope}:{digest(key)}", seconds)
    except RedisError as err:
        raise HTTPException(503, "This service is temporarily unavailable.") from err
    if count > limit:
        raise HTTPException(429, "Too many attempts. Try again shortly.", headers={"Retry-After": str(seconds)})


async def require_maintenance():
    if not settings.public_conversations:
        return
    try:
        if await cache.exists(MAINTENANCE_KEY):
            return
    except RedisError:
        pass
    raise HTTPException(503, "Conversations are temporarily unavailable.")


def client_key(request: Request):
    if settings.environment == "production":
        return getattr(request.state, "trusted_client_ip", "unknown")
    return request.client.host if request.client else "unknown"
