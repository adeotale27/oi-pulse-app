import asyncio
import gzip
import hashlib
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import server

IST = timezone(timedelta(hours=5, minutes=30))


class MemoryCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key, direction=1):
        field = key if isinstance(key, str) else key[0][0]
        self.rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
        return self

    def __aiter__(self):
        self.position = 0
        return self

    async def __anext__(self):
        if self.position >= len(self.rows):
            raise StopAsyncIteration
        row = self.rows[self.position]
        self.position += 1
        return row

    async def to_list(self, length):
        return self.rows[:length]


def _matches(doc, query):
    if doc.get("owner_id") != query.get("owner_id") or doc.get("status") != query.get("status"):
        return False
    exit_date = str(doc.get("exit_date") or "")
    date_filter = query.get("exit_date") or {}
    if "$gte" in date_filter and exit_date < date_filter["$gte"]:
        return False
    if "$lt" in date_filter and exit_date >= date_filter["$lt"]:
        return False
    if "$lte" in date_filter and exit_date >= date_filter["$lte"]:
        return False
    has_events = bool(doc.get("events"))
    has_fills = bool(doc.get("fills"))
    return (has_events or has_fills) and (
        "$or" not in query or any(
            ("events" in item and has_events) or ("fills" in item and has_fills)
            for item in query["$or"]
        )
    )


class MemoryTradeCycles:
    def __init__(self, rows):
        self.rows = rows
        self.update_query = None
        self.update_operation = None

    def find(self, query, projection=None):
        rows = [dict(row) for row in self.rows if _matches(row, query)]
        if projection and projection.get("_id") == 0:
            for row in rows:
                for key, included in projection.items():
                    if included == 0:
                        row.pop(key, None)
                    elif key != "_id" and included == 1:
                        for field in list(row):
                            if field != key:
                                row.pop(field, None)
        return MemoryCursor(rows)

    async def update_many(self, query, operation):
        self.update_query = query
        self.update_operation = operation
        changed = 0
        for row in self.rows:
            if not _matches(row, query):
                continue
            row_changed = False
            for key in operation["$unset"]:
                if key in row:
                    row.pop(key)
                    row_changed = True
            changed += int(row_changed)
        return SimpleNamespace(modified_count=changed)


def _rows():
    return [
        {
            "_id": "admin-closed",
            "owner_id": "admin",
            "cycle_id": "admin-cycle",
            "status": "closed",
            "exit_date": "2026-06-12",
            "booked_pnl": 500,
            "events": [{"kind": "exit", "trade_id": "a1"}],
            "fills": [{"trade_id": "a1", "price": 100}],
            "partials": [{"realised_this": 500}],
        },
        {
            "_id": "guest-closed",
            "owner_id": "guest:one",
            "cycle_id": "guest-cycle",
            "status": "closed",
            "exit_date": "2026-06-12",
            "events": [{"kind": "exit", "trade_id": "g1"}],
        },
        {
            "_id": "admin-open",
            "owner_id": "admin",
            "cycle_id": "open-cycle",
            "status": "open",
            "exit_date": None,
            "events": [{"kind": "entry", "trade_id": "o1"}],
        },
        {
            "_id": "admin-recent",
            "owner_id": "admin",
            "cycle_id": "recent-cycle",
            "status": "closed",
            "exit_date": "2026-08-12",
            "events": [{"kind": "exit", "trade_id": "r1"}],
        },
    ]


def _configure(monkeypatch, collection):
    monkeypatch.setattr(server, "db", SimpleNamespace(trade_cycles=collection))
    monkeypatch.setattr(server, "now_ist", lambda: datetime(2026, 10, 7, 12, 0, tzinfo=IST))

    async def admin_owner(_request, _role):
        return "admin"

    monkeypatch.setattr(server, "_ledger_owner", admin_owner)


def test_archive_months_are_admin_scoped_and_require_full_90_day_month(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    response = asyncio.run(server.trade_cycle_archive_months(request=None, _admin=True))

    assert response["cutoff"] == "2026-07-09"
    assert response["months"] == [{"month": "2026-06", "count": 1}]
    assert collection.rows[1]["events"]


def test_cycle_archive_download_and_hash_verified_compaction(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    async def exercise():
        response = await server.export_trade_cycle_archive(
            request=None,
            month="2026-06",
            _admin=True,
        )
        chunks = [chunk async for chunk in response.body_iterator]
        compressed = b"".join(chunks)
        raw = gzip.decompress(compressed)
        digest = hashlib.sha256(raw).hexdigest()
        assert response.headers["x-archive-sha256"] == digest
        assert response.headers["x-archive-cycle-count"] == "1"
        assert "admin-cycle" in raw.decode("utf-8")
        assert "guest-cycle" not in raw.decode("utf-8")
        return await server.compact_trade_cycle_archive(
            server.TradeCycleArchiveCompactIn(month="2026-06", sha256=digest),
            request=None,
            _admin=True,
        )

    result = asyncio.run(exercise())

    assert result["archive_count"] == 1
    assert result["compacted_count"] == 1
    assert result["remaining_count"] == 0
    admin_cycle, guest_cycle = collection.rows[:2]
    assert "events" not in admin_cycle
    assert "fills" not in admin_cycle
    assert admin_cycle["booked_pnl"] == 500
    assert admin_cycle["partials"] == [{"realised_this": 500}]
    assert guest_cycle["events"]


def test_cycle_archive_rejects_wrong_hash_without_mutating_cycles(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            server.compact_trade_cycle_archive(
                server.TradeCycleArchiveCompactIn(month="2026-06", sha256="0" * 64),
                request=None,
                _admin=True,
            )
        )

    assert error.value.status_code == 409
    assert collection.update_query is None
    assert collection.rows[0]["events"]


def test_cycle_archive_rejects_recent_or_invalid_month(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    for month in ("2026-08", "2026-13"):
        with pytest.raises(HTTPException) as error:
            asyncio.run(
                server.export_trade_cycle_archive(
                    request=None,
                    month=month,
                    _admin=True,
                )
            )
        assert error.value.status_code == 400
    assert collection.update_query is None


def test_admin_archive_http_journey_download_verify_and_compact(monkeypatch):
    collection = MemoryTradeCycles(_rows())

    class AdminSessions:
        async def find_one(self, query, **_kwargs):
            if query.get("_id") != "test-admin-token":
                return None
            return {
                "_id": "test-admin-token",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "ttl_seconds": 3600,
            }

    _configure(
        monkeypatch,
        collection,
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(trade_cycles=collection, admin_sessions=AdminSessions()),
    )
    client = TestClient(server.app)

    unauthorized = client.get("/api/trades/archive/months")
    assert unauthorized.status_code == 401

    headers = {"X-Admin-Token": "test-admin-token"}
    months = client.get("/api/trades/archive/months", headers=headers)
    assert months.status_code == 200
    assert months.json()["months"] == [{"month": "2026-06", "count": 1}]

    download = client.get(
        "/api/trades/archive/export",
        params={"month": "2026-06"},
        headers=headers,
    )
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/gzip")
    assert download.headers["content-disposition"].endswith(
        'filename="striklenz-cycle-archive-2026-06.jsonl.gz"'
    )
    assert gzip.decompress(download.content).count(b"\n") == 1
    digest = download.headers["x-archive-sha256"]

    compact = client.post(
        "/api/trades/archive/compact",
        headers=headers,
        json={"month": "2026-06", "sha256": digest},
    )
    assert compact.status_code == 200
    assert compact.json()["compacted_count"] == 1
    assert "events" not in collection.rows[0]
    assert collection.rows[0]["booked_pnl"] == 500
