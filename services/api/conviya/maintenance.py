import asyncio
from datetime import timedelta
import logging
from time import monotonic

from sqlalchemy import delete, func, select, update

from .config import settings
from .conversations import close_call_media, close_configured_media, finish, lock_transitions, revoke_configured_participant
from .models import AccountToken, AgeVerificationSession, Conversation, LoginSession
from .rooms import media_room, room_participants
from .rooms_models import PrivateRoom, RoomInvitation, RoomMember
from .event_loop import factory
from .runtime import MAINTENANCE_KEY, Sessions, cache, database_sqlstate, engine, now


logger = logging.getLogger(__name__)


async def maintain():
    next_heartbeat = 0.0
    while True:
        try:
            await sweep()
            if settings.public_conversations and monotonic() >= next_heartbeat:
                await cache.set(MAINTENANCE_KEY, "1", ex=90)
                next_heartbeat = monotonic() + 30
        except Exception as err:
            logger.error("Conversation maintenance failed (%s, SQLSTATE %s)", type(err).__name__, database_sqlstate(err))
        await asyncio.sleep(3)


async def sweep():
    stamp = now()
    async with Sessions() as db:
        await lock_transitions(db)
        stop_all = settings.public_conversations and not settings.enable_conversations
        expired = (await db.scalars(
            select(Conversation).where(
                Conversation.state != "ended",
                (Conversation.expires_at <= now()) | stop_all,
            ).limit(100)
        )).all()
        for call in expired:
            await finish(db, call)
        await db.execute(delete(AccountToken).where(AccountToken.expires_at <= now()))
        await db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
        await db.execute(delete(AgeVerificationSession).where(AgeVerificationSession.expires_at <= stamp))
        await db.commit()
    async with Sessions() as db:
        if settings.public_conversations and not settings.enable_private_rooms:
            await db.execute(update(PrivateRoom).where(PrivateRoom.closed_at.is_(None), PrivateRoom.ends_at > now())
                             .values(closed_at=func.now()))
        await db.commit()

    async with Sessions() as db:
        pending = (await db.scalars(select(Conversation).where(
            Conversation.state == "ended", Conversation.started_at.is_not(None),
            Conversation.media_closed_at.is_(None),
            (Conversation.media_retry_at.is_(None) | (Conversation.media_retry_at <= stamp)),
        ).order_by(Conversation.ended_at).limit(5).with_for_update(skip_locked=True))).all()
        for call in pending:
            # Self-hosted LiveKit can replay a still-valid grant after room deletion.
            # Clean up immediately, and again after the last issued grant has expired.
            if await close_call_media(db, call.id) and (settings.public_conversations or
                                                        call.ended_at <= now() - timedelta(seconds=35)):
                call.media_closed_at = now()
            else:
                call.media_retry_at = now() + timedelta(seconds=15)
        await db.commit()

    async with Sessions() as db:
        await db.execute(delete(RoomInvitation).where(RoomInvitation.expires_at <= now()))
        closed = (await db.scalars(select(PrivateRoom).where(
            (PrivateRoom.closed_at.is_not(None) | (PrivateRoom.ends_at <= now())),
            PrivateRoom.media_closed_at.is_(None),
            (PrivateRoom.media_retry_at.is_(None) | (PrivateRoom.media_retry_at <= stamp)),
        ).order_by(PrivateRoom.ends_at).limit(5).with_for_update(skip_locked=True))).all()
        for room in closed:
            boundary = room.closed_at or room.ends_at
            if await close_configured_media(db, media_room(room.id), await room_participants(db, room.id)) and (
                settings.public_conversations or boundary <= now() - timedelta(seconds=35)
            ):
                room.media_closed_at = now()
            else:
                room.media_retry_at = now() + timedelta(seconds=15)
        await db.commit()

    async with Sessions() as db:
        removed = (await db.scalars(select(RoomMember).join(PrivateRoom).where(
            RoomMember.state == "removed", RoomMember.media_revoked_at.is_(None),
            (RoomMember.media_retry_at.is_(None) | (RoomMember.media_retry_at <= stamp)),
            PrivateRoom.closed_at.is_(None), PrivateRoom.ends_at > now(),
        ).order_by(RoomMember.updated_at).limit(5).with_for_update(of=RoomMember, skip_locked=True))).all()
        for member in removed:
            if member.media_granted_at is None or await revoke_configured_participant(db, media_room(member.room_id), member.user_id):
                member.media_revoked_at = now()
            else:
                member.media_retry_at = now() + timedelta(seconds=15)
        await db.commit()


async def run_worker():
    try:
        await maintain()
    finally:
        await cache.aclose()
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(run_worker())
