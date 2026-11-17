from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from uuid import uuid4

import httpx

from test_foundation import origin, signed_in_account


def test_concurrent_matching_requires_both_consents_and_honors_block():
    with ExitStack() as stack, ThreadPoolExecutor(max_workers=6) as pool:
        seekers = [
            stack.enter_context(httpx.Client(base_url=origin + "/api", headers={"Origin": origin}, timeout=15))
            for _ in range(3)
        ]
        for client in seekers:
            signed_in_account(client)
            assert client.post("eligibility", json={"birth_date": "1990-01-01"}).json() == {"eligible": True}
        interests = [uuid4().hex]
        searches = [{"search_id": str(uuid4()), "mode": "text", "start": True, "language": "English",
                     "country": "IN", "interests": interests} for _ in seekers]
        pending = [
            pool.submit(client.post, "matchmaking/search", json=payload)
            for client, payload in zip(seekers, searches)
            for _ in range(2)
        ]
        assert all(future.result().status_code == 200 for future in pending)
        states = [client.get("conversations/current").json() for client in seekers]
        matched = [index for index, state in enumerate(states) if state]
        unmatched = [index for index, state in enumerate(states) if not state]
        assert len(matched) == 2 and len(unmatched) == 1
        first, second = [seekers[index] for index in matched]
        outsider = seekers[unmatched[0]]
        call_id = states[matched[0]]["id"]
        call = f"conversations/{call_id}"
        assert states[matched[1]]["id"] == call_id
        assert outsider.post(call + "/media", json={}).status_code == 404

        assert first.post(call + "/accept", json={}).json()["state"] == "invited"
        assert first.post(call + "/media", json={}).status_code == 409
        assert second.post(call + "/accept", json={}).json()["state"] == "active"
        assert first.post(call + "/media", json={}).status_code == 200
        assert second.post(call + "/block", json={}).status_code == 204
        assert first.post(call + "/media", json={}).status_code == 409
        assert second.get("conversations/current").json() is None

        invite = first.post("conversations/invitations", json={"mode": "text"}).raise_for_status().json()
        assert second.post("conversations/invitations/accept", json={"token": invite["token"]}).status_code == 404
        assert first.post("conversations/" + invite["id"] + "/end", json={}).status_code == 204

        for index in matched:
            fresh = {**searches[index], "search_id": str(uuid4()), "interests": [interests[0] + "b"]}
            response = seekers[index].post("matchmaking/search", json=fresh)
            assert response.json() == {"waiting": True, "conversation": None}
            searches[index] = fresh
        for client, search in zip(seekers, searches):
            key = {"search_id": search["search_id"], "mode": search["mode"]}
            assert client.post("matchmaking/cancel", json=key).status_code == 204
            assert client.post("matchmaking/search", json=key).status_code == 409


def test_queue_uses_mode_language_and_interests():
    with ExitStack() as stack:
        first, second = [
            stack.enter_context(httpx.Client(base_url=origin + "/api", headers={"Origin": origin}))
            for _ in range(2)
        ]
        for client in (first, second):
            signed_in_account(client)
            assert client.post("eligibility", json={"birth_date": "1990-01-01"}).is_success
        topic = uuid4().hex
        key = {"search_id": str(uuid4()), "mode": "audio"}
        first_choice = {"start": True, **key, "language": "HINDI", "interests": [topic]}
        assert first.post("matchmaking/search", json=first_choice).json()["waiting"]
        for mode, language, interests in [
            ("text", "Hindi", [topic]),
            ("audio", "English", [topic]),
            ("audio", "Hindi", ["another topic"]),
        ]:
            other = {"search_id": str(uuid4()), "mode": mode}
            assert second.post("matchmaking/search", json={
                **other, "start": True, "language": language, "interests": interests
            }).json()["waiting"]
            assert second.post("matchmaking/cancel", json=other).status_code == 204
        second_choice = {"search_id": str(uuid4()), "start": True, "mode": "audio",
                         "language": "Hindi", "interests": [topic.upper()]}
        match = second.post("matchmaking/search", json=second_choice).json()["conversation"]
        assert match["mode"] == "audio"
        assert not match["consented"]
        assert second.post("conversations/" + match["id"] + "/end", json={}).status_code == 204


def test_test_partners_can_rematch_without_joining_the_public_queue():
    with ExitStack() as stack:
        first, second, outsider = [
            stack.enter_context(httpx.Client(base_url=origin + "/api", headers={"Origin": origin}, timeout=15))
            for _ in range(3)
        ]
        accounts = [signed_in_account(client) for client in (first, second, outsider)]
        for client in (first, second, outsider):
            assert client.post("eligibility", json={"birth_date": "1990-01-01"}).is_success

        def search(client, partner=None):
            payload = {"search_id": str(uuid4()), "mode": "video", "start": True}
            if partner:
                payload["test_partner_email"] = partner
            return payload, client.post("matchmaking/search", json=payload).raise_for_status().json()

        first_email, second_email, _ = [account["email"] for account in accounts]
        _, result = search(first, second_email)
        assert result["waiting"]
        _, result = search(outsider, first_email)
        assert result["waiting"]
        _, result = search(outsider)
        assert result["waiting"]

        previous_id = None
        for index in range(2):
            if index:
                _, result = search(first, second_email)
                assert result["waiting"]
            _, result = search(second, first_email.upper())
            call = result["conversation"]
            assert call["id"] != previous_id
            previous_id = call["id"]
            assert first.get("conversations/current").json()["id"] == call["id"]
            assert outsider.get("conversations/current").json() is None
            path = "conversations/" + call["id"]
            assert first.post(path + "/accept", json={}).json()["state"] == "invited"
            assert second.post(path + "/accept", json={}).json()["state"] == "active"
            assert first.post(path + "/end", json={}).status_code == 204
