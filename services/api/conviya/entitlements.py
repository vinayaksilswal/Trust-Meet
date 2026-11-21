from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from .models import PremiumAccess, Subscription
from .runtime import now


# Razorpay keeps retrying a "pending" charge, so access continues until the paid period ends.
PAID_STATES = {"active", "pending"}


def is_plus(subscription: Subscription | None) -> bool:
    if not subscription or subscription.status not in PAID_STATES:
        return False
    return subscription.current_end is None or subscription.current_end > now()


async def premium_until(db: AsyncSession, user_id: UUID) -> datetime | None:
    """End of the user's paid filter access from a day pass or Plus, if any is active."""
    ends = []
    access = await db.get(PremiumAccess, user_id)
    if access and access.ends_at > now():
        ends.append(access.ends_at)
    subscription = await db.get(Subscription, user_id)
    if is_plus(subscription):
        ends.append(subscription.current_end or datetime.max.replace(tzinfo=now().tzinfo))
    return max(ends) if ends else None
