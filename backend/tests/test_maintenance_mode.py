from fastapi.testclient import TestClient
from fastapi import Request

import server


class SettingsCollection:
    def __init__(self, enabled):
        self.enabled = enabled

    async def find_one(self, query, sort=None, projection=None):
        if query.get("_id") == "maintenance_mode":
            return {"_id": "maintenance_mode", "enabled": self.enabled}
        return None


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
    class WritableSettings(SettingsCollection):
        async def update_one(self, query, update, upsert=False):
            self.enabled = bool(update["$set"]["enabled"])

    fake_db = type("DB", (), {"settings": WritableSettings(False)})()
    monkeypatch.setattr(server, "db", fake_db)
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
    assert fake_db.settings.enabled is True


async def _none_async(request: Request):
    return None


async def _guest_async(request: Request):
    return {"token": "test-guest"}
