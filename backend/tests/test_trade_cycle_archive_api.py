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
    if "$lte" in date_filter and exit_date > date_filter["$lte"]:
        return False
    if "$or" not in query:
        return True
    return any(
        ("events" in item and bool(doc.get("events")))
        or ("fills" in item and bool(doc.get("fills")))
        for item in query["$or"]
    )


class MemoryTradeCycles:
    def __init__(self, rows):
        self.rows = rows
        self.update_query = None
        self.delete_queries = []

    def find(self, query, projection=None):
        rows = [dict(row) for row in self.rows if _matches(row, query)]
        if projection:
            includes = {key for key, included in projection.items() if included == 1 and key != "_id"}
            excludes = {key for key, included in projection.items() if included == 0}
            if includes:
                rows = [{key: row[key] for key in includes if key in row} for row in rows]
            for row in rows:
                for key in excludes:
                    row.pop(key, None)
        return MemoryCursor(rows)

    async def update_many(self, query, operation):
        self.update_query = query
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

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if row.get("_id") == query.get("_id") and _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self.delete_queries.append(query)
        ids = set(query["_id"]["$in"])
        deleted = 0
        kept = []
        for row in self.rows:
            if row.get("_id") in ids and _matches(row, query):
                deleted += 1
            else:
                kept.append(row)
        self.rows[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def count_documents(self, query):
        return sum(1 for row in self.rows if _matches(row, query))


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
            "_id": "admin-before",
            "owner_id": "admin",
            "cycle_id": "before-cycle",
            "status": "closed",
            "exit_date": "2026-06-11",
            "events": [{"kind": "exit", "trade_id": "b1"}],
        },
        {
            "_id": "admin-after",
            "owner_id": "admin",
            "cycle_id": "after-cycle",
            "status": "closed",
            "exit_date": "2026-06-13",
            "events": [{"kind": "exit", "trade_id": "a2"}],
        },
        {
            "_id": "admin-later",
            "owner_id": "admin",
            "cycle_id": "later-cycle",
            "status": "closed",
            "exit_date": "2026-08-12",
            "events": [{"kind": "exit", "trade_id": "l1"}],
        },
        {
            "_id": "admin-future",
            "owner_id": "admin",
            "cycle_id": "future-cycle",
            "status": "closed",
            "exit_date": "2026-10-08",
            "events": [{"kind": "exit", "trade_id": "f1"}],
        },
    ]


def _configure(monkeypatch, collection):
    monkeypatch.setattr(server, "db", SimpleNamespace(trade_cycles=collection))
    monkeypatch.setattr(server, "now_ist", lambda: datetime(2026, 10, 7, 12, 0, tzinfo=IST))

    async def admin_owner(_request, _role):
        return "admin"

    monkeypatch.setattr(server, "_ledger_owner", admin_owner)


def _payload(start, end, digest):
    return server.TradeCycleArchiveCompactIn(**{"from": start, "to": end, "sha256": digest})


def test_archive_range_counts_only_owned_closed_cycles_with_inclusive_dates(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    response = asyncio.run(server.trade_cycle_archive_range(
        request=None,
        from_date="2026-06-12",
        to_date="2026-08-12",
        _admin=True,
    ))

    assert response == {
        "from": "2026-06-12",
        "to": "2026-08-12",
        "count": 3,
        "detail_count": 3,
    }


def test_archive_download_and_hash_verified_compaction_use_exact_range(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    async def exercise():
        response = await server.export_trade_cycle_archive(
            request=None,
            from_date="2026-06-12",
            to_date="2026-06-12",
            _admin=True,
        )
        raw = gzip.decompress(b"".join([chunk async for chunk in response.body_iterator]))
        digest = hashlib.sha256(raw).hexdigest()
        assert response.headers["x-archive-sha256"] == digest
        assert response.headers["x-archive-cycle-count"] == "1"
        assert "admin-cycle" in raw.decode("utf-8")
        assert "before-cycle" not in raw.decode("utf-8")
        assert "after-cycle" not in raw.decode("utf-8")
        assert "guest-cycle" not in raw.decode("utf-8")
        return await server.compact_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", digest),
            request=None,
            _admin=True,
        )

    result = asyncio.run(exercise())

    assert result["from"] == "2026-06-12"
    assert result["to"] == "2026-06-12"
    assert result["archive_count"] == 1
    assert result["compacted_count"] == 1
    assert result["remaining_count"] == 0
    cycles = {row["_id"]: row for row in collection.rows}
    assert "events" not in cycles["admin-closed"]
    assert "fills" not in cycles["admin-closed"]
    assert cycles["admin-closed"]["booked_pnl"] == 500
    assert cycles["guest-closed"]["events"]
    assert cycles["admin-before"]["events"]
    assert cycles["admin-after"]["events"]


def test_cycle_archive_rejects_wrong_hash_without_mutating_cycles(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.compact_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", "0" * 64),
            request=None,
            _admin=True,
        ))

    assert error.value.status_code == 409
    assert collection.update_query is None
    assert collection.rows[0]["events"]


def test_archive_delete_requires_matching_download_and_deletes_only_selected_dates(monkeypatch):
    collection = MemoryTradeCycles(_rows())
    _configure(monkeypatch, collection)

    async def exercise():
        download = await server.export_trade_cycle_archive(
            request=None,
            from_date="2026-06-12",
            to_date="2026-06-12",
            _admin=True,
        )
        raw = gzip.decompress(b"".join([chunk async for chunk in download.body_iterator]))
        digest = hashlib.sha256(raw).hexdigest()
        with pytest.raises(HTTPException) as mismatch:
            await server.delete_trade_cycle_archive(
                _payload("2026-06-12", "2026-06-12", "0" * 64),
                request=None,
                _admin=True,
            )
        assert mismatch.value.status_code == 409
        return await server.delete_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", digest),
            request=None,
            _admin=True,
        )

    result = asyncio.run(exercise())
    remaining_ids = {row["_id"] for row in collection.rows}
    assert result["deleted_count"] == 1
    assert "admin-closed" not in remaining_ids
    assert "guest-closed" in remaining_ids
    assert "admin-before" in remaining_ids
    assert "admin-after" in remaining_ids


def test_archive_delete_batches_verified_ids_and_rechecks_owner_status_and_range(monkeypatch):
    rows = _rows()
    for number in range(5):
        rows.append({
            "_id": f"admin-in-range-{number}",
            "owner_id": "admin",
            "cycle_id": f"cycle-{number}",
            "status": "closed",
            "exit_date": "2026-06-12",
            "booked_pnl": number,
        })
    collection = MemoryTradeCycles(rows)
    _configure(monkeypatch, collection)
    monkeypatch.setattr(server, "CYCLE_ARCHIVE_DELETE_BATCH_SIZE", 2)

    async def exercise():
        archive = await server.export_trade_cycle_archive(
            request=None,
            from_date="2026-06-12",
            to_date="2026-06-12",
            _admin=True,
        )
        return await server.delete_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", archive.headers["x-archive-sha256"]),
            request=None,
            _admin=True,
        )

    result = asyncio.run(exercise())

    assert result["archive_count"] == 6
    assert result["deleted_count"] == 6
    assert [len(query["_id"]["$in"]) for query in collection.delete_queries] == [2, 2, 2]
    assert all(query["owner_id"] == "admin" for query in collection.delete_queries)
    assert all(query["status"] == "closed" for query in collection.delete_queries)
    assert all(query["exit_date"] == {"$gte": "2026-06-12", "$lte": "2026-06-12"} for query in collection.delete_queries)
    remaining_ids = {row["_id"] for row in collection.rows}
    assert "guest-closed" in remaining_ids
    assert "admin-before" in remaining_ids
    assert "admin-after" in remaining_ids


def test_compacted_range_can_be_redownloaded_then_deleted_with_fresh_fingerprint(monkeypatch):
    rows = _rows()
    rows.append({
        "_id": "admin-summary-only",
        "owner_id": "admin",
        "cycle_id": "summary-cycle",
        "status": "closed",
        "exit_date": "2026-06-12",
        "booked_pnl": -75,
        "partials": [],
    })
    collection = MemoryTradeCycles(rows)
    _configure(monkeypatch, collection)

    async def exercise():
        first = await server.export_trade_cycle_archive(
            request=None,
            from_date="2026-06-12",
            to_date="2026-06-12",
            _admin=True,
        )
        first_hash = first.headers["x-archive-sha256"]
        compacted = await server.compact_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", first_hash),
            request=None,
            _admin=True,
        )
        assert compacted["archive_count"] == 2
        assert compacted["detail_count"] == 1
        assert compacted["compacted_count"] == 1
        assert collection.rows[0]["booked_pnl"] == 500
        assert "events" not in collection.rows[0]

        refreshed = await server.export_trade_cycle_archive(
            request=None,
            from_date="2026-06-12",
            to_date="2026-06-12",
            _admin=True,
        )
        assert refreshed.headers["x-archive-cycle-count"] == "2"
        deleted = await server.delete_trade_cycle_archive(
            _payload("2026-06-12", "2026-06-12", refreshed.headers["x-archive-sha256"]),
            request=None,
            _admin=True,
        )
        return deleted

    result = asyncio.run(exercise())
    assert result["deleted_count"] == 2
    remaining_ids = {row["_id"] for row in collection.rows}
    assert "admin-closed" not in remaining_ids
    assert "admin-summary-only" not in remaining_ids
    assert "guest-closed" in remaining_ids
    assert "admin-after" in remaining_ids


@pytest.mark.parametrize(
    ("from_date", "to_date"),
    [
        ("2026-02-30", "2026-03-01"),
        ("2026-06-13", "2026-06-12"),
        ("2026-10-07", "2026-10-08"),
    ],
)
def test_archive_range_rejects_invalid_reversed_or_future_dates(monkeypatch, from_date, to_date):
    _configure(monkeypatch, MemoryTradeCycles(_rows()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.trade_cycle_archive_range(
            request=None,
            from_date=from_date,
            to_date=to_date,
            _admin=True,
        ))
    assert error.value.status_code == 400


def test_admin_archive_http_journey_is_admin_only_and_uses_inclusive_range(monkeypatch):
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

    _configure(monkeypatch, collection)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        trade_cycles=collection,
        admin_sessions=AdminSessions(),
    ))
    client = TestClient(server.app)

    assert client.get(
        "/api/trades/archive/range",
        params={"from": "2026-06-12", "to": "2026-06-12"},
    ).status_code == 401
    assert client.post(
        "/api/trades/archive/delete",
        json={"from": "2026-06-12", "to": "2026-06-12", "sha256": "a" * 64},
    ).status_code == 401

    headers = {"X-Admin-Token": "test-admin-token"}
    counts = client.get(
        "/api/trades/archive/range",
        params={"from": "2026-06-12", "to": "2026-06-12"},
        headers=headers,
    )
    assert counts.status_code == 200
    assert counts.json()["count"] == 1

    download = client.get(
        "/api/trades/archive/export",
        params={"from": "2026-06-12", "to": "2026-06-12"},
        headers=headers,
    )
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/gzip")
    assert download.headers["content-disposition"].endswith(
        'filename="striklenz-cycle-archive-2026-06-12-to-2026-06-12.jsonl.gz"'
    )
    assert gzip.decompress(download.content).count(b"\n") == 1

    compact = client.post(
        "/api/trades/archive/compact",
        headers=headers,
        json={"from": "2026-06-12", "to": "2026-06-12", "sha256": download.headers["x-archive-sha256"]},
    )
    assert compact.status_code == 200
    assert compact.json()["compacted_count"] == 1
    assert "events" not in collection.rows[0]
