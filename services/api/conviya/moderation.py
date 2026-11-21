"""Moderation console API.

Staff roles are granted only from the operator CLI (`python -m conviya.moderation_ops grant`),
never through the web, so a compromised browser session cannot promote itself. Every
decision is written to `moderation_actions` with the moderator, subject and note.
"""

from datetime import timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from .conversations import current_call, finish, lock_transitions
from .identity import CurrentUser, Db
from .models import (AccountSuspension, AgeVerificationSession, Conversation, LoginSession, ModerationAction, Report,
                     StaffRole, User)
from .rooms_models import PrivateRoom, RoomMember, RoomReport
from .runtime import now, throttle


router = APIRouter(prefix="/moderation", tags=["moderation"])
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
# Reports that put someone at risk are reviewed first.
URGENT = ("underage", "threat", "sexual_content")


async def suspend_user(db: AsyncSession, user: User, reviewer: str):
    """Suspend an account, sign it out everywhere, end its call and remove it from rooms.

    The maintenance worker then revokes any media access the account still holds.
    """
    await lock_transitions(db)
    user.status = "suspended"
    await db.execute(insert(AccountSuspension).values(user_id=user.id, suspended_by=reviewer[:100])
                     .on_conflict_do_nothing())
    await db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    await db.execute(delete(AgeVerificationSession).where(AgeVerificationSession.user_id == user.id))
    call = await current_call(db, user.id)
    if call:
        await finish(db, call)
    rooms = await db.execute(select(PrivateRoom, RoomMember).join(RoomMember).where(
        RoomMember.user_id == user.id, PrivateRoom.closed_at.is_(None), PrivateRoom.ends_at > now()
    ).order_by(PrivateRoom.id).with_for_update(of=PrivateRoom))
    for room, member in rooms:
        if room.owner_id == user.id:
            room.closed_at = now()
        else:
            member.state = "removed"
            member.updated_at = now()


async def reinstate_user(db: AsyncSession, user: User):
    user.status = "active"
    await db.execute(delete(AccountSuspension).where(AccountSuspension.user_id == user.id))


async def require_moderator(user: CurrentUser, db: Db) -> User:
    role = await db.get(StaffRole, user.id)
    if not role:
        # Look like a missing route so the console's existence is not advertised.
        raise HTTPException(404, "Endpoint not found.")
    return user


Moderator = Annotated[User, Depends(require_moderator)]


class Decision(BaseModel):
    action: Literal["dismiss", "suspend"]
    note: Note = ""


class AccountDecision(BaseModel):
    note: Note = ""


def report_ref(kind: str, *parts: UUID) -> str:
    # Underscores keep the reference valid as a single URL path segment.
    return "_".join([kind, *map(str, parts)])


def person(user: User | None):
    if not user:
        return None
    return {"id": user.id, "name": user.display_name, "email": user.email, "status": user.status,
            "created_at": user.created_at}


async def record(db: AsyncSession, moderator: User, action: str, subject: UUID | None, ref: str | None, note: str):
    db.add(ModerationAction(moderator_id=moderator.id, action=action, subject_id=subject, report_ref=ref, note=note))


async def target_for(db: AsyncSession, user_id: UUID, moderator: User) -> User:
    target = await db.get(User, user_id, with_for_update=True)
    if not target:
        raise HTTPException(404, "Account not found.")
    if target.id == moderator.id or await db.get(StaffRole, target.id):
        raise HTTPException(403, "Staff accounts are managed from the operator CLI.")
    return target


@router.get("/overview")
async def overview(moderator: Moderator, db: Db):
    open_reports = await db.scalar(select(func.count()).select_from(Report).where(Report.state == "open"))
    open_room_reports = await db.scalar(select(func.count()).select_from(RoomReport).where(RoomReport.state == "open"))
    urgent = await db.scalar(select(func.count()).select_from(Report).where(Report.state == "open", Report.category.in_(URGENT)))
    since = now() - timedelta(hours=24)
    return {
        "open_reports": open_reports + open_room_reports, "urgent_reports": urgent,
        "suspended_accounts": await db.scalar(select(func.count()).select_from(User).where(User.status == "suspended")),
        "active_calls": await db.scalar(select(func.count()).select_from(Conversation).where(Conversation.state == "active",
                                                                                            Conversation.expires_at > now())),
        "reports_24h": await db.scalar(select(func.count()).select_from(Report).where(Report.created_at > since)),
        "actions_24h": await db.scalar(select(func.count()).select_from(ModerationAction).where(ModerationAction.created_at > since)),
    }


@router.get("/reports")
async def reports(moderator: Moderator, db: Db, state: Literal["open", "closed"] = "open",
                  limit: Annotated[int, Query(ge=1, le=200)] = 100):
    states = ["open"] if state == "open" else ["actioned", "dismissed"]
    reporter, subject = aliased(User), aliased(User)
    # How many different people reported each subject, a stronger signal than one angry report.
    reporters = (select(Report.subject_id, func.count(func.distinct(Report.reporter_id)).label("reporters"))
                 .group_by(Report.subject_id).subquery())
    rows = (await db.execute(
        select(Report, reporter, subject, reporters.c.reporters)
        .join(reporter, reporter.id == Report.reporter_id).join(subject, subject.id == Report.subject_id)
        .join(reporters, reporters.c.subject_id == Report.subject_id)
        .where(Report.state.in_(states))
        .order_by(Report.category.in_(URGENT).desc() if state == "open" else Report.created_at.desc(),
                  reporters.c.reporters.desc(), Report.created_at)
        .limit(limit)
    )).all()
    items = [{
        "ref": report_ref("conversation", row.id), "kind": "conversation", "category": row.category,
        "state": row.state, "created_at": row.created_at, "reviewed_at": row.reviewed_at,
        "reporter": person(by), "subject": person(target), "subject_reporters": count,
        "urgent": row.category in URGENT,
    } for row, by, target, count in rows]

    owner, by = aliased(User), aliased(User)
    room_rows = (await db.execute(
        select(RoomReport, PrivateRoom, owner, by)
        .join(PrivateRoom, PrivateRoom.id == RoomReport.room_id).join(owner, owner.id == PrivateRoom.owner_id)
        .join(by, by.id == RoomReport.reporter_id)
        .where(RoomReport.state.in_(states)).order_by(RoomReport.created_at.desc()).limit(limit)
    )).all()
    items += [{
        "ref": report_ref("room", row.room_id, row.reporter_id), "kind": "room", "category": row.category,
        "state": row.state, "created_at": row.created_at, "reviewed_at": row.reviewed_at, "room": room.title,
        "reporter": person(reporter_user), "subject": person(host), "subject_reporters": None,
        "urgent": row.category in URGENT,
    } for row, room, host, reporter_user in room_rows]
    return {"reports": items}


@router.post("/reports/{ref}")
async def decide(ref: Annotated[str, StringConstraints(max_length=90)], payload: Decision, moderator: Moderator, db: Db):
    await throttle("moderation", str(moderator.id), 240, 600)
    kind, _, rest = ref.partition("_")
    try:
        ids = [UUID(part) for part in rest.split("_")]
    except ValueError as err:
        raise HTTPException(404, "Report not found.") from err
    if kind == "conversation" and len(ids) == 1:
        report = await db.get(Report, ids[0], with_for_update=True)
        subject_id = report.subject_id if report else None
    elif kind == "room" and len(ids) == 2:
        report = await db.get(RoomReport, tuple(ids), with_for_update=True)
        room = await db.get(PrivateRoom, ids[0]) if report else None
        subject_id = room.owner_id if room else None
    else:
        report = subject_id = None
    if not report or not subject_id:
        raise HTTPException(404, "Report not found.")
    if report.state != "open":
        raise HTTPException(409, "This report was already reviewed.")
    if payload.action == "suspend":
        target = await target_for(db, subject_id, moderator)
        if target.status != "suspended":
            await suspend_user(db, target, moderator.email)
        # One decision closes every open report about the same person.
        closed = {"state": "actioned", "reviewed_by": moderator.id, "reviewed_at": now()}
        await db.execute(update(Report).where(Report.subject_id == subject_id, Report.state == "open").values(**closed))
        await db.execute(update(RoomReport).where(
            RoomReport.state == "open", RoomReport.room_id.in_(select(PrivateRoom.id).where(PrivateRoom.owner_id == subject_id))
        ).values(**closed))
    report.state = "actioned" if payload.action == "suspend" else "dismissed"
    report.reviewed_by, report.reviewed_at = moderator.id, now()
    await record(db, moderator, payload.action, subject_id, ref, payload.note)
    await db.commit()
    return {"state": report.state}


@router.get("/accounts")
async def accounts(moderator: Moderator, db: Db, q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=254)]):
    pattern = "%" + q.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    users = (await db.scalars(select(User).where(or_(
        User.email.like(pattern, escape="\\"), func.lower(User.display_name).like(pattern, escape="\\"),
    )).order_by(User.created_at.desc()).limit(25))).all()
    if not users:
        return {"accounts": []}
    ids = [user.id for user in users]
    counts = dict((await db.execute(select(Report.subject_id, func.count()).where(Report.subject_id.in_(ids))
                                    .group_by(Report.subject_id))).all())
    staff = set(await db.scalars(select(StaffRole.user_id).where(StaffRole.user_id.in_(ids))))
    return {"accounts": [person(user) | {"reports": counts.get(user.id, 0), "staff": user.id in staff} for user in users]}


@router.post("/accounts/{user_id}/suspend")
async def suspend(user_id: UUID, payload: AccountDecision, moderator: Moderator, db: Db):
    await throttle("moderation", str(moderator.id), 240, 600)
    target = await target_for(db, user_id, moderator)
    if target.status != "suspended":
        await suspend_user(db, target, moderator.email)
        await record(db, moderator, "suspend", target.id, None, payload.note)
    await db.commit()
    return {"status": "suspended"}


@router.post("/accounts/{user_id}/reinstate")
async def reinstate(user_id: UUID, payload: AccountDecision, moderator: Moderator, db: Db):
    await throttle("moderation", str(moderator.id), 240, 600)
    target = await target_for(db, user_id, moderator)
    if target.status == "suspended":
        await reinstate_user(db, target)
        await record(db, moderator, "reinstate", target.id, None, payload.note)
    await db.commit()
    return {"status": "active"}


@router.get("/actions")
async def actions(moderator: Moderator, db: Db, limit: Annotated[int, Query(ge=1, le=200)] = 100):
    staff, subject = aliased(User), aliased(User)
    rows = (await db.execute(
        select(ModerationAction, staff, subject).join(staff, staff.id == ModerationAction.moderator_id)
        .outerjoin(subject, subject.id == ModerationAction.subject_id)
        .order_by(ModerationAction.created_at.desc()).limit(limit)
    )).all()
    return {"actions": [{
        "id": action.id, "action": action.action, "note": action.note, "report_ref": action.report_ref,
        "created_at": action.created_at, "moderator": staff_user.email, "subject": person(target),
    } for action, staff_user, target in rows]}
