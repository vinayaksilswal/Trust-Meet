"""Razorpay subscription billing.

Checkout runs in the browser with Razorpay Checkout. The API creates the subscription,
verifies the checkout signature, and treats Razorpay's own subscription record as the
source of truth: both the checkout callback and signed webhooks re-read the subscription
from the Razorpay API instead of trusting the order in which events arrive.
"""

from base64 import b64encode
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import logging
from typing import Annotated, Literal
from uuid import uuid4

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .eligibility import require_eligible
from .entitlements import is_plus, premium_until
from .identity import CurrentUser, Db
from .models import BillingEvent, PassOrder, PremiumAccess, Subscription, User
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


PassId = Literal["1d", "3d", "7d"]
PASS_DAYS = {"1d": 1, "3d": 3, "7d": 7}


def pass_price(pass_id: str) -> int:
    return {"1d": settings.pass_price_1d_inr, "3d": settings.pass_price_3d_inr, "7d": settings.pass_price_7d_inr}[pass_id]


class PassChoice(BaseModel):
    pass_id: PassId


class PassProof(BaseModel):
    razorpay_order_id: ProviderId
    razorpay_payment_id: ProviderId
    razorpay_signature: Signature


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


def pass_catalog():
    return [{"id": pass_id, "days": days, "price_inr": pass_price(pass_id)} for pass_id, days in PASS_DAYS.items()]


@router.get("/catalog")
async def catalog():
    """Public prices, so signed-out visitors can see the offer."""
    return {"enabled": billing_enabled(), "passes": pass_catalog(), "plus_available": bool(settings.razorpay_plus_plan_id),
            "plan": {"name": "Plus", "price_inr": settings.plus_price_inr, "interval": "month"}}


@router.get("")
async def overview(user: CurrentUser, db: Db):
    subscription = await db.get(Subscription, user.id)
    return {
        "enabled": billing_enabled(),
        "key_id": settings.razorpay_key_id if billing_enabled() else None,
        "plan": {"name": "Plus", "price_inr": settings.plus_price_inr, "interval": "month"},
        "plus_available": bool(settings.razorpay_plus_plan_id),
        "plus": is_plus(subscription),
        "subscription": describe(subscription),
        "passes": pass_catalog(),
        "premium_until": await premium_until(db, user.id),
    }


async def grant_pass(db: Db, order: PassOrder, payment_id: str):
    """Extend premium access once per paid order. Callers hold a lock on the order row."""
    if order.paid_at is not None:
        return
    remote = await razorpay("GET", f"/orders/{order.order_id}")
    if remote.get("status") != "paid" or remote.get("amount_paid") != order.amount_paise:
        raise RazorpayError()
    access = await db.get(PremiumAccess, order.user_id, with_for_update=True)
    start = max(access.ends_at, now()) if access else now()
    ends = start + timedelta(days=order.days)
    if access:
        access.ends_at = ends
    else:
        db.add(PremiumAccess(user_id=order.user_id, ends_at=ends))
    order.paid_at = now()
    order.payment_id = payment_id


@router.post("/pass")
async def buy_pass(payload: PassChoice, user: CurrentUser, db: Db):
    require_billing()
    await require_eligible(user, db)
    await throttle("billing:pass", str(user.id), 12, 3600)
    amount = pass_price(payload.pass_id) * 100
    try:
        remote = await razorpay("POST", "/orders", {
            "amount": amount, "currency": "INR", "receipt": uuid4().hex[:32],
            "notes": {"user_id": str(user.id), "pass_id": payload.pass_id},
        })
    except RazorpayError as err:
        logger.warning("Razorpay order creation failed (status %s)", err.status)
        raise HTTPException(503, "Payments are temporarily unavailable. Please try again.") from err
    order_id = remote.get("id")
    if not isinstance(order_id, str) or remote.get("amount") != amount:
        raise HTTPException(503, "Payments are temporarily unavailable. Please try again.")
    db.add(PassOrder(order_id=order_id, user_id=user.id, pass_id=payload.pass_id,
                     days=PASS_DAYS[payload.pass_id], amount_paise=amount))
    await db.commit()
    return {"order_id": order_id, "key_id": settings.razorpay_key_id, "amount": amount, "currency": "INR"}


@router.post("/pass/verify")
async def verify_pass(payload: PassProof, user: CurrentUser, db: Db):
    require_billing()
    await throttle("billing:verify", str(user.id), 20, 3600)
    order = await db.get(PassOrder, payload.razorpay_order_id, with_for_update=True)
    message = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    if (not order or order.user_id != user.id
            or not signature_matches(settings.razorpay_key_secret, message, payload.razorpay_signature)):
        raise HTTPException(400, "We could not confirm this payment.")
    try:
        await grant_pass(db, order, payload.razorpay_payment_id)
    except RazorpayError as err:
        await db.rollback()
        raise HTTPException(503, "Payment received. Your pass will activate in a few minutes.") from err
    await db.commit()
    return {"premium_until": await premium_until(db, user.id)}


@router.post("/subscribe")
async def subscribe(user: CurrentUser, db: Db):
    require_billing()
    if not settings.razorpay_plus_plan_id:
        raise HTTPException(503, "The monthly plan is not available.")
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
        event_type = str(event["event"])[:48]
        entities = event["payload"]
        subscription_id = entities.get("subscription", {}).get("entity", {}).get("id")
        order_id = entities.get("order", {}).get("entity", {}).get("id") if event_type == "order.paid" else None
        payment_id = entities.get("payment", {}).get("entity", {}).get("id")
    except (ValueError, KeyError, TypeError, AttributeError):
        return {"status": "ignored"}
    if not (subscription_id or order_id):
        # Signed events about neither a subscription nor a pass need no action.
        return {"status": "ignored"}
    if not event_id or await db.get(BillingEvent, event_id):
        return {"status": "duplicate" if event_id else "ignored"}
    try:
        if subscription_id:
            subscription = await db.scalar(
                select(Subscription).where(Subscription.provider_subscription_id == subscription_id).with_for_update()
            )
            if subscription:
                await sync(subscription)
        if order_id and isinstance(payment_id, str):
            order = await db.get(PassOrder, order_id, with_for_update=True)
            if order:
                await grant_pass(db, order, payment_id[:40])
    except RazorpayError as err:
        await db.rollback()
        # A non-2xx response makes Razorpay retry the delivery.
        raise HTTPException(503, "Retry later.") from err
    await db.execute(insert(BillingEvent).values(event_id=event_id, event_type=event_type)
                     .on_conflict_do_nothing())
    await db.commit()
    return {"status": "processed"}
