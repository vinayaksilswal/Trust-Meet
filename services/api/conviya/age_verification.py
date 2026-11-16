from datetime import date, timedelta
from hmac import compare_digest, digest
import json
from urllib.parse import urlsplit
from uuid import UUID

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .identity import CurrentUser, Db
from .models import AgeVerificationSession, Eligibility, User
from .runtime import now, throttle


router = APIRouter(prefix="/eligibility", tags=["age verification"])
PROVIDER = "veriff_identity"


def adult_on(birthday: date, today: date):
    return today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day)) >= 18


def sign(data: bytes):
    return digest(settings.veriff_shared_secret.encode(), data, "sha256").hex()


def can_redirect(url: str):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname
                and parsed.hostname.endswith((".veriff.com", ".veriff.me"))
                and parsed.netloc == parsed.hostname and not parsed.fragment)
    except ValueError:
        return False


async def provider_request(path: str, proof: bytes, body: bytes | None = None):
    headers = {
        "X-AUTH-CLIENT": settings.veriff_api_key,
        "X-HMAC-SIGNATURE": sign(proof),
        "Content-Type": "application/json",
    }
    try:
        async with ClientSession(timeout=ClientTimeout(total=7)) as client:
            async with client.request(
                "GET" if body is None else "POST", settings.veriff_api_url + path,
                headers=headers, data=body, allow_redirects=False,
            ) as response:
                if response.status != 200 and response.status != 201:
                    raise ValueError("Unexpected provider response")
                raw = await response.read()
                signature = response.headers.get("X-HMAC-SIGNATURE", "")
                if not compare_digest(signature.encode(), sign(raw).encode()):
                    raise ValueError("Invalid provider signature")
                result = json.loads(raw)
                if not isinstance(result, dict) or result.get("status") != "success":
                    raise ValueError("Unexpected provider response")
                return result
    except (ClientError, TimeoutError, ValueError):
        raise HTTPException(503, "Age verification is temporarily unavailable. Try again shortly.") from None


async def lock_account(db: Db, user_id: UUID):
    if not settings.public_conversations:
        raise HTTPException(404, "Age verification is unavailable.")
    status = await db.scalar(select(User.status).where(User.id == user_id).with_for_update())
    if status != "active":
        raise HTTPException(403, "This account cannot verify eligibility.")


def completed(row: Eligibility | None):
    if row and row.provider == PROVIDER:
        return "verified" if row.is_adult else "underage"
    return None


def parse_decision(result: dict, session_id: UUID, user_id: UUID, today: date):
    verification = result.get("verification")
    if verification is None:
        return "pending"
    if not isinstance(verification, dict) or verification.get("id") != str(session_id) or verification.get("vendorData") != str(user_id):
        raise HTTPException(503, "The verification result could not be confirmed.")
    status = verification.get("status")
    if status in {"declined", "expired", "abandoned"}:
        return "retry"
    if status != "approved" or verification.get("code") != 9001:
        return "pending"
    person = verification.get("person")
    try:
        birth_date = date.fromisoformat(person["dateOfBirth"])
        if birth_date > today or today.year - birth_date.year > 125:
            raise ValueError("Invalid birth date")
    except (KeyError, TypeError, ValueError):
        raise HTTPException(503, "Your verified birth date is unavailable. Contact support.") from None
    return "verified" if adult_on(birth_date, today) else "underage"


@router.post("/start")
async def start(user: CurrentUser, db: Db):
    await lock_account(db, user.id)
    result = completed(await db.get(Eligibility, user.id))
    if result:
        return {"state": result}
    pending = await db.get(AgeVerificationSession, user.id)
    if pending and pending.expires_at > now():
        return {"state": "pending", "url": pending.resume_url}

    await throttle("age-provider-start", str(user.id), 3, 86400)
    body = json.dumps({"verification": {
        "callback": settings.web_origin + "/account?age_verification=return",
        "vendorData": str(user.id),
    }}).encode()
    response = await provider_request("/v1/sessions", body, body)
    try:
        data = response["verification"]
        provider_session_id = UUID(data["id"])
        url = data["url"]
        if not isinstance(url, str) or not can_redirect(url):
            raise ValueError("Invalid provider link")
    except (KeyError, TypeError, AttributeError, ValueError):
        raise HTTPException(503, "Age verification is temporarily unavailable.") from None

    statement = insert(AgeVerificationSession).values(
        user_id=user.id, provider_session_id=provider_session_id,
        resume_url=url, expires_at=now() + timedelta(days=7),
    )
    await db.execute(statement.on_conflict_do_update(index_elements=[AgeVerificationSession.user_id], set_={
        "provider_session_id": statement.excluded.provider_session_id,
        "resume_url": statement.excluded.resume_url,
        "expires_at": statement.excluded.expires_at,
    }))
    await db.commit()
    return {"state": "pending", "url": url}


@router.post("/status")
async def status(user: CurrentUser, db: Db):
    await lock_account(db, user.id)
    result = completed(await db.get(Eligibility, user.id))
    if result:
        return {"state": result}
    pending = await db.get(AgeVerificationSession, user.id)
    if not pending or pending.expires_at <= now():
        return {"state": "retry"}

    await throttle("age-provider-status", str(user.id), 12, 60)
    identifier = str(pending.provider_session_id)
    response = await provider_request(f"/v1/sessions/{identifier}/decision", identifier.encode())
    state = parse_decision(response, pending.provider_session_id, user.id, now().date())
    if state != "pending":
        await db.delete(pending)
        if state != "retry":
            statement = insert(Eligibility).values(
                user_id=user.id, is_adult=state == "verified", provider=PROVIDER, checked_at=now(),
            )
            await db.execute(statement.on_conflict_do_update(index_elements=[Eligibility.user_id], set_={
                "is_adult": statement.excluded.is_adult,
                "provider": statement.excluded.provider,
                "checked_at": statement.excluded.checked_at,
            }))
        await db.commit()
    return {"state": state}
