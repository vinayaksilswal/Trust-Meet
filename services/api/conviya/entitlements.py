from .models import Subscription
from .runtime import now


# Razorpay keeps retrying a "pending" charge, so access continues until the paid period ends.
PAID_STATES = {"active", "pending"}


def is_plus(subscription: Subscription | None) -> bool:
    if not subscription or subscription.status not in PAID_STATES:
        return False
    return subscription.current_end is None or subscription.current_end > now()
