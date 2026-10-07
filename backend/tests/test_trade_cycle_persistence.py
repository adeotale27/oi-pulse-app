import asyncio
from types import SimpleNamespace

import server


class EmptyCursor:
    async def to_list(self, length):
        return []


class MemoryTradeCycles:
    def __init__(self):
        self.find_queries = []
        self.updates = []

    def find(self, query):
        self.find_queries.append(query)
        return EmptyCursor()

    async def update_one(self, query, update, upsert):
        self.updates.append((query, update, upsert))


def test_disabled_admin_cycle_saving_does_not_disable_guest_cycle_history(monkeypatch):
    collection = MemoryTradeCycles()
    monkeypatch.setattr(server, "db", SimpleNamespace(trade_cycles=collection))
    monkeypatch.setattr(
        server,
        "tracker",
        SimpleNamespace(settings={"trade_cycle_saving_enabled": False}),
    )
    monkeypatch.setattr(
        server.ledger,
        "reconcile_cycles",
        lambda *args, owner_id, **kwargs: [{"cycle_id": f"{owner_id}-cycle"}],
    )

    async def exercise():
        await server._persist_trade_ledger("admin", {"positions": []}, feed_ok=False)
        await server._persist_trade_ledger("guest:42", {"positions": []}, feed_ok=False)

    asyncio.run(exercise())

    assert [query["owner_id"] for query in collection.find_queries] == ["guest:42"]
    assert len(collection.updates) == 1
    assert collection.updates[0][0] == {"cycle_id": "guest:42-cycle"}
