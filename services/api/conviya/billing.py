"""Razorpay subscription billing.

Checkout runs in the browser with Razorpay Checkout. The API creates the subscription,
verifies the checkout signature, and treats Razorpay's own subscription record as the
source of truth: both the checkout callback and signed webhooks re-read the subscription
from the Razorpay API instead of trusting the order in which events arrive.
"""

from base64 import b64encode
from datetime import UTC, datetime
import hashlib
import hmac
import json
import logging
from typing import Annotated

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .eligibility import require_eligible
from .entitlements import is_plus
from .identity import CurrentUser, Db
from .models import BillingEvent, Subscription, User
from .runtime import now, throttle


router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)
ProviderId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_]{6,40}$")]
Signature = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
# Razorpay subscription states that still hold, or may still become, a paid entitlement.
OPEN_STATES = {"created", "authenticated", "active", "pending"}
API_BASE = "https://api.razorpay.com/v1"


class RazorpayError(Exception):
    def __init__(self, status: int | None = None):
        self.status = status


class CheckoutProof(BaseModel):
    razorpay_payment_id: ProviderId
    razorpay_subscription_id: ProviderId
    razorpay_signature: Signature


def billing_enabled():
    return settings.enable_billing


def require_billing():
    if not billing_enabled():
        raise HTTPException(503, "Subscriptions are not available yet.")


async def razorpay(method: str, path: str, payload: dict | None = None) -> dict:
    credentials = b64encode(f"{settings.razorpay_key_id}:{settings.razorpay_key_secret}".encode()).decode()
    try:
        async with ClientSession(timeout=ClientTimeout(total=8)) as client:
            async with client.request(method, API_BASE + path, json=payload, allow_redirects=False,
                                      headers={"Authorization": "Basic " + credentials}) as response:
                body = await response.json(content_type=None)
                if response.status >= 300 or not isinstance(body, dict):
                    raise RazorpayError(response.status)
                return body
    except (ClientError, TimeoutError, ValueError) as exc:
        raise RazorpayError() from exc


def signature_matches(secret: str, message: bytes, supplied: str) -> bool:
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), supplied.encode(errors="replace"))


def epoch(value) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if isinstance(value, int) and value > 0 else None


def apply_remote(subscription: Subscription, remote: dict):
    status = remote.get("status")
    if not isinstance(status, str) or remote.get("id") != subscription.provider_subscription_id:
        raise RazorpayError()
    if remote.get("plan_id") != subscription.plan_id:
        logger.error("Razorpay subscription plan does not match the stored plan")
        raise RazorpayError()
    subscription.status = status[:16]
    subscription.current_end = epoch(remote.get("current_end"))
    subscription.updated_at = now()


async def sync(subscription: Subscription):
    apply_remote(subscription, await razorpay("GET", f"/subscriptions/{subscription.provider_subscription_id}"))


def describe(subscription: Subscription | None):
    if not subscription:
        return None
    return {
        "status": subscription.status,
        "current_end": subscription.current_end.isoformat() if subscription.current_end else None,
        "cancel_requested": subscription.cancel_requested_at is not None,
    }


@router.get("")
async def overview(user: CurrentUser, db: Db):
    subscription = await db.get(Subscription, user.id)
    return {
        "enabled": billing_enabled(),
        "key_id": settings.razorpay_key_id if billing_enabled() else None,
        "plan": {"name": "Plus", "price_inr": settings.plus_price_inr, "interval": "month"},
        "plus": is_plus(subscription),
        "subscription": describe(subscription),
    }


@router.post("/subscribe")
async def subscribe(user: CurrentUser, db: Db):
    require_billing()
    await require_eligible(user, db)
    await throttle("billing:subscribe", str(user.id), 6, 3600)
    await db.get(User, user.id, with_for_update=True)
    subscription = await db.get(Subscription, user.id)
    if subscription and subscription.status in OPEN_STATES:
        if is_plus(subscription) or subscription.status == "authenticated":
            raise HTTPException(409, "Your Plus subscription is already set up.")
        if subscription.plan_id == settings.razorpay_plus_plan_id and subscription.status == "created":
            return {"subscription_id": subscription.provider_subscription_id, "key_id": settings.razorpay_key_id}
    try:
        remote = await razorpay("POST", "/subscriptions", {
            "plan_id": settings.razorpay_plus_plan_id, "total_count": 120, "quantity": 1,
            "customer_notify": 1, "notes": {"user_id": str(user.id)},
        })
    except RazorpayError as err:
        logger.warning("Razorpay subscription creation failed (status %s)", err.status)
        raise HTTPException(503, "Payments are temporarily unavailable. Please try again.") from err
    remote_id = remote.get("id")
    if not isinstance(remote_id, str):
        raise HTTPException(503, "Payments are temporarily unavailable. Please try again.")
    values = {"provider_subscription_id": remote_id, "plan_id": settings.razorpay_plus_plan_id,
              "status": "created", "current_end": None, "cancel_requested_at": None, "updated_at": now()}
    await db.execute(insert(Subscription).values(user_id=user.id, **values).on_conflict_do_update(
        index_elements=[Subscription.user_id], set_=values,
    ))
    await db.commit()
    return {"subscription_id": remote_id, "key_id": settings.razorpay_key_id}


@router.post("/verify")
async def verify(payload: CheckoutProof, user: CurrentUser, db: Db):
    require_billing()
    await throttle("billing:verify", str(user.id), 20, 3600)
    subscription = await db.get(Subscription, user.id, with_for_update=True)
    message = f"{payload.razorpay_payment_id}|{payload.razorpay_subscription_id}".encode()
    if (not subscription or subscription.provider_subscription_id != payload.razorpay_subscription_id
            or not signature_matches(settings.razorpay_key_secret, message, payload.razorpay_signature)):
        raise HTTPException(400, "We could not confirm this payment.")
    try:
        await sync(subscription)
    except RazorpayError as err:
        await db.rollback()
        raise HTTPException(503, "Payment received. Your plan will update in a few minutes.") from err
    await db.commit()
    return {"plus": is_plus(subscription), "subscription": describe(subscription)}


@router.post("/cancel")
async def cancel(user: CurrentUser, db: Db):
    require_billing()
    await throttle("billing:cancel", str(user.id), 6, 3600)
    subscription = await db.get(Subscription, user.id, with_for_update=True)
    if not subscription or subscription.status not in OPEN_STATES:
        raise HTTPException(409, "There is no subscription to cancel.")
    path = f"/subscriptions/{subscription.provider_subscription_id}/cancel"
    try:
        # Paid plans run to the end of the paid period; unpaid ones end immediately.
        remote = await razorpay("POST", path, {"cancel_at_cycle_end": 1 if is_plus(subscription) else 0})
        apply_remote(subscription, remote)
    except RazorpayError as err:
        await db.rollback()
        raise HTTPException(503, "Payments are temporarily unavailable. Please try again.") from err
    subscription.cancel_requested_at = now()
    await db.commit()
    return {"plus": is_plus(subscription), "subscription": describe(subscription)}


@router.post("/webhook")
async def webhook(request: Request, db: Db):
    if not billing_enabled():
        raise HTTPException(404, "Endpoint not found.")
    body = await request.body()
    supplied = request.headers.get("x-razorpay-signature", "")
    if not signature_matches(settings.razorpay_webhook_secret, body, supplied):
        raise HTTPException(400, "Invalid signature.")
    event_id = request.headers.get("x-razorpay-event-id", "")[:64]
    try:
        event = json.loads(body)
        remote = event["payload"]["subscription"]["entity"]
        remote_id = remote["id"]
        event_type = str(event["event"])[:48]
    except (ValueError, KeyError, TypeError):
        # Signed events that do not concern a subscription need no action.
        return {"status": "ignored"}
    if not event_id or await db.get(BillingEvent, event_id):
        return {"status": "duplicate" if event_id else "ignored"}
    subscription = await db.scalar(
        select(Subscription).where(Subscription.provider_subscription_id == remote_id).with_for_update()
    )
    if subscription:
        try:
            await sync(subscription)
        except RazorpayError as err:
            await db.rollback()
            # A non-2xx response makes Razorpay retry the delivery.
            raise HTTPException(503, "Retry later.") from err
    await db.execute(insert(BillingEvent).values(event_id=event_id, event_type=event_type)
                     .on_conflict_do_nothing())
    await db.commit()
    return {"status": "processed"}
