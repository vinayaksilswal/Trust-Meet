from datetime import date
from typing import Protocol

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .identity import CurrentUser, Db, admission_allows, can_sign_in
from .models import Eligibility, User
from .runtime import now, throttle


router = APIRouter(tags=["eligibility"])


class BirthDate(BaseModel):
    birth_date: date


class AgeAssurance(Protocol):
    name: str

    def is_adult(self, birth_date: date, today: date) -> bool: ...


class DevelopmentAgeAssurance:
    name = "development_self_report"

    def is_adult(self, birth_date: date, today: date) -> bool:
        return (today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))) >= 18


def assurance_provider() -> AgeAssurance | None:
    if settings.environment in {"development", "test", "lan"} and settings.enable_dev_age_assurance:
        return DevelopmentAgeAssurance()
    return None


async def eligible(db: Db, user: User):
    if settings.hosted_invite_beta:
        return bool(user.status == "active" and user.email_verified_at and await admission_allows(db, user.email))
    row = await db.get(Eligibility, user.id)
    provider = assurance_provider()
    return bool(can_sign_in(user) and user.status == "active" and provider and
                row and row.is_adult and row.provider == provider.name)


async def require_eligible(user: CurrentUser, db: Db):
    if not await eligible(db, user):
        raise HTTPException(403, "Complete the age eligibility check before connecting.")
    return user


@router.get("/me")
async def me(user: CurrentUser, db: Db):
    return {
        "id": user.id, "display_name": user.display_name, "email": user.email,
        "eligible": await eligible(db, user), "age_check_available": assurance_provider() is not None,
        "conversations_enabled": settings.enable_conversations,
        "matchmaking_enabled": settings.enable_matchmaking,
        "private_rooms_enabled": settings.enable_private_rooms,
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
    if prior:
        raise HTTPException(409, "This account already completed the age check.")
    is_adult = provider.is_adult(payload.birth_date, today)
    await db.execute(insert(Eligibility).values(user_id=user.id, is_adult=is_adult, provider=provider.name))
    await db.commit()
    return {"eligible": is_adult}
