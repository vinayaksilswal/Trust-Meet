import asyncio
from datetime import timedelta
import logging

from sqlalchemy import delete, select

from .conversations import delete_media, delete_room, finish, lock_transitions
from .models import AccountToken, Conversation, LoginSession
from .rooms import media_room
from .rooms_models import PrivateRoom, RoomInvitation
from .runtime import Sessions, now


logger = logging.getLogger(__name__)


async def maintain():
    while True:
        try:
            await sweep()
        except Exception as err:
            logger.error("Conversation maintenance failed (%s)", type(err).__name__)
        await asyncio.sleep(3)


async def sweep():
    async with Sessions() as db:
        await lock_transitions(db)
        expired = (await db.scalars(
            select(Conversation).where(Conversation.state != "ended", Conversation.expires_at <= now()).limit(100)
        )).all()
        for call in expired:
            await finish(db, call)
        await db.execute(delete(AccountToken).where(AccountToken.expires_at <= now()))
        await db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
        await db.commit()

    async with Sessions() as db:
        pending = (await db.scalars(select(Conversation).where(
            Conversation.state == "ended", Conversation.started_at.is_not(None),
            Conversation.media_closed_at.is_(None),
        ).order_by(Conversation.ended_at).limit(20).with_for_update(skip_locked=True))).all()
        for call in pending:
            # Self-hosted LiveKit can replay a still-valid grant after room deletion.
            # Clean up immediately, and again after the last issued grant has expired.
            if await delete_media(call.id) and call.ended_at <= now() - timedelta(seconds=35):
                call.media_closed_at = now()
        await db.commit()

    async with Sessions() as db:
        await db.execute(delete(RoomInvitation).where(RoomInvitation.expires_at <= now()))
        closed = (await db.scalars(select(PrivateRoom).where(
            (PrivateRoom.closed_at.is_not(None) | (PrivateRoom.ends_at <= now())),
            PrivateRoom.media_closed_at.is_(None),
        ).order_by(PrivateRoom.ends_at).limit(10).with_for_update(skip_locked=True))).all()
        for room in closed:
            boundary = room.closed_at or room.ends_at
            if await delete_room(media_room(room.id)) and boundary <= now() - timedelta(seconds=35):
                room.media_closed_at = now()
        await db.commit()