import asyncio
from types import SimpleNamespace

import server
from oi_tracker import OITracker


class SettingsTracker:
    def __init__(self):
        self.saved = None

    async def save_settings(self, patch):
        self.saved = patch
        return patch


def test_market_memory_setting_defaults_on_in_config(monkeypatch):
    monkeypatch.setattr(server, "_live_settings", lambda: {})
    monkeypatch.setattr(server, "tracker", None)

    config = asyncio.run(server.get_config())

    assert config["show_market_memory"] is True


def test_market_memory_setting_can_be_disabled_through_admin_settings(monkeypatch):
    tracker = SettingsTracker()
    monkeypatch.setattr(server, "tracker", tracker)
    payload = server.SettingsIn(show_market_memory=False)

    result = asyncio.run(server.update_settings(payload, _admin=True))

    assert tracker.saved == {"show_market_memory": False}
    assert result["show_market_memory"] is False


def test_market_memory_setting_is_persisted_by_tracker():
    class SettingsCollection:
        def __init__(self):
            self.update = None

        async def update_one(self, query, update, upsert):
            self.update = (query, update, upsert)

    tracker = OITracker.__new__(OITracker)
    tracker.settings = {}
    collection = SettingsCollection()
    tracker.db = SimpleNamespace(settings=collection)

    asyncio.run(tracker.save_settings({"show_market_memory": False}))

    assert tracker.settings["show_market_memory"] is False
    assert collection.update == (
        {"_id": "alerts"},
        {"$set": {"show_market_memory": False}},
        True,
    )


def test_site_walkthrough_setting_is_persisted_by_tracker():
    class SettingsCollection:
        def __init__(self):
            self.update = None

        async def update_one(self, query, update, upsert):
            self.update = (query, update, upsert)

    tracker = OITracker.__new__(OITracker)
    tracker.settings = {"sitewalkthrough_enabled": True}
    collection = SettingsCollection()
    tracker.db = SimpleNamespace(settings=collection)

    asyncio.run(tracker.save_settings({"sitewalkthrough_enabled": False}))

    assert tracker.settings["sitewalkthrough_enabled"] is False
    assert collection.update == (
        {"_id": "alerts"},
        {"$set": {"sitewalkthrough_enabled": False}},
        True,
    )

    asyncio.run(tracker.save_settings({"sitewalkthrough_enabled": True}))

    assert tracker.settings["sitewalkthrough_enabled"] is True
    assert collection.update == (
        {"_id": "alerts"},
        {"$set": {"sitewalkthrough_enabled": True}},
        True,
    )
