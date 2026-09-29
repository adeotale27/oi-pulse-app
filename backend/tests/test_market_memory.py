import asyncio
from datetime import datetime, timedelta, timezone

import market_memory


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, field, direction):
        self.documents.sort(key=lambda row: row[field], reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return self.documents[:limit]


class Collection:
    def __init__(self, documents=None, state=None):
        self.documents = documents or []
        self.state = state

    async def find_one(self, *_args, **_kwargs):
        return self.state

    def find(self, *_args, **_kwargs):
        return Cursor(list(self.documents))


class FakeDatabase(dict):
    pass


def _event(level, stamp, interaction="TOUCH"):
    return {
        "index": "NIFTY",
        "level": level,
        "timestamp": stamp.isoformat(),
        "interactionType": interaction,
        "reaction5m": None,
    }


def test_summary_shortlist_preserves_historical_levels_on_both_sides_of_spot():
    now = datetime.now(timezone.utc)
    events = []
    for level in (23050, 23150, 23250, 23350, 23450, 23550, 23650, 22600):
        events.extend(
            _event(level, now - timedelta(minutes=5 + offset * 7), "REJECTION")
            for offset in range(6)
        )
    db = FakeDatabase({
        market_memory.EVENTS_COL: Collection(events),
        market_memory.STATE_COL: Collection(state={
            "previous_price": 22687.2,
            "updated_at": now.isoformat(),
        }),
    })

    result = asyncio.run(market_memory.summary(db, "NIFTY"))

    assert len(result["levels"]) <= 6
    assert any(row["levelType"] == "SUPPORT" and row["currentDistance"] > 0 for row in result["levels"])
    assert any(row["levelType"] == "RESISTANCE" and row["currentDistance"] < 0 for row in result["levels"])


def test_summary_fades_old_events_uses_latest_interaction_and_counts_ist_day(monkeypatch):
    now = datetime(2026, 9, 29, 3, 0, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(market_memory, "datetime", FrozenDateTime)
    events = [
        _event(24800, now - timedelta(days=60, minutes=offset), "REJECTION")
        for offset in range(0, 60, 10)
    ]
    events.extend([
        _event(25100, now - timedelta(hours=8, minutes=10)),
        _event(25100, now - timedelta(minutes=20)),
        _event(25100, now - timedelta(minutes=10)),
        _event(25100, now - timedelta(minutes=2)),
        _event(25100, now + timedelta(hours=1)),
    ])
    db = FakeDatabase({
        market_memory.EVENTS_COL: Collection(events),
        market_memory.STATE_COL: Collection(state={
            "previous_price": 25120,
            "updated_at": now.isoformat(),
        }),
    })

    result = asyncio.run(market_memory.summary(db, "NIFTY"))

    levels = {row["level"]: row for row in result["levels"]}
    assert 24800 not in levels
    assert levels[25100]["lastInteraction"] == (now - timedelta(minutes=2)).isoformat()
    assert levels[25100]["todayCount"] == 4
    assert levels[25100]["touchCount"] == 4
    assert levels[25100]["20DayCount"] == 4
