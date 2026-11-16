from datetime import date
import os
import re
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from conviya.config import Settings
from conviya.eligibility import DevelopmentAgeAssurance


origin = os.getenv("CONVIYA_TEST_WEB_URL", "http://localhost:3000")
mailbox = os.getenv("CONVIYA_TEST_MAIL_URL", "http://127.0.0.1:8025")
password = "development integration password 24!"
cookie_name = "__Host-conviya" if origin.startswith("https://") else "conviya"


@pytest.fixture
def client():
    with httpx.Client(base_url=origin + "/api", headers={"Origin": origin}, timeout=15) as client:
        yield client


def mail_token(address, action):
    search = httpx.get(mailbox + "/api/v1/search", params={"query": f"to:{address}"}).raise_for_status().json()
    for message in search["messages"]:
        text = httpx.get(mailbox + "/api/v1/message/" + message["ID"]).raise_for_status().json()["Text"]
        match = re.search(rf"/account/{action}#([A-Za-z0-9_-]{{43}})", text)
        if match:
            return match[1]
    raise AssertionError(f"Expected {action} email")


def verified_account(client):
    email = f"test-{uuid4().hex}@example.com"
    credentials = {"email": email, "password": password}
    assert client.post("auth/register", json={**credentials, "display_name": "Integration User"}).status_code == 202
    assert client.post("auth/login", json=credentials).status_code == 403
    proof = {"token": mail_token(email, "verify")}
    assert client.post("auth/verify", json=proof).status_code == 200
    assert client.post("auth/verify", json=proof).status_code == 400
    response = client.post("auth/login", json=credentials)
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"] and "SameSite=strict" in response.headers["set-cookie"]
    if origin.startswith("https://"):
        assert "Secure" in response.headers["set-cookie"]
    return credentials


def test_production_fails_closed():
    production = dict(environment="production", web_origin="https://app.example.com",
                      smtp_starttls=True, smtp_username="tester", smtp_password="testing")
    with pytest.raises(ValidationError, match="approved age assurance"):
        Settings(**production, enable_dev_age_assurance=True)
    with pytest.raises(ValidationError, match="approved age assurance"):
        Settings(**production, enable_conversations=True)


def test_age_threshold():
    provider = DevelopmentAgeAssurance()
    assert provider.is_adult(date(2008, 11, 16), date(2026, 11, 16))
    assert not provider.is_adult(date(2008, 11, 17), date(2026, 11, 16))
    assert not provider.is_adult(date(2008, 2, 29), date(2026, 2, 28))


def test_lan_requires_private_https_and_same_origin_signaling():
    lan = dict(environment="lan", web_origin="https://192.168.1.5:3443",
               livekit_ws_url="wss://192.168.1.5:3443", livekit_api_secret="x" * 32)
    assert Settings(**lan).environment == "lan"
    for changes in (
        {"web_origin": "https://8.8.8.8:3443"},
        {"web_origin": "http://192.168.1.5:3443"},
        {"livekit_ws_url": "ws://192.168.1.5:3443"},
        {"livekit_api_secret": "secret"},
    ):
        with pytest.raises(ValidationError, match="LAN testing requires"):
            Settings(**(lan | changes))

def test_readiness_and_csrf(client):
    assert client.get("ready").json() == {"status": "ready"}
    response = client.post("auth/logout", headers={"Origin": "https://wrong.example"}, json={})
    assert response.status_code == 403
    assert client.get("me").status_code == 401


def test_underage_cannot_retry_or_invite(client):
    verified_account(client)
    assert client.post("eligibility", json={"birth_date": date.today().isoformat()}).json() == {"eligible": False}
    assert client.post("eligibility", json={"birth_date": "1990-01-01"}).status_code == 409
    assert client.post("conversations/invitations", json={"mode": "video"}).status_code == 403


def test_password_reset_and_logout_revoke_sessions(client):
    credentials = verified_account(client)
    token = client.cookies.get(cookie_name)
    assert client.post("auth/recover", json={"email": credentials["email"]}).status_code == 202
    proof = mail_token(credentials["email"], "reset")
    new_password = "New integration password 24!"
    assert client.post("auth/reset", json={"token": proof, "password": new_password}).status_code == 200
    assert client.get("me").status_code == 401
    assert client.post("auth/login", json=credentials).status_code == 401
    assert client.post("auth/login", json={**credentials, "password": new_password}).status_code == 200
    new_session = client.cookies.get(cookie_name)
    assert new_session != token
    assert client.post("auth/logout", json={}).status_code == 204
    assert client.get("me", headers={"Cookie": cookie_name + "=" + new_session}).status_code == 401
