from datetime import UTC, datetime
import hashlib
import secrets

from fastapi import HTTPException, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .config import settings


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
Sessions = async_sessionmaker(engine, expire_on_commit=False)
cache = Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)
RATE_LIMIT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""


async def database():
    async with Sessions() as session:
        yield session


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


def client_key(request: Request):
    if settings.environment == "production":
        return getattr(request.state, "trusted_client_ip", "unknown")
    return request.client.host if request.client else "unknown"
