import asyncio
from datetime import timedelta
import hashlib
import hmac
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from conviya import billing, entitlements, matchmaking, presence
from conviya.config import Settings
from conviya.models import PassOrder, PremiumAccess
from conviya.runtime import now


def config():
    return Settings(_env_file=None, enable_billing=True, razorpay_key_id="rzp_test_sample",
                    razorpay_key_secret="k" * 24, razorpay_webhook_secret="w" * 24)


def entry(**changes):
    return {"country": "", "language": "", "interests": [], "gender": "", "region": "",
            "want_gender": "", "want_region": ""} | changes


def test_gender_and_region_filters_apply_in_both_directions():
    woman_in_india = entry(gender="female", region="IN")
    man_in_us = entry(gender="male", region="US")
    assert matchmaking.compatible(woman_in_india, man_in_us)
    assert not matchmaking.compatible(entry(want_gender="female", region="US"), man_in_us)
    assert matchmaking.compatible(entry(want_gender="female"), woman_in_india)
    assert not matchmaking.compatible(entry(want_region="IN"), man_in_us)
    assert matchmaking.compatible(entry(want_region="IN", gender="male"), woman_in_india)
    # The other person's filter also has to accept you.
    assert not matchmaking.compatible(entry(gender="male"), entry(gender="female", want_gender="female"))
    # People who did not state a gender are never shown to someone filtering by gender.
    assert not matchmaking.compatible(entry(want_gender="male"), entry())


def test_premium_access_comes_from_a_pass_or_plus():
    user = uuid4()
    access = PremiumAccess(user_id=user, ends_at=now() + timedelta(days=2))
    db = MagicMock(get=AsyncMock(side_effect=[access, None]))
    assert asyncio.run(entitlements.premium_until(db, user)) == access.ends_at
    expired = PremiumAccess(user_id=user, ends_at=now() - timedelta(seconds=1))
    db.get.side_effect = [expired, None]
    assert asyncio.run(entitlements.premium_until(db, user)) is None


def test_filters_without_premium_are_refused(monkeypatch):
    monkeypatch.setattr(matchmaking, "settings", SimpleNamespace(enable_matchmaking=True))
    monkeypatch.setattr(matchmaking, "throttle", AsyncMock())
    monkeypatch.setattr(matchmaking, "premium_until", AsyncMock(return_value=None))
    search = matchmaking.Search(search_id=uuid4(), mode="video", want_gender="female")
    with pytest.raises(HTTPException) as refused:
        asyncio.run(matchmaking.search(search, MagicMock(), SimpleNamespace(id=uuid4()), MagicMock()))
    assert refused.value.status_code == 402


def test_paid_pass_extends_access_once_and_needs_a_valid_signature(monkeypatch):
    settings = config()
    monkeypatch.setattr(billing, "settings", settings)
    monkeypatch.setattr(billing, "throttle", AsyncMock())
    user = uuid4()
    order = PassOrder(order_id="order_sample", user_id=user, pass_id="3d", days=3, amount_paise=199900)
    current = PremiumAccess(user_id=user, ends_at=now() + timedelta(days=1))
    remote = AsyncMock(return_value={"status": "paid", "amount_paid": 199900})
    monkeypatch.setattr(billing, "razorpay", remote)
    monkeypatch.setattr(billing, "premium_until", AsyncMock(return_value=None))

    async def get(model, key, **_):
        return order if model is PassOrder else current

    db = MagicMock(get=AsyncMock(side_effect=get), commit=AsyncMock(), rollback=AsyncMock())
    signature = hmac.new(settings.razorpay_key_secret.encode(), b"order_sample|pay_sample", hashlib.sha256).hexdigest()

    def proof(value):
        return billing.PassProof(razorpay_order_id="order_sample", razorpay_payment_id="pay_sample", razorpay_signature=value)

    async def exercise():
        with pytest.raises(HTTPException):
            await billing.verify_pass(proof("0" * 64), SimpleNamespace(id=user), db)
        before = current.ends_at
        await billing.verify_pass(proof(signature), SimpleNamespace(id=user), db)
        # Stacks on top of the remaining day instead of replacing it.
        assert current.ends_at - before == timedelta(days=3)
        await billing.verify_pass(proof(signature), SimpleNamespace(id=user), db)
        assert current.ends_at - before == timedelta(days=3)
        assert order.payment_id == "pay_sample" and remote.await_count == 1
        with pytest.raises(HTTPException):
            await billing.verify_pass(proof(signature), SimpleNamespace(id=uuid4()), db)

    asyncio.run(exercise())


def test_unpaid_order_does_not_grant_access(monkeypatch):
    monkeypatch.setattr(billing, "razorpay", AsyncMock(return_value={"status": "attempted", "amount_paid": 0}))
    order = PassOrder(order_id="order_sample", user_id=uuid4(), pass_id="1d", days=1, amount_paise=99900)
    with pytest.raises(billing.RazorpayError):
        asyncio.run(billing.grant_pass(MagicMock(), order, "pay_sample"))
    assert order.paid_at is None


def test_presence_counts_real_heartbeats(monkeypatch):
    store = SimpleNamespace(eval=AsyncMock(return_value=3), set=AsyncMock(), get=AsyncMock(return_value=None))
    monkeypatch.setattr(presence, "cache", store)
    monkeypatch.setattr(presence, "throttle", AsyncMock())
    visitor = uuid4()
    request = SimpleNamespace(state=SimpleNamespace(), client=SimpleNamespace(host="127.0.0.1"))
    assert asyncio.run(presence.heartbeat(presence.Heartbeat(visitor=visitor), request)) == {"online": 3}
    assert store.eval.await_args.args[2:] == (presence.KEY, str(visitor), presence.WINDOW)
    store.get.return_value = "7"
    assert asyncio.run(presence.online()) == {"online": 7}
