"""Live "people online" count.

Every open Trust Meet tab sends a heartbeat with a random visitor ID. The count is the
number of distinct IDs seen in the last WINDOW seconds. It is a real measurement: nothing
is padded or simulated.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from redis.exceptions import RedisError

from .runtime import cache, client_key, throttle


router = APIRouter(prefix="/presence", tags=["presence"])
KEY = "conviya:presence"
COUNT_KEY = "conviya:presence:count"
WINDOW = 45
BEAT = """
local time = redis.call('TIME')
local current = tonumber(time[1])
redis.call('ZADD', KEYS[1], current, ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', current - tonumber(ARGV[2]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return redis.call('ZCARD', KEYS[1])
"""


COUNT = """
local time = redis.call('TIME')
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(time[1]) - tonumber(ARGV[1]))
return redis.call('ZCARD', KEYS[1])
"""


class Heartbeat(BaseModel):
    visitor: UUID


async def online_count() -> int:
    cached = await cache.get(COUNT_KEY)
    if cached is not None:
        return int(cached)
    count = int(await cache.eval(COUNT, 1, KEY, WINDOW))
    await cache.set(COUNT_KEY, count, ex=5)
    return count


@router.get("")
async def online():
    try:
        return {"online": await online_count()}
    except RedisError as err:
        raise HTTPException(503, "Presence is temporarily unavailable.") from err


@router.post("")
async def heartbeat(payload: Heartbeat, request: Request):
    # Tabs beat every 20 seconds. The per-address limit stops one client inflating the count.
    await throttle("presence", client_key(request), 30, 60)
    try:
        count = await cache.eval(BEAT, 1, KEY, str(payload.visitor), WINDOW)
        await cache.set(COUNT_KEY, count, ex=5)
    except RedisError as err:
        raise HTTPException(503, "Presence is temporarily unavailable.") from err
    return {"online": int(count)}
