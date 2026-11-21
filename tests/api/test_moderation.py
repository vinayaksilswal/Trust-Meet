from uuid import uuid4

import httpx
import psycopg
import pytest
from sqlalchemy.engine import make_url

from conviya.config import settings
from test_foundation import origin, signed_in_account


def local_database():
    url = make_url(settings.database_url)
    if url.host not in {"127.0.0.1", "localhost", "::1"}:
        pytest.skip("Moderation integration tests only write to a local database.")
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


def adult(client):
    signed_in_account(client)
    assert client.post("eligibility", json={"birth_date": "1990-01-01"}).json() == {"eligible": True}
    return client.get("me").json()


def test_moderators_review_reports_suspend_and_reinstate_with_an_audit_trail():
    database = local_database()
    clients = [httpx.Client(base_url=origin + "/api", headers={"Origin": origin}, timeout=20) for _ in range(3)]
    reporter, subject, moderator = clients
    try:
        people = [adult(client) for client in clients]
        assert reporter.get("moderation/overview").status_code == 404  # Hidden from ordinary accounts.
        with psycopg.connect(database) as db:
            db.execute("INSERT INTO staff_roles (user_id, role, granted_by) VALUES (%s, 'moderator', 'pytest')", (people[2]["id"],))
        assert moderator.get("me").json()["moderator"] is True

        tag = [uuid4().hex]
        searches = [{"search_id": str(uuid4()), "mode": "text", "start": True, "auto_connect": True, "interests": tag}
                    for _ in range(2)]
        assert reporter.post("matchmaking/search", json=searches[0]).json()["waiting"]
        call = subject.post("matchmaking/search", json=searches[1]).json()["conversation"]
        assert call and call["state"] == "active"
        assert reporter.post(f"conversations/{call['id']}/report", json={"category": "underage"}).status_code == 202

        queue = moderator.get("moderation/reports").json()["reports"]
        item = next(row for row in queue if row["subject"]["id"] == people[1]["id"])
        assert item["urgent"] and item["reporter"]["id"] == people[0]["id"]
        assert moderator.get("moderation/overview").json()["urgent_reports"] >= 1

        # Staff cannot be suspended from the console, including by themselves.
        assert moderator.post(f"moderation/accounts/{people[2]['id']}/suspend", json={}).status_code == 403

        decision = moderator.post(f"moderation/reports/{item['ref']}", json={"action": "suspend", "note": "pytest"})
        assert decision.json() == {"state": "actioned"}
        assert moderator.post(f"moderation/reports/{item['ref']}", json={"action": "dismiss"}).status_code == 409
        assert subject.get("me").status_code == 401  # Signed out everywhere.
        assert reporter.get("conversations/current").json() is None  # Their call ended.

        found = moderator.get("moderation/accounts", params={"q": people[1]["email"]}).json()["accounts"]
        assert found[0]["status"] == "suspended" and found[0]["reports"] >= 1
        assert moderator.post(f"moderation/accounts/{people[1]['id']}/reinstate", json={"note": "appeal"}).json() == {"status": "active"}

        log = moderator.get("moderation/actions").json()["actions"]
        mine = [row["action"] for row in log if row["subject"] and row["subject"]["id"] == people[1]["id"]]
        assert mine[:2] == ["reinstate", "suspend"]
        assert all(row["moderator"] == people[2]["email"] for row in log[:2])
    finally:
        for client in clients:
            client.close()
