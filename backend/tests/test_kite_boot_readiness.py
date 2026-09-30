import asyncio
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import server


def test_kite_refresh_checks_tracker_before_reading_vault_or_exchanging_token(monkeypatch):
    monkeypatch.setattr(server, "tracker", None)

    class ForbiddenCollection:
        async def find_one(self, *_args, **_kwargs):
            raise AssertionError("vault must not be queried before tracker readiness")

    monkeypatch.setattr(server, "db", SimpleNamespace(credentials=ForbiddenCollection()))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.kite_refresh(server.RefreshTokenIn(request_token="one-use"), _admin=True))

    assert exc.value.status_code == 503
    assert "still starting" in exc.value.detail


def test_kite_generate_session_checks_tracker_before_exchanging_one_use_token(monkeypatch):
    calls = []

    class ForbiddenKiteConnect:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            raise AssertionError("Kite exchange must not run before tracker readiness")

    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setitem(sys.modules, "kiteconnect", SimpleNamespace(KiteConnect=ForbiddenKiteConnect))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.generate_session(
            server.GenerateTokenIn(api_key="key", api_secret="secret", request_token="one-use"),
            _admin=True,
        ))

    assert exc.value.status_code == 503
    assert calls == []


def test_straddle_history_returns_readiness_error_before_using_tracker_or_database(monkeypatch):
    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setattr(server, "db", None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_straddle_history("NIFTY", minutes=60))

    assert exc.value.status_code == 503
    assert "still starting" in exc.value.detail


def test_boot_retries_transient_mongo_failure(monkeypatch):
    attempts = []
    delays = []
    closed_clients = []
    tracker_instance = object()

    class FakeAdmin:
        async def command(self, command):
            assert command == "ping"
            attempts.append(command)
            if len(attempts) == 1:
                raise ConnectionError("temporary Mongo outage")

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            self.admin = FakeAdmin()
            closed_clients.append(self)

        def __getitem__(self, name):
            assert name == "test_db"
            return object()

        def close(self):
            self.closed = True

    async def no_delay(seconds):
        delays.append(seconds)

    async def no_boot_rest():
        return None

    monkeypatch.setenv("MONGO_URL", "mongodb://test")
    monkeypatch.setenv("DB_NAME", "test_db")
    monkeypatch.setattr(server, "AsyncIOMotorClient", FakeClient)
    monkeypatch.setattr(server, "client", None)
    monkeypatch.setattr(server, "db", None)
    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setattr(server, "OITracker", lambda _db: tracker_instance)
    monkeypatch.setattr(server, "_boot_rest", no_boot_rest)
    monkeypatch.setattr(server.asyncio, "sleep", no_delay)
    monkeypatch.setattr(server.asyncio, "create_task", lambda coroutine: coroutine.close())
    monkeypatch.setattr(server._notifier_boot, "set_db", lambda _db: None)
    monkeypatch.setattr(server, "bind_error_log", lambda _db: None)
    monkeypatch.setattr(server, "install_logging_handler", lambda: None)
    monkeypatch.setitem(
        sys.modules,
        "external_api_telemetry",
        SimpleNamespace(bind=lambda _db: None, install_http_telemetry=lambda: None),
    )

    asyncio.run(server._boot())

    assert len(attempts) == 2
    assert delays == [2]
    assert closed_clients[0].closed is True
    assert server.tracker is tracker_instance
