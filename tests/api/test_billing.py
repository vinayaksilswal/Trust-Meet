import asyncio
from datetime import timedelta
import hashlib
import hmac
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from conviya import billing, identity, main
from conviya.config import Settings
from conviya.entitlements import is_plus
from conviya.models import Subscription
from conviya.runtime import now


KEYS = dict(enable_billing=True, razorpay_key_id="rzp_test_sample", razorpay_key_secret="k" * 24,
            razorpay_webhook_secret="w" * 24, razorpay_plus_plan_id="plan_sample")


def billing_settings(**changes):
    return Settings(_env_file=None, **(KEYS | changes))


def sign(secret: str, message: bytes):
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def stored(**changes):
    values = dict(user_id=uuid4(), provider_subscription_id="sub_sample", plan_id="plan_sample",
                  status="created", current_end=None, cancel_requested_at=None)
    return Subscription(**(values | changes))


def test_billing_configuration_requires_complete_razorpay_keys():
    assert billing_settings().enable_billing
    for change in ({"razorpay_key_id": "sample"}, {"razorpay_key_secret": "short"},
                   {"razorpay_webhook_secret": ""}, {"razorpay_plus_plan_id": "sample"},
                   {"razorpay_key_id": "rzp_live_sample"}, {"plus_price_inr": 0}):
        with pytest.raises(ValidationError):
            billing_settings(**change)


def test_plus_requires_a_paid_unexpired_subscription():
    assert not is_plus(None)
    assert not is_plus(stored(status="created"))
    assert not is_plus(stored(status="authenticated"))
    assert is_plus(stored(status="active", current_end=now() + timedelta(days=3)))
    assert is_plus(stored(status="pending", current_end=now() + timedelta(days=3)))
    assert not is_plus(stored(status="active", current_end=now() - timedelta(seconds=1)))
    assert not is_plus(stored(status="cancelled", current_end=now() + timedelta(days=3)))


def test_checkout_signature_is_verified_and_state_comes_from_razorpay(monkeypatch):
    config = billing_settings()
    monkeypatch.setattr(billing, "settings", config)
    monkeypatch.setattr(billing, "throttle", AsyncMock())
    subscription = stored()
    renews = int((now() + timedelta(days=30)).timestamp())
    remote = AsyncMock(return_value={"id": "sub_sample", "plan_id": "plan_sample", "status": "active",
                                     "current_end": renews})
    monkeypatch.setattr(billing, "razorpay", remote)
    db = MagicMock(get=AsyncMock(return_value=subscription), commit=AsyncMock(), rollback=AsyncMock())
    user = SimpleNamespace(id=subscription.user_id)

    def proof(signature):
        return billing.CheckoutProof(razorpay_payment_id="pay_sample", razorpay_subscription_id="sub_sample",
                                     razorpay_signature=signature)

    async def exercise():
        with pytest.raises(HTTPException) as rejected:
            await billing.verify(proof("0" * 64), user, db)
        assert rejected.value.status_code == 400
        remote.assert_not_awaited()
        result = await billing.verify(proof(sign(config.razorpay_key_secret, b"pay_sample|sub_sample")), user, db)
        assert result["plus"] is True
        remote.assert_awaited_once_with("GET", "/subscriptions/sub_sample")
        assert int(subscription.current_end.timestamp()) == renews

        remote.return_value = {"id": "sub_sample", "plan_id": "plan_other", "status": "active"}
        with pytest.raises(HTTPException) as mismatch:
            await billing.verify(proof(sign(config.razorpay_key_secret, b"pay_sample|sub_sample")), user, db)
        assert mismatch.value.status_code == 503
        db.rollback.assert_awaited()

    asyncio.run(exercise())


def test_webhook_needs_a_valid_signature_and_ignores_repeated_events(monkeypatch):
    config = billing_settings()
    monkeypatch.setattr(billing, "settings", config)
    monkeypatch.setattr(main, "settings", config)
    subscription = stored()
    renews = int((now() + timedelta(days=30)).timestamp())
    remote = AsyncMock(return_value={"id": "sub_sample", "plan_id": "plan_sample", "status": "active",
                                     "current_end": renews})
    monkeypatch.setattr(billing, "razorpay", remote)
    seen = set()

    async def get(model, key, **_):
        return key if key in seen else None

    async def execute(statement):
        seen.add("evt_sample")

    db = MagicMock(get=AsyncMock(side_effect=get), scalar=AsyncMock(return_value=subscription),
                   execute=AsyncMock(side_effect=execute), commit=AsyncMock(), rollback=AsyncMock())

    async def test_database():
        yield db

    body = json.dumps({"event": "subscription.charged",
                       "payload": {"subscription": {"entity": {"id": "sub_sample", "status": "active"}}}}).encode()

    async def exercise():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
            headers = {"x-razorpay-event-id": "evt_sample", "content-type": "application/json"}
            forged = await client.post("/billing/webhook", content=body,
                                       headers={**headers, "x-razorpay-signature": sign("other", body)})
            assert forged.status_code == 400
            signed = {**headers, "x-razorpay-signature": sign(config.razorpay_webhook_secret, body)}
            first = await client.post("/billing/webhook", content=body, headers=signed)
            assert first.json() == {"status": "processed"}
            assert subscription.status == "active"
            repeat = await client.post("/billing/webhook", content=body, headers=signed)
            assert repeat.json() == {"status": "duplicate"}
            assert remote.await_count == 1

    monkeypatch.setitem(main.app.dependency_overrides, identity.database, test_database)
    asyncio.run(exercise())


def test_subscribe_reuses_unpaid_checkout_and_refuses_duplicate_plans(monkeypatch):
    config = billing_settings()
    monkeypatch.setattr(billing, "settings", config)
    monkeypatch.setattr(billing, "throttle", AsyncMock())
    monkeypatch.setattr(billing, "require_eligible", AsyncMock())
    remote = AsyncMock(return_value={"id": "sub_new"})
    monkeypatch.setattr(billing, "razorpay", remote)
    user = SimpleNamespace(id=uuid4())
    existing = stored(user_id=user.id)
    db = MagicMock(get=AsyncMock(side_effect=[None, existing]), execute=AsyncMock(), commit=AsyncMock())

    async def exercise():
        assert await billing.subscribe(user, db) == {"subscription_id": "sub_sample", "key_id": config.razorpay_key_id}
        remote.assert_not_awaited()
        existing.status, existing.current_end = "active", now() + timedelta(days=5)
        db.get.side_effect = [None, existing]
        with pytest.raises(HTTPException) as duplicate:
            await billing.subscribe(user, db)
        assert duplicate.value.status_code == 409
        existing.status = "cancelled"
        db.get.side_effect = [None, existing]
        assert (await billing.subscribe(user, db))["subscription_id"] == "sub_new"
        assert remote.await_args.args[2]["plan_id"] == "plan_sample"

    asyncio.run(exercise())
