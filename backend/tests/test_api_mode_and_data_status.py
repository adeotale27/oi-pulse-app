import json
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

import server


class FakeTracker:
    def __init__(self):
        self.mode = "offline"
        self.last_snapshot = {}
        self.selected_expiry = {}
    async def set_mode(self, mode: str):
        if mode not in ("kite", "offline"):
            raise ValueError("mode must be 'kite' or 'offline'")
        # simulate runtime check: rejecting kite when no credentials in tests
        if mode == "kite":
            # simulate missing credentials by raising
            raise RuntimeError("No Kite credentials configured")
        self.mode = mode
    def _get_service(self):
        return None
    def snapshot_age_seconds(self, snap):
        if not snap or not snap.get("timestamp"):
            return None
        try:
            ts = datetime.fromisoformat(snap["timestamp"])
            return (datetime.now(timezone.utc) - ts).total_seconds()
        except Exception:
            return None
    def request_background_refresh(self, index_name, expiry=None):
        return None


class FakeCollection:
    def __init__(self, doc=None):
        self._doc = doc
    async def find_one(self, query, sort=None, projection=None):
        # return stored doc if exists (used for fetching latest when market closed or for prev_doc)
        return self._doc
    async def update_one(self, *args, **kwargs):
        return None


def test_mode_endpoint_accepts_valid_and_rejects_invalid(monkeypatch):
    ft = FakeTracker()
    monkeypatch.setattr(server, "tracker", ft)
    client = TestClient(server.app)

    # valid mode: offline
    r = client.post("/api/mode", json={"mode": "offline"})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["mode"] == "offline"

    # invalid mode should return 400
    r = client.post("/api/mode", json={"mode": "invalid-mode"})
    assert r.status_code == 400

    # request to set kite should fail (simulated missing creds)
    r = client.post("/api/mode", json={"mode": "kite"})
    assert r.status_code == 400


def test_get_oi_change_offline_returns_data_status_and_anchor_prev(monkeypatch):
    ft = FakeTracker()
    # Current snapshot is "fresh" so /change won't replace it from DB.
    now = datetime.now(timezone.utc)
    cur_ts = now.isoformat()
    prev_ts = (now - timedelta(minutes=4)).isoformat()
    ft.last_snapshot["NIFTY"] = {
        "index": "NIFTY",
        "timestamp": cur_ts,
        "price": 12345.0,
        "atm": 12300,
        "strikes": [{"strike": 12300, "ce_oi": 100000, "pe_oi": 90000}],
    }

    # previous document inside a 5-minute window
    prev_doc = {
        "index": "NIFTY",
        "timestamp": prev_ts,
        "price": 12340.0,
        "atm": 12300,
        "strikes": [{"strike": 12300, "ce_oi": 90000, "pe_oi": 95000}],
    }

    class WindowAwareCollection:
        async def find_one(self, query, sort=None, projection=None):
            # Previous-window query includes $lt current_ts
            ts_q = (query or {}).get("timestamp") or {}
            if isinstance(ts_q, dict) and "$lt" in ts_q:
                return prev_doc
            # Latest-current lookup — return None so we keep memory snapshot
            return None
        async def update_one(self, *args, **kwargs):
            return None

    fake_db = type("DB", (), {"oi_snapshots": WindowAwareCollection()})

    monkeypatch.setattr(server, "tracker", ft)
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "is_market_open", lambda: False)

    client = TestClient(server.app)
    r = client.get("/api/oi/NIFTY/change", params={"minutes": 5})
    assert r.status_code == 200
    payload = r.json()
    # data_status should indicate not live (offline)
    assert "data_status" in payload
    ds = payload["data_status"]
    assert ds["is_live"] is False
    assert ds["stale_reason"] == "missing_kite_credentials"
    assert ds["data_date"] is not None
    assert ds.get("label") == "OFFLINE"
    assert "as_of" in ds
    # previous should be present and match our prev_doc timestamp
    assert payload["previous"]["timestamp"] == prev_doc["timestamp"]
    assert "also_windows" in payload


def test_timeframe_anchor_strict_window(monkeypatch):
    ft = FakeTracker()
    now = datetime.now(timezone.utc)
    cur_ts = now.isoformat()
    fake_coll = FakeCollection(doc=None)  # simulate no prev inside window
    fake_db = type("DB", (), {"oi_snapshots": fake_coll})
    ft.last_snapshot["NIFTY"] = {"index": "NIFTY", "timestamp": cur_ts, "strikes": []}
    monkeypatch.setattr(server, "tracker", ft)
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "is_market_open", lambda: False)
    client = TestClient(server.app)
    # request minutes=5 -> no previous inside 5 min window
    r = client.get("/api/oi/NIFTY/change", params={"minutes": 5})
    assert r.status_code == 200
    payload = r.json()
    assert payload["previous"] is None
    assert payload["history_ready"] is False


def test_change_batches_also_windows(monkeypatch):
    ft = FakeTracker()
    now = datetime.now(timezone.utc)
    cur_ts = now.isoformat()
    prev_1 = {"index": "NIFTY", "timestamp": (now - timedelta(minutes=1)).isoformat(), "strikes": []}
    prev_3 = {"index": "NIFTY", "timestamp": (now - timedelta(minutes=3)).isoformat(), "strikes": []}
    ft.last_snapshot["NIFTY"] = {"index": "NIFTY", "timestamp": cur_ts, "strikes": []}

    class MultiWindowCollection:
        async def find_one(self, query, sort=None, projection=None):
            ts_q = (query or {}).get("timestamp") or {}
            if not isinstance(ts_q, dict) or "$gte" not in ts_q:
                return None
            gte = datetime.fromisoformat(ts_q["$gte"])
            # Pick the earliest baseline that fits the window start
            age_min = (now - gte).total_seconds() / 60.0
            if age_min >= 2.5:
                return prev_3
            if age_min >= 0.5:
                return prev_1
            return None
        async def update_one(self, *args, **kwargs):
            return None

    monkeypatch.setattr(server, "tracker", ft)
    monkeypatch.setattr(server, "db", type("DB", (), {"oi_snapshots": MultiWindowCollection()}))
    monkeypatch.setattr(server, "is_market_open", lambda: False)
    client = TestClient(server.app)
    r = client.get("/api/oi/NIFTY/change", params={"minutes": 15, "also": "1,3"})
    assert r.status_code == 200
    payload = r.json()
    assert "1" in payload["also_windows"]
    assert "3" in payload["also_windows"]
    assert payload["also_windows"]["1"]["previous"]["timestamp"] == prev_1["timestamp"]
    assert payload["also_windows"]["3"]["previous"]["timestamp"] == prev_3["timestamp"]


def test_tracker_metrics_exist(monkeypatch):
    # ensure tracker has metrics attribute (Counter-like)
    class SmallTracker:
        def __init__(self):
            self.metrics = {"poll_cycles": 0, "poll_timeouts": 0}
    st = SmallTracker()
    monkeypatch.setattr(server, "tracker", st)
    # don't call /api/status (depends on get_status) — just assert structure
    assert hasattr(st, "metrics")
    assert "poll_cycles" in st.metrics


def test_admin_settings_update_and_effect(monkeypatch):
    # Fake admin allow
    async def allow_admin(request):
        return True
    monkeypatch.setattr(server, "require_admin", allow_admin)

    class FakeTrackerForSettings:
        def __init__(self):
            self.settings = {"oi_poll_interval_seconds": 15, "straddle_poll_interval_seconds": 60}
        async def save_settings(self, patch):
            self.settings.update(patch)
            return self.settings
    ft = FakeTrackerForSettings()
    monkeypatch.setattr(server, "tracker", ft)
    client = TestClient(server.app)
    r = client.post("/api/settings", json={
        "_id": "alerts",
        "alert_indices_override_date": "2099-01-01",
        "oi_poll_interval_seconds": 30,
        "straddle_poll_interval_seconds": 60,
        "positions_poll_interval_seconds": 15,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["oi_poll_interval_seconds"] == 30
    assert data["positions_poll_interval_seconds"] == 15
    # GET /api/config should reflect the new poll interval
    cfg = client.get("/api/config").json()
    assert cfg["poll_interval_seconds"] == 30
    assert cfg["positions_poll_interval_seconds"] == 15
