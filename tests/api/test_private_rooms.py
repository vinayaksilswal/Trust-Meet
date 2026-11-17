from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta

import httpx

from test_foundation import origin, signed_in_account


def test_private_room_authorization_schedule_and_atomic_capacity():
    with ExitStack() as stack, ThreadPoolExecutor(max_workers=2) as pool:
        owner, first, second = [
            stack.enter_context(httpx.Client(base_url=origin + "/api", headers={"Origin": origin}, timeout=15))
            for _ in range(3)
        ]
        for client in (owner, first, second):
            signed_in_account(client)
            assert client.post("eligibility", json={"birth_date": "1990-01-01"}).is_success
        started = datetime.now(UTC) + timedelta(hours=1)
        room = owner.post("rooms", json={
            "title": "Scheduled discussion", "mode": "audio", "capacity": 2, "password": "private-room-proof",
            "approval_required": True, "starts_at": started.isoformat(),
        }).raise_for_status().json()
        path = "rooms/" + room["id"]
        assert first.get(path).status_code == 404
        assert first.post(path + "/invitations", json={}).status_code == 404
        assert owner.post(path + "/media", json={}).status_code == 403
        invite = owner.post(path + "/invitations", json={}).raise_for_status().json()
        assert first.post("rooms/join", json={"token": invite["token"], "password": "wrong-password"}).status_code == 403
        assert owner.post(path + "/lock", json={"locked": True}).status_code == 204
        payload = {"token": invite["token"], "password": "private-room-proof"}
        assert first.post("rooms/join", json=payload).status_code == 404
        assert owner.post(path + "/lock", json={"locked": False}).status_code == 204
        for client in (first, second):
            assert client.post("rooms/join", json=payload).json()["state"] == "waiting"
            assert client.get(path).json()["participants"] == []
            assert client.post(path + "/lock", json={"locked": True}).status_code == 404
            assert client.post(path + "/media", json={}).status_code == 403
        roster = owner.get(path).raise_for_status().json()["participants"]
        approvals = [pool.submit(owner.post, path + "/members/" + member["id"] + "/approve", json={})
                     for member in roster]
        assert sorted(result.result().status_code for result in approvals) == [204, 409]
        assert owner.post(path + "/close", json={}).status_code == 204
        assert owner.post(path + "/media", json={}).status_code == 409
        assert first.get("rooms").json() == []
