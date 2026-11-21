from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .identity import CurrentUser, Db
from .models import User
from .runtime import throttle


router = APIRouter(prefix="/profile", tags=["profile"])


class GenderInput(BaseModel):
    # Self-declared and optional. People who match only one gender never see people who left this blank.
    gender: Literal["male", "female", "other"] | None


@router.post("/gender")
async def set_gender(payload: GenderInput, user: CurrentUser, db: Db):
    await throttle("profile", str(user.id), 20, 3600)
    row = await db.get(User, user.id, with_for_update=True)
    row.gender = payload.gender
    await db.commit()
    return {"gender": row.gender}
