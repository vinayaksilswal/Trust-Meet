import argparse
import asyncio
import json

from email_validator import validate_email
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .conversations import current_call, finish, lock_transitions
from .event_loop import factory
from .models import AccountSuspension, AgeVerificationSession, LoginSession, Report, User
from .rooms_models import PrivateRoom, RoomMember, RoomReport
from .runtime import Sessions, engine, now


async def manage(args):
    if settings.environment != "production":
        raise SystemExit("Configure production moderation before using these commands.")
    async with Sessions() as db:
        if args.action == "reports":
            for kind, model in (("conversation", Report), ("room", RoomReport)):
                reports = await db.scalars(select(model).order_by(model.created_at.desc()).limit(100))
                for report in reports:
                    print(json.dumps({
                        "kind": kind,
                        "target": str(report.subject_id if kind == "conversation" else report.room_id),
                        "reporter": str(report.reporter_id), "category": report.category,
                        "created_at": report.created_at.isoformat(),
                    }))
            return

        email = validate_email(args.email, check_deliverability=False).normalized.casefold()
        reviewer = args.reviewer.strip()
        if not reviewer or len(reviewer) > 100:
            raise SystemExit("Supply the operator account identifier as --reviewer.")
        await lock_transitions(db)
        user = await db.scalar(select(User).where(User.email == email).with_for_update())
        if not user:
            raise SystemExit("No account found for this address.")
        user.status = "suspended"
        await db.execute(insert(AccountSuspension).values(user_id=user.id, suspended_by=reviewer)
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
        await db.commit()
        print("Suspended. The media worker will revoke access.")


async def run(args):
    try:
        await manage(args)
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Trust Meet moderation operations")
    actions = parser.add_subparsers(dest="action", required=True)
    command = actions.add_parser("suspend")
    command.add_argument("--email", required=True)
    command.add_argument("--reviewer", required=True)
    actions.add_parser("reports")
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
