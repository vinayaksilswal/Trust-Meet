import asyncio
from datetime import timedelta
import logging
from math import ceil
from typing import Annotated, Literal
from uuid import UUID

from aiohttp import ClientTimeout
from fastapi import APIRouter, Depends, HTTPException
from livekit import api
from pydantic import BaseModel
from sqlalchemy import or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .eligibility import eligible, require_eligible
from .identity import CurrentUser, Db, TokenInput
from .models import Block, Conversation, Participant, Report, User
from .runtime import digest, new_token, now, throttle


router = APIRouter(prefix="/conversations", tags=["conversations"])
EligibleUser = Annotated[User, Depends(require_eligible)]
Mode = Literal["text", "audio", "video"]
DURATION = timedelta(minutes=20)
logger = logging.getLogger(__name__)


class CreateInvite(BaseModel):
    mode: Mode


class ReportInput(BaseModel):
    category: Literal["harassment", "sexual_content", "scam", "threat", "underage", "other"]


async def lock_transitions(db: Db):
    # Serializes the initial two-user lifecycle across API and worker processes.
    await db.execute(text("SELECT pg_advisory_xact_lock(70211601)"))


def check_enabled():
    if not settings.enable_conversations:
        raise HTTPException(503, "Conversations are currently unavailable.")


async def finish(db: Db, call: Conversation):
    call.state = "ended"
    call.ended_at = now()
    call.invite_hash = None
    await db.execute(
        update(Participant).where(Participant.conversation_id == call.id).values(released_at=call.ended_at)
    )


async def current_call(db: Db, user_id: UUID):
    return await db.scalar(select(Conversation).join(Participant).where(
        Participant.user_id == user_id, Participant.released_at.is_(None), Conversation.expires_at > now()
    ))


async def release_expired(db: Db, user_id: UUID):
    stale = await db.scalar(select(Conversation).join(Participant).where(
        Participant.user_id == user_id, Participant.released_at.is_(None), Conversation.expires_at <= now()
    ))
    if stale:
        await finish(db, stale)


async def available(db: Db, user_id: UUID):
    await release_expired(db, user_id)
    if await current_call(db, user_id):
        raise HTTPException(409, "End your current invitation or conversation first.")


async def call_for(db: Db, call_id: UUID, user_id: UUID):
    call = await db.get(Conversation, call_id)
    if not call or not await db.get(Participant, (call_id, user_id)):
        raise HTTPException(404, "Conversation not found.")
    return call


async def members(db: Db, call: Conversation):
    return (await db.execute(
        select(Participant, User).join(User, Participant.user_id == User.id)
        .where(Participant.conversation_id == call.id).order_by(Participant.user_id)
    )).all()


async def blocked(db: Db, one: UUID, two: UUID):
    return bool(await db.scalar(select(Block.user_id).where(or_(
        (Block.user_id == one) & (Block.blocked_id == two),
        (Block.user_id == two) & (Block.blocked_id == one),
    ))))


async def describe(db: Db, call: Conversation, user_id: UUID):
    participants = await members(db, call)
    self_member = next(member for member, user in participants if user.id == user_id)
    other = next((user for _, user in participants if user.id != user_id), None)
    return {
        "id": call.id, "mode": call.mode,
        "state": call.state if call.expires_at > now() else "ended",
        "expires_at": call.expires_at, "consented": self_member.consented_at is not None,
        "partner": other.display_name if other else None,
    }


def activate(call: Conversation):
    call.state = "active"
    call.started_at = now()
    call.expires_at = call.started_at + DURATION


def room_name(call_id: UUID):
    return f"conviya-{call_id}"


def livekit():
    return api.LiveKitAPI(
        url=settings.livekit_api_url, api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret,
        timeout=ClientTimeout(total=3),
    )


async def delete_room(name: str):
    try:
        async with livekit() as client:
            await client.room.delete_room(api.DeleteRoomRequest(room=name))
        return True
    except api.TwirpError as err:
        if err.code == "not_found":
            return True
        logger.warning("LiveKit room cleanup failed (%s)", err.code)
    except (TimeoutError, OSError):
        logger.warning("LiveKit room cleanup unavailable")
    return False


async def revoke_participant(name: str, user_id: UUID):
    try:
        async with livekit() as client:
            await client.room.remove_participant(api.RoomParticipantIdentity(
                room=name, identity=str(user_id),
                revoke_token_ts=ceil(now().timestamp()) + 3 if settings.hosted_invite_beta else 0,
            ))
        return True
    except api.TwirpError as err:
        if err.code == "not_found" and not settings.hosted_invite_beta:
            return True
        logger.warning("LiveKit participant removal failed (%s)", err.code)
    except (TimeoutError, OSError):
        logger.warning("LiveKit participant removal unavailable")
    return False


async def close_media(name: str, participants: list[UUID]):
    if not settings.hosted_invite_beta:
        return await delete_room(name)
    if not participants:
        return True
    revoked = await asyncio.gather(*(revoke_participant(name, user) for user in participants))
    return all(revoked) and await delete_room(name)


async def close_call_media(db: Db, call_id: UUID):
    users = list(await db.scalars(select(Participant.user_id).where(
        Participant.conversation_id == call_id, Participant.media_granted_at.is_not(None)
    )))
    return await close_media(room_name(call_id), users)


@router.get("/current")
async def current(user: CurrentUser, db: Db):
    call = await current_call(db, user.id)
    return await describe(db, call, user.id) if call else None


@router.post("/invitations", status_code=201)
async def invite(payload: CreateInvite, user: EligibleUser, db: Db):
    check_enabled()
    await throttle("invite", str(user.id), 12, 300)
    await lock_transitions(db)
    await available(db, user.id)
    token = new_token()
    call = Conversation(mode=payload.mode, state="invited", invite_hash=digest(token),
                        expires_at=now() + timedelta(minutes=10))
    db.add(call)
    await db.flush()
    db.add(Participant(conversation_id=call.id, user_id=user.id, consented_at=now()))
    await db.commit()
    return {"id": call.id, "token": token}


@router.post("/invitations/accept")
async def accept_invite(payload: TokenInput, user: EligibleUser, db: Db):
    check_enabled()
    await throttle("accept-invite", str(user.id), 20, 300)
    await lock_transitions(db)
    call = await db.scalar(select(Conversation).where(Conversation.invite_hash == digest(payload.token)))
    if not call or call.state != "invited" or call.expires_at <= now():
        raise HTTPException(404, "This invitation is unavailable or expired.")
    [(membership, host)] = await members(db, call)
    if host.id == user.id:
        raise HTTPException(409, "Share the invitation with a different account.")
    if not await eligible(db, host) or await blocked(db, host.id, user.id):
        raise HTTPException(404, "This invitation is unavailable or expired.")
    await available(db, user.id)
    db.add(Participant(conversation_id=call.id, user_id=user.id, consented_at=now()))
    call.invite_hash = None
    activate(call)
    await db.commit()
    return await describe(db, call, user.id)


@router.get("/{call_id}")
async def status(call_id: UUID, user: CurrentUser, db: Db):
    return await describe(db, await call_for(db, call_id, user.id), user.id)


@router.post("/{call_id}/accept")
async def accept_match(call_id: UUID, user: EligibleUser, db: Db):
    check_enabled()
    await lock_transitions(db)
    call = await call_for(db, call_id, user.id)
    if call.state == "active" and call.expires_at > now():
        return await describe(db, call, user.id)
    if call.state != "invited" or call.expires_at <= now() or call.invite_hash:
        raise HTTPException(409, "This match is unavailable.")
    participants = await members(db, call)
    if len(participants) != 2:
        raise HTTPException(409, "This match is unavailable.")
    (first, one), (second, two) = participants
    if not await eligible(db, one) or not await eligible(db, two) or await blocked(db, one.id, two.id):
        raise HTTPException(409, "This match is unavailable.")
    member = first if one.id == user.id else second
    member.consented_at = member.consented_at or now()
    if first.consented_at and second.consented_at:
        activate(call)
    await db.commit()
    return await describe(db, call, user.id)


@router.post("/{call_id}/media")
async def media_token(call_id: UUID, user: EligibleUser, db: Db):
    check_enabled()
    await throttle("media", str(user.id), 24, 300)
    await lock_transitions(db)
    call = await call_for(db, call_id, user.id)
    if call.state != "active" or call.expires_at <= now() + timedelta(seconds=1):
        raise HTTPException(409, "This conversation is unavailable.")
    participants = await members(db, call)
    if len(participants) != 2:
        raise HTTPException(409, "Both participants must consent.")
    (first, one), (second, two) = participants
    if not first.consented_at or not second.consented_at or await blocked(db, one.id, two.id):
        raise HTTPException(403, "This conversation is unavailable.")
    if not await eligible(db, one) or not await eligible(db, two):
        raise HTTPException(403, "This conversation is unavailable.")
    grant = issue_media_grant(room_name(call.id), str(user.id), call.mode, call.expires_at)
    member = first if first.user_id == user.id else second
    if member.media_granted_at is None:
        member.media_granted_at = now()
        await db.commit()
    return grant


def issue_media_grant(name: str, user: str, mode: Mode, expires_at, display_name: str | None = None):
    sources = {"text": [], "audio": ["microphone"], "video": ["microphone", "camera"]}
    grant = api.VideoGrants(
        room_join=True, room=name, can_publish=mode != "text", can_subscribe=mode != "text",
        can_publish_data=True, can_publish_sources=sources[mode], can_update_own_metadata=False,
    )
    builder = api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
    if display_name:
        builder.with_name(display_name)
    token = (builder
             .with_identity(user).with_grants(grant)
             .with_ttl(min(timedelta(seconds=30), expires_at - now())).to_jwt())
    return {"url": settings.livekit_ws_url, "token": token}


@router.post("/{call_id}/end", status_code=204)
async def end(call_id: UUID, user: CurrentUser, db: Db):
    await lock_transitions(db)
    call = await call_for(db, call_id, user.id)
    if call.state != "ended":
        await finish(db, call)
    await db.commit()


@router.post("/{call_id}/block", status_code=204)
async def block(call_id: UUID, user: CurrentUser, db: Db):
    await lock_transitions(db)
    call = await call_for(db, call_id, user.id)
    other = next((person for _, person in await members(db, call) if person.id != user.id), None)
    if not other:
        raise HTTPException(409, "There is no participant to block.")
    await db.execute(insert(Block).values(user_id=user.id, blocked_id=other.id).on_conflict_do_nothing())
    active = await current_call(db, user.id)
    if active and any(person.id == other.id for _, person in await members(db, active)):
        await finish(db, active)
    await db.commit()


@router.post("/{call_id}/report", status_code=202)
async def report(call_id: UUID, payload: ReportInput, user: CurrentUser, db: Db):
    await throttle("report", str(user.id), 12, 3600)
    call = await call_for(db, call_id, user.id)
    other = next((person for _, person in await members(db, call) if person.id != user.id), None)
    if not other:
        raise HTTPException(409, "There is no participant to report.")
    await db.execute(insert(Report).values(
        reporter_id=user.id, subject_id=other.id, conversation_id=call.id, category=payload.category
    ).on_conflict_do_nothing(constraint="one_report_per_conversation"))
    await db.commit()
    return {"message": "Your report was saved."}
