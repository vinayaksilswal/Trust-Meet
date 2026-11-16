import asyncio
from datetime import timedelta
from typing import Annotated, Literal
from uuid import UUID

from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, HTTPException
from livekit import api
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints
from sqlalchemy import func, select

from .config import settings
from .conversations import EligibleUser, Mode, blocked, delete_room, issue_media_grant, livekit
from .eligibility import eligible
from .identity import Db, Token, hash_slots, hasher
from .models import User
from .rooms_models import PrivateRoom, RoomInvitation, RoomMember
from .runtime import digest, new_token, now, throttle


router = APIRouter(prefix="/rooms", tags=["private rooms"])
RoomPassword = Annotated[str, StringConstraints(min_length=8, max_length=72)]


class RoomInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
    mode: Mode
    capacity: int = Field(ge=2, le=12)
    password: RoomPassword | None = None
    approval_required: bool = True
    starts_at: AwareDatetime | None = None
    duration_minutes: Literal[15, 30, 60, 120] = 30


class JoinInput(BaseModel):
    token: Token
    password: RoomPassword | None = None


class LockInput(BaseModel):
    locked: bool


def require_rooms():
    if not settings.enable_private_rooms:
        raise HTTPException(503, "Private rooms are currently unavailable.")


def media_room(id: UUID):
    return f"conviya-private-{id}"


async def read_room(db: Db, id: UUID, user: User, *, lock=False, host=False):
    query = select(PrivateRoom).where(PrivateRoom.id == id)
    room = await db.scalar(query.with_for_update() if lock else query)
    member = await db.get(RoomMember, (id, user.id))
    if not room or not member or (host and room.owner_id != user.id):
        raise HTTPException(404, "Room not found.")
    return room, member


def require_open(room: PrivateRoom):
    if room.closed_at or room.ends_at <= now():
        raise HTTPException(409, "This room has closed.")


async def check_capacity(db: Db, room: PrivateRoom):
    approved = await db.scalar(select(func.count()).select_from(RoomMember).where(
        RoomMember.room_id == room.id, RoomMember.state == "approved",
    ))
    if approved >= room.capacity:
        raise HTTPException(409, "This room is at capacity.")


def describe(room: PrivateRoom, member: RoomMember):
    return {
        "id": room.id, "title": room.title, "mode": room.mode, "starts_at": room.starts_at,
        "ends_at": room.ends_at, "capacity": room.capacity, "state": member.state,
        "locked": room.locked, "host": room.owner_id == member.user_id,
        "closed": bool(room.closed_at or room.ends_at <= now()),
    }


async def host_roster(db: Db, room: PrivateRoom):
    rows = (await db.execute(select(RoomMember, User.display_name)
        .join(User, User.id == RoomMember.user_id)
        .where(RoomMember.room_id == room.id, RoomMember.user_id != room.owner_id,
               RoomMember.state.in_(("waiting", "approved")))
        .order_by(RoomMember.updated_at))).all()
    return [{"id": member.user_id, "name": name, "state": member.state} for member, name in rows]


@router.get("")
async def list_rooms(db: Db, user: EligibleUser):
    require_rooms()
    rows = (await db.execute(
        select(PrivateRoom, RoomMember).join(RoomMember).where(
            RoomMember.user_id == user.id, PrivateRoom.ends_at > now(),
            PrivateRoom.closed_at.is_(None), RoomMember.state.in_(("approved", "waiting")),
        ).order_by(PrivateRoom.starts_at)
    )).all()
    return [describe(room, member) for room, member in rows]


@router.post("", status_code=201)
async def create(payload: RoomInput, db: Db, user: EligibleUser):
    require_rooms()
    await throttle("room-create", str(user.id), 12, 3600)
    stamp = now()
    start = payload.starts_at or stamp
    if start < stamp - timedelta(minutes=1) or start > stamp + timedelta(days=30):
        raise HTTPException(422, "Schedule the room within the next 30 days.")
    password_hash = None
    if payload.password:
        async with hash_slots:
            password_hash = await asyncio.to_thread(hasher.hash, payload.password)
    room = PrivateRoom(
        owner_id=user.id, title=payload.title, mode=payload.mode, capacity=payload.capacity,
        password_hash=password_hash, approval_required=payload.approval_required, starts_at=max(stamp, start),
        ends_at=max(stamp, start) + timedelta(minutes=payload.duration_minutes),
    )
    db.add(room)
    await db.flush()
    membership = RoomMember(room_id=room.id, user_id=user.id, state="approved")
    db.add(membership)
    await db.commit()
    return describe(room, membership)


@router.post("/join")
async def join(payload: JoinInput, db: Db, user: EligibleUser):
    require_rooms()
    await throttle("room-join", str(user.id), 20, 300)
    invitation = await db.get(RoomInvitation, digest(payload.token))
    if not invitation or invitation.expires_at <= now():
        raise HTTPException(404, "This invitation is unavailable or expired.")
    room = await db.scalar(select(PrivateRoom).where(PrivateRoom.id == invitation.room_id).with_for_update())
    if not room or room.closed_at or room.ends_at <= now() or room.locked:
        raise HTTPException(404, "This invitation is unavailable or expired.")
    membership = await db.get(RoomMember, (room.id, user.id))
    if membership and membership.state == "removed":
        raise HTTPException(404, "This invitation is unavailable or expired.")
    if await blocked(db, user.id, room.owner_id):
        raise HTTPException(404, "This invitation is unavailable or expired.")
    host = await db.get(User, room.owner_id)
    if not host or not await eligible(db, host):
        raise HTTPException(404, "This invitation is unavailable or expired.")
    if membership and membership.state in {"approved", "waiting"}:
        return describe(room, membership)
    if room.password_hash:
        try:
            async with hash_slots:
                await asyncio.to_thread(hasher.verify, room.password_hash, payload.password or "")
        except VerifyMismatchError as err:
            raise HTTPException(403, "The room password is incorrect.") from err
    if room.approval_required:
        waiting = await db.scalar(select(func.count()).select_from(RoomMember).where(
            RoomMember.room_id == room.id, RoomMember.state == "waiting",
        ))
        if waiting >= 24:
            raise HTTPException(409, "The waiting room is full.")
    else:
        await check_capacity(db, room)
    decision = "waiting" if room.approval_required else "approved"
    if membership:
        membership.state, membership.updated_at = decision, now()
    else:
        membership = RoomMember(room_id=room.id, user_id=user.id, state=decision)
        db.add(membership)
    await db.commit()
    return describe(room, membership)


@router.get("/{id}")
async def status(id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    room, membership = await read_room(db, id, user)
    return {**describe(room, membership), "participants": await host_roster(db, room) if room.owner_id == user.id else []}


@router.post("/{id}/invitations", status_code=201)
async def invite(id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    await throttle("room-invites", str(user.id), 12, 300)
    room, _ = await read_room(db, id, user, lock=True, host=True)
    require_open(room)
    if room.locked:
        raise HTTPException(409, "Unlock the room to create invitations.")
    token = new_token()
    expiry = min(max(now(), room.starts_at) + timedelta(hours=1), room.ends_at)
    db.add(RoomInvitation(token_hash=digest(token), room_id=id, expires_at=expiry))
    await db.commit()
    return {"token": token, "expires_at": expiry}


@router.post("/{id}/lock", status_code=204)
async def lock(id: UUID, payload: LockInput, db: Db, user: EligibleUser):
    require_rooms()
    room, _ = await read_room(db, id, user, lock=True, host=True)
    require_open(room)
    room.locked = payload.locked
    await db.commit()


@router.post("/{id}/members/{member_id}/approve", status_code=204)
async def approve(id: UUID, member_id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    room, _ = await read_room(db, id, user, lock=True, host=True)
    require_open(room)
    member = await db.get(RoomMember, (id, member_id))
    candidate = await db.get(User, member_id)
    if not member or not candidate or not await eligible(db, candidate) or await blocked(db, user.id, member_id):
        raise HTTPException(404, "Participant not found.")
    if member.state == "approved":
        return
    if room.locked or member.state != "waiting":
        raise HTTPException(409, "This participant cannot be admitted.")
    await check_capacity(db, room)
    member.state, member.updated_at = "approved", now()
    await db.commit()


@router.post("/{id}/media")
async def media(id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    await throttle("room-media", str(user.id), 24, 300)
    room, member = await read_room(db, id, user, lock=True)
    require_open(room)
    if member.state != "approved" or room.starts_at > now():
        raise HTTPException(403, "The room is awaiting admission or has not started.")
    host = await db.get(User, room.owner_id)
    if not host or not await eligible(db, host) or await blocked(db, user.id, room.owner_id):
        raise HTTPException(403, "The room is unavailable.")
    return issue_media_grant(media_room(id), str(user.id), room.mode, room.ends_at, user.display_name)


async def disconnect(id: UUID, member_id: UUID):
    try:
        async with livekit() as client:
            await client.room.remove_participant(api.RoomParticipantIdentity(room=media_room(id), identity=str(member_id)))
    except api.TwirpError as err:
        if err.code != "not_found":
            raise HTTPException(503, "Media disconnection is temporarily unavailable.") from err
    except (TimeoutError, OSError) as err:
        raise HTTPException(503, "Media disconnection is temporarily unavailable.") from err


@router.post("/{id}/members/{member_id}/remove", status_code=204)
async def remove(id: UUID, member_id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    room, _ = await read_room(db, id, user, lock=True, host=True)
    require_open(room)
    member = await db.get(RoomMember, (id, member_id))
    if not member or member_id == user.id:
        raise HTTPException(404, "Participant not found.")
    member.state, member.updated_at = "removed", now()
    await db.commit()
    await disconnect(id, member_id)


@router.post("/{id}/members/{member_id}/mute", status_code=204)
async def mute(id: UUID, member_id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    room, _ = await read_room(db, id, user, host=True)
    require_open(room)
    member = await db.get(RoomMember, (id, member_id))
    if not member or member.state != "approved" or member_id == user.id:
        raise HTTPException(404, "Participant not found.")
    identity = api.RoomParticipantIdentity(room=media_room(id), identity=str(member_id))
    try:
        async with livekit() as client:
            participant = await client.room.get_participant(identity)
            for track in participant.tracks:
                if track.source == api.TrackSource.MICROPHONE:
                    await client.room.mute_published_track(
                        api.MuteRoomTrackRequest(room=identity.room, identity=identity.identity, track_sid=track.sid, muted=True)
                    )
    except api.TwirpError as err:
        status_code = 409 if err.code == "not_found" else 503
        raise HTTPException(status_code, "The participant could not be muted.") from err
    except (TimeoutError, OSError) as err:
        raise HTTPException(503, "The participant could not be muted.") from err


@router.post("/{id}/close", status_code=204)
async def close(id: UUID, db: Db, user: EligibleUser):
    require_rooms()
    room, _ = await read_room(db, id, user, lock=True, host=True)
    room.closed_at = room.closed_at or now()
    await db.commit()
    await delete_room(media_room(id))
