"""Dynamic STALE threshold follows OI poll cadence (browser-independent writer)."""
from datetime import datetime, timezone, timedelta

import pytest

from oi_tracker import OITracker


class _FakeDb:
    def __init__(self):
        self.system_meta = self
        self.settings = self
        self.credentials = self
        self.oi_snapshots = self

    async def find_one(self, *args, **kwargs):
        return None

    async def update_one(self, *args, **kwargs):
        return None

    async def delete_many(self, *args, **kwargs):
        return None


def test_stale_after_scales_with_poll_interval():
    t = OITracker(_FakeDb())
    t.settings["oi_poll_interval_seconds"] = 15
    assert t.stale_after_seconds() == 90  # floor
    t.settings["oi_poll_interval_seconds"] = 30
    assert t.stale_after_seconds() == 90
    t.settings["oi_poll_interval_seconds"] = 60
    assert t.stale_after_seconds() == 180


def test_build_data_status_uses_dynamic_threshold(monkeypatch):
    import server

    class T:
        mode = "kite"
        settings = {"oi_poll_interval_seconds": 60}

        def stale_after_seconds(self):
            return 180

    monkeypatch.setattr(server, "tracker", T())
    now = datetime.now(timezone.utc)
    current = {"timestamp": (now - timedelta(seconds=50)).isoformat()}
    ds = server._build_data_status(current, True, 50.0)
    assert ds["is_live"] is True
    assert ds["stale_after_seconds"] == 180
    assert ds["label"] == "LIVE"

    ds2 = server._build_data_status(current, True, 200.0)
    assert ds2["is_live"] is False
    assert ds2["stale_reason"] == "stale_cache"
    assert ds2["label"] == "STALE"
