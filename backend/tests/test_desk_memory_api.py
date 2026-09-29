import asyncio
import pytest
from fastapi import HTTPException

import server
from market_hours import now_ist


class MemoryCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        return self.rows[:length]


class MemoryCollection:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or []
        self.fail = fail
        self.query = None
        self.projection = None

    def find(self, query, projection):
        if self.fail:
            raise RuntimeError("database query failed")
        self.query = query
        self.projection = projection
        owner = query["owner_id"]
        return MemoryCursor([row for row in self.rows if row.get("owner_id") == owner])


def test_desk_memory_is_owner_scoped_and_returns_aggregate_compat_shape(monkeypatch):
    today = now_ist().strftime("%Y-%m-%d")
    collection = MemoryCollection(rows=[
        {
            "owner_id": "guest:alice", "cycle_id": "private-a",
            "tradingsymbol": "NIFTY-PRIVATE", "status": "closed",
            "direction": "short", "index": "NIFTY", "side": "CE",
            "booked_pnl": 25, "entry_date": today, "exit_date": today,
        },
        {
            "owner_id": "guest:bob", "cycle_id": "private-b",
            "tradingsymbol": "SENSEX-PRIVATE", "status": "closed",
            "direction": "short", "index": "SENSEX", "side": "PE",
            "booked_pnl": 9999, "entry_date": today, "exit_date": today,
        },
    ])
    monkeypatch.setattr(server, "db", type("DB", (), {"trade_cycles": collection})())

    async def owner_for_request(_request, _role):
        return "guest:alice"

    monkeypatch.setattr(server, "_ledger_owner", owner_for_request)
    response = asyncio.run(server.desk_memory(request=None, days=60, role="guest"))

    assert collection.query["owner_id"] == "guest:alice"
    assert collection.projection == {"_id": 0, "events": 0, "fills": 0}
    assert set(response) >= {"lines", "buckets", "summary", "process"}
    assert response["summary"]["closed_cycles"] == 1
    assert "9999" not in str(response)
    assert "private-a" not in str(response)
    assert "private-b" not in str(response)
    assert "tradingsymbol" not in str(response)


def test_desk_memory_reports_query_failure_instead_of_empty_history(monkeypatch):
    collection = MemoryCollection(fail=True)
    monkeypatch.setattr(server, "db", type("DB", (), {"trade_cycles": collection})())

    async def owner_for_request(_request, _role):
        return "admin"

    monkeypatch.setattr(server, "_ledger_owner", owner_for_request)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.desk_memory(request=None, days=60, role="admin"))
    assert error.value.status_code == 503
    assert error.value.detail == "Trade memory unavailable"
