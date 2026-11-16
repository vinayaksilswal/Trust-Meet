import asyncio
from datetime import date
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from urllib.error import HTTPError
from uuid import uuid4

import pytest
import httpx
from pydantic import ValidationError

from conviya.config import Settings
from conviya import age_verification, conversations, eligibility, identity, main
from fastapi import HTTPException


def hosted_settings(**changes):
    values = dict(
        environment="production", public_conversations=True, web_origin="https://meet.example.com",
        web_proxy_secret="p" * 40, smtp_starttls=True, smtp_username="resend", smtp_password="test",
        livekit_api_url="https://sample.livekit.cloud", livekit_ws_url="wss://sample.livekit.cloud",
        livekit_api_key="test-project", livekit_api_secret="m" * 40,
        database_url="postgresql+psycopg://user:pass@db.example.com/meet?sslmode=verify-full",
        veriff_api_key="test-veriff-key", veriff_shared_secret="test-veriff-secret",
        redis_url="rediss://redis.example.com:6379", enable_conversations=True,
        enable_matchmaking=True, enable_private_rooms=True,
    )
    return Settings(_env_file=None, **(values | changes))


def test_hosted_configuration_allows_only_guarded_media():
    assert hosted_settings().enable_matchmaking
    for change in (
        {"public_conversations": False},
        {"veriff_api_key": ""},
        {"veriff_api_url": "https://veriff.example.net"},
        {"livekit_ws_url": "ws://localhost:7880"},
        {"livekit_api_key": "devkey"},
        {"web_proxy_secret": ""},
        {"redis_url": "rediss://redis.example.com:6379?ssl_check_hostname=false"},
        {"database_url": "postgresql+psycopg://user:pass@db.example.com/meet?sslmode=require"},
        {"enable_dev_age_assurance": True},
        {"enable_hosted_test_age_check": True},
        {"lan_skip_email_verification": True},
    ):
        with pytest.raises(ValidationError):
            hosted_settings(**change)


def test_hosted_gateway_blocks_direct_api_traffic(monkeypatch):
    config = hosted_settings()
    monkeypatch.setattr(main, "settings", config)

    async def exercise():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://api.example.com") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.get("/auth/options")).status_code == 404
            assert (await client.get("/auth/options", headers={"x-trust-meet-proxy-key": "wrong"})).status_code == 404
            headers = {"x-trust-meet-proxy-key": config.web_proxy_secret}
            response = await client.get("/auth/options", headers=headers)
            assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
            response = await client.post("/auth/logout", headers={**headers, "Origin": "https://other.example"})
            assert response.status_code == 403

    asyncio.run(exercise())


def test_temporary_production_signup_and_login_skip_email_but_require_adult_proof(monkeypatch):
    settings = hosted_settings(production_skip_email_verification=True)
    for module in (main, identity, eligibility):
        monkeypatch.setattr(module, "settings", settings)
    send = AsyncMock()
    monkeypatch.setattr(identity, "issue_account_link", send)
    monkeypatch.setattr(identity, "auth_limits", AsyncMock())
    password = "test-only-password"
    user = SimpleNamespace(id=uuid4(), status="active", email_verified_at=None,
                           password_hash=identity.hasher.hash(password))
    db = MagicMock(scalar=AsyncMock(return_value=user), commit=AsyncMock(), get=AsyncMock(return_value=None))

    async def test_database():
        yield db

    async def exercise():
        transport = httpx.ASGITransport(app=main.app)
        headers = {"x-trust-meet-proxy-key": settings.web_proxy_secret, "Origin": settings.web_origin}
        async with httpx.AsyncClient(transport=transport, base_url=settings.web_origin, headers=headers) as client:
            assert (await client.get("/auth/options")).json() == {"email_verification_required": False}
            credentials = {"email": "tester@example.com", "password": password}
            assert (await client.post("/auth/register", json={**credentials, "display_name": "Tester"})).status_code == 202
            assert (await client.post("/auth/login", json=credentials)).status_code == 200
            assert not await eligibility.eligible(db, user)
            db.get.return_value = SimpleNamespace(is_adult=True, provider=age_verification.PROVIDER)
            assert await eligibility.eligible(db, user)
            monkeypatch.setattr(identity, "settings", hosted_settings())
            assert (await client.post("/auth/login", json=credentials)).status_code == 403
            assert not await eligibility.eligible(db, user)

    monkeypatch.setitem(main.app.dependency_overrides, identity.database, test_database)
    asyncio.run(exercise())
    send.assert_not_awaited()
    assert user.email_verified_at is None


def test_hosted_age_check_is_separate_from_public_verification(monkeypatch):
    settings = hosted_settings(public_conversations=False, enable_conversations=False, enable_matchmaking=False,
                               enable_private_rooms=False, enable_hosted_test_age_check=True)
    monkeypatch.setattr(eligibility, "settings", settings)
    monkeypatch.setattr(eligibility, "throttle", AsyncMock())
    user = SimpleNamespace(id=uuid4(), status="active", email_verified_at=object())
    db = MagicMock(get=AsyncMock(return_value=None), execute=AsyncMock(), commit=AsyncMock())

    async def exercise():
        provider = eligibility.assurance_provider()
        assert provider.name == "hosted_test_self_report"
        result = await eligibility.check_age(eligibility.BirthDate(birth_date=date(2000, 1, 1)), user, db)
        assert result == {"eligible": True}
        db.get.return_value = SimpleNamespace(is_adult=True, provider=provider.name)
        assert await eligibility.eligible(db, user)
        monkeypatch.setattr(eligibility, "settings", hosted_settings())
        assert eligibility.assurance_provider() is None
        assert not await eligibility.eligible(db, user)

    asyncio.run(exercise())


def test_resend_email_uses_https_with_legacy_smtp_key(monkeypatch):
    config = hosted_settings(smtp_host="smtp.resend.com", smtp_sender="Trust Meet <hello@example.com>")
    monkeypatch.setattr(identity, "settings", config)
    send = MagicMock()
    monkeypatch.setattr(identity, "urlopen", send)

    identity.send_mail("recipient@example.net", "sample-token", "verify")

    request = send.call_args.args[0]
    assert request.full_url == "https://api.resend.com/emails"
    assert request.get_method() == "POST"
    assert request.get_header("Authorization") == "Bearer test"
    message = json.loads(request.data)
    assert message["from"] == config.smtp_sender
    assert message["to"] == ["recipient@example.net"]
    assert f"{config.web_origin}/account/verify#sample-token" in message["text"]


def test_resend_rejection_returns_retryable_error_without_logging_email_details(monkeypatch, caplog):
    config = hosted_settings(resend_api_key="test-api-key", smtp_username="", smtp_password="", smtp_starttls=False)
    monkeypatch.setattr(identity, "settings", config)
    rejection = HTTPError("https://api.resend.com/emails", 403, "private provider details", None, None)
    monkeypatch.setattr(identity, "urlopen", MagicMock(side_effect=rejection))
    db = MagicMock(commit=AsyncMock())
    user = SimpleNamespace(id=uuid4(), email="recipient@example.net")

    with pytest.raises(HTTPException, match="Email delivery is temporarily unavailable") as exc:
        asyncio.run(identity.issue_account_link(db, user, "verify"))

    assert exc.value.status_code == 503
    assert "provider status 403" in caplog.text
    assert "private provider details" not in caplog.text
    assert user.email not in caplog.text
    assert config.resend_api_key not in caplog.text


def test_age_decision_requires_account_binding_and_an_approved_document_birth_date():
    session, user = uuid4(), uuid4()
    today = date(2026, 11, 16)
    verified = {
        "id": str(session), "vendorData": str(user), "status": "approved", "code": 9001,
        "person": {"dateOfBirth": "2008-11-16"},
    }
    decision = {"verification": verified}
    assert age_verification.parse_decision(decision, session, user, today) == "verified"
    assert age_verification.parse_decision({"verification": None}, session, user, today) == "pending"
    with pytest.raises(HTTPException):
        age_verification.parse_decision(decision, session, uuid4(), today)
    verified["person"]["dateOfBirth"] = "2008-11-17"
    assert age_verification.parse_decision(decision, session, user, today) == "underage"
    verified["person"] = None
    with pytest.raises(HTTPException):
        age_verification.parse_decision(decision, session, user, today)
    assert age_verification.can_redirect("https://alchemy.veriff.com/v/example")
    assert not age_verification.can_redirect("https://alchemy.veriff.com.attacker.example/v/example")


def test_room_cleanup_retries_failed_cloud_revocation_before_delete(monkeypatch):
    monkeypatch.setattr(conversations, "settings", hosted_settings())
    first, second = uuid4(), uuid4()
    removal = AsyncMock(side_effect=[True, False, True, True])
    deletion = AsyncMock(return_value=True)
    monkeypatch.setattr(conversations, "revoke_participant", removal)
    monkeypatch.setattr(conversations, "delete_room", deletion)
    assert not asyncio.run(conversations.close_media("room", [first, second]))
    deletion.assert_not_awaited()
    assert asyncio.run(conversations.close_media("room", [first, second]))
    deletion.assert_awaited_once_with("room")
