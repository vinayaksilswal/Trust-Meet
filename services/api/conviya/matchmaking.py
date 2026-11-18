from datetime import timedelta
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, StringConstraints
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.orm import aliased

from .config import settings
from .conversations import EligibleUser, Mode, activate, blocked, current_call, describe, lock_transitions, release_expired
from .eligibility import eligible
from .identity import CurrentUser, Db, cookie_name
from .models import Conversation, LoginSession, Participant, User
from .runtime import cache, digest, now, throttle


router = APIRouter(prefix="/matchmaking", tags=["matchmaking"])
PREFIX = "conviya:queue:"
LEASE_SECONDS = 15
CANDIDATE_LIMIT = 64

UPSERT = """
local previous = redis.call('GET', KEYS[1])
local entry = previous and cjson.decode(previous)
local requested = cjson.decode(ARGV[4])
local current_search = entry and entry.search_id == requested.search_id
if current_search then
    if (entry.queue or entry.mode) ~= requested.queue or entry.session ~= requested.session then return false end
else
    if ARGV[1] ~= '1' or not redis.call('SET', KEYS[3], '1', 'NX', 'EX', 1800) then return false end
    if entry then redis.call('ZREM', ARGV[5] .. (entry.queue or entry.mode), ARGV[3]) end
end
local time = redis.call('TIME')
local current = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local lease = tonumber(ARGV[2])
local stored = current_search and previous or ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', current)
redis.call('PSETEX', KEYS[1], lease, stored)
redis.call('ZADD', KEYS[2], current + lease, ARGV[3])
if requested.queue ~= requested.mode then redis.call('PEXPIRE', KEYS[2], lease) end
return stored
"""
REMOVE = """
local previous = redis.call('GET', KEYS[1])
local entry = previous and cjson.decode(previous)
if entry and entry.search_id == ARGV[1] and entry.mode == ARGV[3] then
    redis.call('DEL', KEYS[1])
    redis.call('ZREM', ARGV[4] .. (entry.queue or entry.mode), ARGV[2])
    return 1
end
return 0
"""


class SearchKey(BaseModel):
    search_id: UUID
    mode: Mode


class Search(SearchKey):
    start: bool = False
    auto_connect: bool = False
    test_partner_email: EmailStr | None = None
    country: Literal["", "IN"] = ""
    language: Annotated[str, StringConstraints(strip_whitespace=True, max_length=24)] = ""
    interests: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]] = Field(
        default_factory=list, max_length=5,
    )


async def delete_entry(user_id: UUID, key: SearchKey):
    return await cache.eval(
        REMOVE, 1, PREFIX + str(user_id),
        str(key.search_id), str(user_id), key.mode, PREFIX + "mode:",
    )


def compatible(left, right):
    for field in ("country", "language"):
        if left[field] and right[field] and left[field] != right[field]:
            return False
    return not left["interests"] or not right["interests"] or bool(set(left["interests"]) & set(right["interests"]))


async def recently_connected(db: Db, user_id: UUID, candidate_id: UUID):
    other = aliased(Participant)
    return await db.scalar(
        select(Conversation.id).join(Participant, Participant.conversation_id == Conversation.id)
        .join(other, other.conversation_id == Conversation.id)
        .where(Participant.user_id == user_id, other.user_id == candidate_id,
               Conversation.ended_at > now() - timedelta(minutes=5)).limit(1)
    )


async def queued_candidates(user_id: UUID, own):
    queue = own.get("queue", own["mode"])
    entries = await cache.zrange(PREFIX + "mode:" + queue, 0, CANDIDATE_LIMIT)
    ids = [value for value in entries if value != str(user_id)]
    if not ids:
        return []
    payloads = await cache.mget([PREFIX + value for value in ids])
    candidates = [(UUID(value), json.loads(payload)) for value, payload in zip(ids, payloads) if payload]
    results = [(identifier, entry) for identifier, entry in candidates
               if entry.get("queue", entry["mode"]) == queue and (queue != own["mode"] or compatible(own, entry))]
    return sorted(results, key=lambda item: (
        -len(set(own["interests"]) & set(item[1]["interests"])), item[1]["joined_at"]
    ))


async def reserve(db: Db, user_id: UUID, candidate_id: UUID, entry, mode: Mode, *, test_pair: bool, auto_connect: bool):
    await release_expired(db, candidate_id)
    if await current_call(db, candidate_id) or await blocked(db, user_id, candidate_id):
        return None
    candidate = await db.scalar(
        select(User).join(LoginSession).where(User.id == candidate_id, LoginSession.token_hash == entry["session"],
                                                LoginSession.expires_at > now())
    )
    if not candidate or not await eligible(db, candidate):
        return None
    if not test_pair and await recently_connected(db, user_id, candidate_id):
        return None
    call = Conversation(mode=mode, state="invited", expires_at=now() + timedelta(seconds=35))
    db.add(call)
    await db.flush()
    db.add_all([Participant(user_id=user_id, conversation_id=call.id, consented_at=now() if auto_connect else None),
                Participant(user_id=candidate_id, conversation_id=call.id, consented_at=now() if entry.get("auto_connect") else None)])
    if auto_connect and entry.get("auto_connect"):
        activate(call)
    return call


@router.post("/search")
async def search(payload: Search, request: Request, user: EligibleUser, db: Db):
    if not settings.enable_matchmaking:
        raise HTTPException(503, "Matchmaking is currently unavailable.")
    await throttle("queue", str(user.id), 60, 60)
    queue = payload.mode
    if payload.test_partner_email:
        email, partner = user.email.casefold(), payload.test_partner_email.casefold()
        if email == partner:
            raise HTTPException(422, "Enter the other person's Trust Meet email address.")
        pair = sorted([email, partner])
        queue = f"test:{payload.mode}:{digest(json.dumps(pair))}"
    await lock_transitions(db)
    await release_expired(db, user.id)
    existing = await current_call(db, user.id)
    if existing:
        return {"waiting": False, "conversation": await describe(db, existing, user.id)}

    entry = {
        "search_id": str(payload.search_id), "mode": payload.mode, "queue": queue, "country": payload.country,
        "auto_connect": payload.auto_connect,
        "language": payload.language.casefold(), "interests": sorted({value.casefold() for value in payload.interests}),
        "session": digest(request.cookies[cookie_name]), "joined_at": now().timestamp(),
    }
    try:
        stored = await cache.eval(
            UPSERT, 3, PREFIX + str(user.id), PREFIX + "mode:" + queue,
            PREFIX + "used:" + str(user.id) + ":" + str(payload.search_id),
            int(payload.start), LEASE_SECONDS * 1000, str(user.id), json.dumps(entry), PREFIX + "mode:",
        )
        if not stored:
            raise HTTPException(409, "This search ended. Start a new search to continue.")
        own = json.loads(stored)
        for candidate_id, candidate in await queued_candidates(user.id, own):
            call = await reserve(db, user.id, candidate_id, candidate, payload.mode,
                                 test_pair=queue != payload.mode, auto_connect=own.get("auto_connect", False))
            if call:
                # Remove both leases before committing. If Redis or the transaction fails,
                # no match is announced and the affected users can start another search.
                await delete_entry(user.id, payload)
                await delete_entry(candidate_id, SearchKey(search_id=candidate["search_id"], mode=payload.mode))
                await db.commit()
                return {"waiting": False, "conversation": await describe(db, call, user.id)}
        await db.commit()
    except RedisError as err:
        raise HTTPException(503, "Matchmaking is temporarily unavailable.") from err
    return {"waiting": True, "conversation": None}


@router.post("/cancel", status_code=204)
async def cancel(payload: SearchKey, user: CurrentUser, db: Db):
    await lock_transitions(db)
    try:
        await delete_entry(user.id, payload)
    except RedisError as err:
        raise HTTPException(503, "Matchmaking is temporarily unavailable.") from err
