from datetime import date
from typing import Protocol

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .entitlements import is_plus, premium_until
from .identity import CurrentUser, Db
from .models import Eligibility, Subscription, User
from .runtime import client_country, now, throttle


router = APIRouter(tags=["eligibility"])
LEGACY_DOCUMENT_CHECK = "veriff_identity"


class BirthDate(BaseModel):
    birth_date: date


class AgeAssurance(Protocol):
    name: str

    def is_adult(self, birth_date: date, today: date) -> bool: ...


class DevelopmentAgeAssurance:
    name = "development_self_report"

    def is_adult(self, birth_date: date, today: date) -> bool:
        age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        return age >= 18


class HostedAgeAssurance(DevelopmentAgeAssurance):
    # Keep recorded outcomes from the existing hosted date-of-birth form.
    name = "hosted_test_self_report"


def assurance_provider() -> AgeAssurance | None:
    if settings.environment == "production":
        return HostedAgeAssurance()
    if settings.environment in {"development", "test", "lan"} and settings.enable_dev_age_assurance:
        return DevelopmentAgeAssurance()
    return None


async def eligible(db: Db, user: User):
    row = await db.get(Eligibility, user.id)
    return has_adult_eligibility(user, row)


def has_adult_eligibility(user: User, row: Eligibility | None) -> bool:
    provider = assurance_provider()
    return bool(user.status == "active" and provider and
                row and row.is_adult and row.provider in {provider.name, LEGACY_DOCUMENT_CHECK})


async def require_eligible(user: CurrentUser, db: Db):
    if not await eligible(db, user):
        raise HTTPException(403, "Complete the age eligibility check before connecting.")
    return user


@router.get("/me")
async def me(request: Request, user: CurrentUser, db: Db):
    row = await db.get(Eligibility, user.id)
    provider = assurance_provider()
    return {
        "id": user.id, "display_name": user.display_name, "email": user.email,
        "eligible": has_adult_eligibility(user, row), "age_check_available": provider is not None,
        "age_check_underage": bool(provider and row and row.provider in {provider.name, LEGACY_DOCUMENT_CHECK} and not row.is_adult),
        "conversations_enabled": settings.enable_conversations,
        "matchmaking_enabled": settings.enable_matchmaking,
        "private_rooms_enabled": settings.enable_private_rooms,
        "plus": is_plus(await db.get(Subscription, user.id)),
        "premium_until": await premium_until(db, user.id),
        "gender": user.gender,
        "country": client_country(request) or None,
    }


@router.post("/eligibility")
async def check_age(payload: BirthDate, user: CurrentUser, db: Db):
    provider = assurance_provider()
    if provider is None:
        raise HTTPException(503, "Age assurance is unavailable.")
    today = now().date()
    if payload.birth_date > today or payload.birth_date.year < today.year - 125:
        raise HTTPException(422, "Enter a valid date of birth.")
    await throttle("eligibility", str(user.id), 5, 3600)
    await db.get(User, user.id, with_for_update=True)
    prior = await db.get(Eligibility, user.id)
    if prior and prior.provider in {provider.name, LEGACY_DOCUMENT_CHECK}:
        raise HTTPException(409, "This account already completed the age check.")
    is_adult = provider.is_adult(payload.birth_date, today)
    result = {"is_adult": is_adult, "provider": provider.name, "checked_at": now()}
    await db.execute(insert(Eligibility).values(user_id=user.id, **result).on_conflict_do_update(
        index_elements=[Eligibility.user_id], set_=result,
    ))
    await db.commit()
    return {"eligible": is_adult}
