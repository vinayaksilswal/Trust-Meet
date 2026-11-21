import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from redis.exceptions import RedisError

from conviya import matchmaking


def request(disconnected=False):
    return SimpleNamespace(is_disconnected=AsyncMock(return_value=disconnected))


def test_waiting_search_wakes_as_soon_as_a_match_is_signalled(monkeypatch):
    user = uuid4()
    store = SimpleNamespace(blpop=AsyncMock(side_effect=[None, ("key", "1")]))
    monkeypatch.setattr(matchmaking, "cache", store)
    assert asyncio.run(matchmaking.wait_for_match(request(), user))
    assert store.blpop.await_count == 2
    assert store.blpop.await_args.args[0] == [matchmaking.SIGNAL + str(user)]
    assert store.blpop.await_args.kwargs["timeout"] < 3  # below the Redis socket timeout


def test_waiting_search_gives_up_after_its_window_or_when_the_client_leaves(monkeypatch):
    store = SimpleNamespace(blpop=AsyncMock(return_value=None))
    monkeypatch.setattr(matchmaking, "cache", store)
    assert not asyncio.run(matchmaking.wait_for_match(request(), uuid4()))
    assert store.blpop.await_count == matchmaking.WAIT_ROUNDS
    store.blpop.reset_mock()
    assert not asyncio.run(matchmaking.wait_for_match(request(disconnected=True), uuid4()))
    store.blpop.assert_not_awaited()


def test_redis_failures_fall_back_to_paced_polling(monkeypatch):
    monkeypatch.setattr(matchmaking, "cache", SimpleNamespace(blpop=AsyncMock(side_effect=RedisError())))
    pause = AsyncMock()
    monkeypatch.setattr(matchmaking.asyncio, "sleep", pause)
    assert not asyncio.run(matchmaking.wait_for_match(request(), uuid4()))
    pause.assert_awaited_once()

    pipe = MagicMock()
    pipe.lpush.return_value.expire.return_value.execute = AsyncMock(side_effect=RedisError())
    context = MagicMock(__aenter__=AsyncMock(return_value=pipe), __aexit__=AsyncMock(return_value=False))
    monkeypatch.setattr(matchmaking, "cache", SimpleNamespace(pipeline=MagicMock(return_value=context)))
    asyncio.run(matchmaking.signal_match(uuid4()))  # Does not raise.
