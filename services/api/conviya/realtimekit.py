from datetime import datetime, timedelta
import logging
from uuid import UUID

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import RealtimeMeeting, RealtimeParticipant
from .runtime import now


logger = logging.getLogger(__name__)


class RealtimeKitError(Exception):
    def __init__(self, status: int | None = None):
        self.status = status


async def request(method: str, path: str, payload: dict | None = None):
    base = (f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}"
            f"/realtime/kit/{UUID(settings.cloudflare_realtimekit_app_id)}/meetings")
    try:
        async with ClientSession(timeout=ClientTimeout(total=4)) as client:
            async with client.request(method, base + path, json=payload, allow_redirects=False,
                                      headers={"Authorization": f"Bearer {settings.cloudflare_api_token}"}) as response:
                if response.status >= 300:
                    raise RealtimeKitError(response.status)
                body = await response.json()
                if not isinstance(body, dict) or body.get("success") is not True:
                    raise RealtimeKitError(response.status)
                return body.get("data")
    except (ClientError, TimeoutError, ValueError) as exc:
        raise RealtimeKitError() from exc


async def grant(db: AsyncSession, name: str, user: UUID, mode: str, expires_at: datetime, display_name: str):
    # The calling endpoint holds its ACL lock until it commits the provider IDs.
    presets = {"video": settings.realtimekit_video_preset, "audio": settings.realtimekit_audio_preset,
               "text": settings.realtimekit_text_preset}
    try:
        meeting = await db.get(RealtimeMeeting, name)
        if meeting is None:
            created = await request("POST", "", {"title": name, "record_on_start": False})
            meeting = RealtimeMeeting(name=name, meeting_id=UUID(created["id"]))
            db.add(meeting)
            await db.flush()
        participants = f"/{meeting.meeting_id}/participants"
        member = await db.get(RealtimeParticipant, (name, user))
        expires = {"expires_on": min(expires_at, now() + timedelta(minutes=2)).isoformat()}
        if member is None:
            issued = await request("POST", participants, {"custom_participant_id": str(user), "name": display_name,
                                   "preset_name": presets[mode], "token": expires})
            db.add(RealtimeParticipant(meeting_name=name, user_id=user, participant_id=UUID(issued["id"])))
        else:
            issued = await request("POST", f"{participants}/{member.participant_id}/token", expires)
        token = issued["token"]
        if not isinstance(token, str) or not token:
            raise RealtimeKitError()
        return {"provider": "realtimekit", "token": token}
    except (RealtimeKitError, KeyError, TypeError, ValueError) as err:
        logger.warning("RealtimeKit grant failed (status %s)", getattr(err, "status", None))
        raise HTTPException(503, "Media service is temporarily unavailable.") from err


async def close(db: AsyncSession, meeting: RealtimeMeeting) -> bool:
    try:
        await request("PATCH", f"/{meeting.meeting_id}", {"status": "INACTIVE"})
    except RealtimeKitError as err:
        logger.warning("RealtimeKit meeting cleanup failed (status %s)", err.status)
        return False
    await db.execute(delete(RealtimeParticipant).where(RealtimeParticipant.meeting_name == meeting.name))
    return True


async def remove(db: AsyncSession, meeting: RealtimeMeeting, user_id: UUID) -> bool:
    member = await db.get(RealtimeParticipant, (meeting.name, user_id))
    if member is None:
        return True
    try:
        await request("DELETE", f"/{meeting.meeting_id}/participants/{member.participant_id}")
    except RealtimeKitError as err:
        if err.status != 404:
            logger.warning("RealtimeKit participant removal failed (status %s)", err.status)
            return False
    await db.delete(member)
    return True


async def mute(meeting: RealtimeMeeting, user_id: UUID):
    try:
        muted = await request("POST", f"/{meeting.meeting_id}/active-session/mute", {"custom_participant_ids": [str(user_id)]})
        if not isinstance(muted, dict) or not muted.get("participants"):
            raise RealtimeKitError(404)
    except RealtimeKitError as err:
        raise HTTPException(409 if err.status == 404 else 503, "The participant could not be muted.") from err
