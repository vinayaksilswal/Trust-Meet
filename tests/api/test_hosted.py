import asyncio
from datetime import date
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import httpx
from pydantic import ValidationError

from conviya.config import Settings
from conviya import age_verification, conversations, main
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
