import argparse
import asyncio
import json

from email_validator import validate_email
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from .event_loop import factory
from .moderation import suspend_user
from .models import Report, StaffRole, User
from .rooms_models import RoomReport
from .runtime import Sessions, engine


async def manage(args):
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
        user = await db.scalar(select(User).where(User.email == email).with_for_update())
        if not user:
            raise SystemExit("No account found for this address.")
        if args.action == "grant":
            # Confirm the person controls this account before granting: sign-up does not verify email.
            values = {"role": args.role, "granted_by": reviewer}
            await db.execute(insert(StaffRole).values(user_id=user.id, **values)
                             .on_conflict_do_update(index_elements=[StaffRole.user_id], set_=values))
            await db.commit()
            print(f"Granted {args.role}. The console is at /moderation.")
            return
        if args.action == "revoke":
            await db.execute(delete(StaffRole).where(StaffRole.user_id == user.id))
            await db.commit()
            print("Staff access removed.")
            return
        await suspend_user(db, user, reviewer)
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
    grant = actions.add_parser("grant", help="Give an account access to the moderation console")
    grant.add_argument("--email", required=True)
    grant.add_argument("--reviewer", required=True)
    grant.add_argument("--role", choices=["moderator", "admin"], default="moderator")
    revoke = actions.add_parser("revoke", help="Remove moderation console access")
    revoke.add_argument("--email", required=True)
    revoke.add_argument("--reviewer", required=True)
    actions.add_parser("reports")
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
