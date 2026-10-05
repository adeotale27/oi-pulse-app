from fastapi.testclient import TestClient
from fastapi import Request

import server


class SettingsCollection:
    def __init__(self, enabled):
        self.enabled = enabled
        self.sitewalkthrough_enabled = True

    async def find_one(self, query, sort=None, projection=None):
        if query.get("_id") == "maintenance_mode":
            return {"_id": "maintenance_mode", "enabled": self.enabled}
        if query.get("_id") == "alerts":
            return {"_id": "alerts", "sitewalkthrough_enabled": self.sitewalkthrough_enabled}
        return None

    async def update_one(self, query, update, upsert=False):
        values = update["$set"]
        if query.get("_id") == "maintenance_mode":
            self.enabled = bool(values["enabled"])
        elif query.get("_id") == "alerts":
            self.sitewalkthrough_enabled = bool(values["sitewalkthrough_enabled"])


def test_maintenance_state_is_persisted_flag(monkeypatch):
    monkeypatch.setattr(server, "db", type("DB", (), {"settings": SettingsCollection(True)})())
    assert __import__("asyncio").run(server._get_maintenance_state()) is True


def test_guest_entry_is_safely_blocked_during_maintenance(monkeypatch):
    monkeypatch.setattr(server, "db", type("DB", (), {"settings": SettingsCollection(True)})())
    response = TestClient(server.app).post("/api/auth/guest", json={"name": "Test Guest"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Desk is preparing for a short update. Please try again soon."}


def test_maintenance_state_defaults_off_when_database_is_unavailable(monkeypatch):
    monkeypatch.setattr(server, "db", None)
    assert __import__("asyncio").run(server._get_maintenance_state()) is False


def test_maintenance_toggle_requires_admin(monkeypatch):
    fake_db = type(
        "DB",
        (),
        {"settings": SettingsCollection(False), "admin_sessions": SettingsCollection(None)},
    )()
    monkeypatch.setattr(server, "db", fake_db)
    response = TestClient(server.app).post("/api/auth/maintenance", json={"enabled": True})
    assert response.status_code == 401


def test_guest_cannot_toggle_maintenance_but_admin_can(monkeypatch):
    settings = SettingsCollection(False)
    fake_db = type("DB", (), {"settings": settings})()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setattr(server, "_admin_from_request", lambda request: _none_async(request))
    monkeypatch.setattr(server, "_guest_from_request", lambda request: _guest_async(request))
    client = TestClient(server.app)

    guest_response = client.post("/api/auth/maintenance", json={"enabled": True})
    assert guest_response.status_code == 401

    async def admin_session(request: Request):
        return {"token": "test-admin"}

    monkeypatch.setattr(server, "_admin_from_request", admin_session)
    admin_response = client.post("/api/auth/maintenance", json={"enabled": True})
    assert admin_response.status_code == 200
    assert settings.enabled is True
    assert settings.sitewalkthrough_enabled is False
    assert admin_response.json()["sitewalkthrough_enabled"] is False
    assert __import__("asyncio").run(server._get_sitewalkthrough_enabled()) is False

    live_response = client.post("/api/auth/maintenance", json={"enabled": False})
    assert live_response.status_code == 200
    assert settings.enabled is False
    assert settings.sitewalkthrough_enabled is False
    assert live_response.json()["sitewalkthrough_enabled"] is False
    assert __import__("asyncio").run(server._get_sitewalkthrough_enabled()) is False


def test_walkthrough_cannot_be_enabled_while_site_maintenance_is_active(monkeypatch):
    from fastapi import HTTPException

    class Tracker:
        def __init__(self):
            self.saved = None

        async def save_settings(self, patch):
            self.saved = patch
            return patch

    tracker = Tracker()

    async def maintenance_active():
        return True

    monkeypatch.setattr(server, "tracker", tracker)
    monkeypatch.setattr(server, "_get_maintenance_state", maintenance_active)

    try:
        __import__("asyncio").run(
            server.update_settings(
                server.SettingsIn(sitewalkthrough_enabled=True),
                _admin=True,
            )
        )
    except HTTPException as error:
        assert error.status_code == 409
        assert "maintenance is active" in error.detail
    else:
        raise AssertionError("Walkthrough enable must be rejected during site maintenance")

    assert tracker.saved is None


def test_disabling_existing_maintenance_keeps_walkthrough_disabled(monkeypatch):
    settings = SettingsCollection(True)
    settings.enabled = True
    monkeypatch.setattr(server, "db", type("DB", (), {"settings": settings})())
    monkeypatch.setattr(server, "tracker", None)

    async def admin_session(request: Request):
        return {"token": "test-admin"}

    monkeypatch.setattr(server, "_admin_from_request", admin_session)
    response = TestClient(server.app).post("/api/auth/maintenance", json={"enabled": False})

    assert response.status_code == 200
    assert response.json()["maintenance_mode"] is False
    assert response.json()["sitewalkthrough_enabled"] is False
    assert settings.sitewalkthrough_enabled is False


async def _none_async(request: Request):
    return None


async def _guest_async(request: Request):
    return {"token": "test-guest"}
