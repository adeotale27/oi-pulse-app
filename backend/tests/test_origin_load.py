"""Guards against origin stampedes that show up as Cloudflare 520/524."""
from pathlib import Path
import asyncio
from types import SimpleNamespace

from starlette.requests import Request

import server

ROOT = Path(__file__).resolve().parents[1]
TRACKER = (ROOT / "oi_tracker.py").read_text(encoding="utf-8")
SERVER = (ROOT / "server.py").read_text(encoding="utf-8")


def _fn(src: str, name: str) -> str:
    marker = f"async def {name}"
    i = src.index(marker)
    j = src.find("\n    async def ", i + 1)
    k = src.find("\n    def ", i + 1)
    ends = [n for n in (j, k) if n > i]
    return src[i : min(ends)] if ends else src[i:]


def test_set_credentials_does_not_dump_or_poll_inline():
    src = _fn(TRACKER, "set_credentials")
    assert "reload_instruments" not in src
    assert "_poll_once" not in src
    assert "schedule_fno_preload" not in src


def test_start_does_not_auto_preload_fno():
    src = _fn(TRACKER, "start")
    assert "schedule_fno_preload" not in src


def test_set_mode_does_not_extra_poll():
    src = _fn(TRACKER, "set_mode")
    assert "_poll_once" not in src


def test_get_expiries_does_not_refresh_instruments():
    src = _fn(SERVER, "get_expiries")
    assert "ensure_instruments_fresh" not in src


def test_ws_spot_does_not_quote_kite():
    src = _fn(SERVER, "ws_spot")
    assert "quote_ltp_safe" not in src
    assert "last_snapshot" in src


def test_get_oi_change_lookbacks_are_gathered():
    i = SERVER.index("async def get_oi_change")
    j = SERVER.index("async def get_history")
    src = SERVER[i:j]
    assert "asyncio.gather" in src
    assert "maxTimeMS" in src or "maxTimeMS" in SERVER
    oi = (ROOT / "oi_service.py").read_text(encoding="utf-8")
    i = oi.index("    def list_expiries(")
    j = oi.find("\n    def ", i + 1)
    src = oi[i:j]
    assert "_load_instruments" not in src


def test_history_has_index_for_time_window_queries():
    assert '[("index", 1), ("timestamp", 1)]' in SERVER


def test_get_config_does_not_reload_mongo():
    i = SERVER.index("async def get_config")
    j = SERVER.index("\n@api_router.", i + 1)
    src = SERVER[i:j]
    assert "reload_settings_from_db" not in src


def test_poll_loop_does_not_reload_settings_every_tick():
    src = _fn(TRACKER, "_loop")
    assert "reload_settings_from_db" not in src


def test_auth_state_survives_missing_db():
    src = _fn(SERVER, "auth_state")
    assert "if db is None" in src


def test_guest_auth_does_not_restore_or_disclose_identity_by_ip():
    state = _fn(SERVER, "auth_state")
    guest_start = _fn(SERVER, "auth_guest_start")
    kite_start = SERVER.index("async def _load_user_kite_doc")
    kite_end = SERVER.index("\nasync def _save_user_kite", kite_start)
    kite_lookup = SERVER[kite_start:kite_end]
    assert "_try_auto_guest_for_ip" not in SERVER
    assert "guest_ip_names" not in SERVER
    assert "guest_ip_names" not in state
    assert "auto_guest_token = None" in state
    assert "ever_approved" not in guest_start
    assert "returning_auto" not in guest_start
    assert 'find_one({"ip": ip, "status": "pending"})' not in guest_start
    assert "guest_name" not in kite_lookup
    assert "guest_token" in kite_lookup


def test_auth_state_never_returns_prior_guest_from_ip(monkeypatch):
    async def no_admin(request):
        return None

    async def no_guest(request):
        return None

    async def public_open():
        return True, None

    async def no_platform_config():
        return {}

    async def no_maintenance():
        return False

    async def no_auth_user_kite(is_admin, guest):
        return {}

    monkeypatch.setattr(server, "db", object())
    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setattr(server, "_get_public_access_state", public_open)
    monkeypatch.setattr(server, "_load_platform_config", no_platform_config)
    monkeypatch.setattr(server, "_get_maintenance_state", no_maintenance)
    monkeypatch.setattr(server, "_admin_from_request", no_admin)
    monkeypatch.setattr(server, "_guest_from_request", no_guest)
    monkeypatch.setattr(server, "_get_guest_require_approval", lambda: _async_value(True))
    monkeypatch.setattr(server, "_auth_user_kite_payload", no_auth_user_kite)
    monkeypatch.setattr(server, "_is_ip_blocked", lambda ip: _async_value(False))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/auth/state",
        "query_string": b"",
        "headers": [],
        "client": ("198.51.100.12", 4321),
        "server": ("testserver", 80),
    }

    result = asyncio.run(server.auth_state(Request(scope)))

    assert result["needs_guest_name"] is True
    assert result["suggested_guest_name"] is None
    assert result["auto_guest_token"] is None


def test_guest_kite_lookup_does_not_use_ip_or_name(monkeypatch):
    class KiteCollection:
        def __init__(self):
            self.queries = []

        async def find_one(self, query):
            self.queries.append(query)
            return None

    kites = KiteCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(user_kite=kites))
    result = asyncio.run(server._load_user_kite_doc({"name": "Shared Name", "ip": "198.51.100.12"}))
    assert result is None
    assert kites.queries == []


def test_desk_guide_cache_is_scoped_and_force_is_admin_only():
    start = SERVER.index("async def post_desk_guide")
    end = SERVER.index("\n@api_router.", start)
    route = SERVER[start:end]
    assert "cache_scope=cache_scope" in route
    assert 'allow_force=role == "admin"' in route


async def _async_value(value):
    return value


def test_admin_auth_returns_service_unavailable_when_mongo_is_down():
    verify = _fn(SERVER, "_verify_admin_password")
    remember = _fn(SERVER, "auth_remember_login")
    assert "HTTPException(503" in verify
    assert "HTTPException(503" in remember
    assert "ServerSelectionTimeoutError" in verify
    assert "ServerSelectionTimeoutError" in remember


def test_positions_kite_call_is_capped():
    i = SERVER.index("async def get_positions")
    j = SERVER.index("\n@api_router.", i + 1)
    src = SERVER[i:j]
    assert "wait_for" in src
    assert "kite.positions" in src


def test_ensure_instruments_fresh_does_not_dump_on_event_loop():
    src = _fn(TRACKER, "ensure_instruments_fresh")
    assert "to_thread" in src
    assert "reload_instruments(force=True)" not in src


def test_poll_once_does_not_await_instrument_dump():
    src = _fn(TRACKER, "_poll_once")
    assert "schedule_instruments_fresh" in src
    assert "await self.ensure_instruments_fresh" not in src


def test_get_current_oi_never_hits_kite():
    i = SERVER.index("async def get_current_oi")
    j = SERVER.index("async def get_expiries")
    src = SERVER[i:j]
    assert "get_snapshot" not in src
    assert "maxTimeMS" in src


def test_get_settings_mongo_reload_is_opt_in():
    i = SERVER.index("async def get_settings")
    j = SERVER.index("async def update_settings")
    src = SERVER[i:j]
    assert "reload: bool" in src
    assert "if tracker and reload" in src


def test_boot_assigns_tracker_before_indexes():
    i = SERVER.index("async def _boot():")
    j = SERVER.index("async def _ensure_mongo_indexes")
    src = SERVER[i:j]
    assert "tracker = OITracker(db)" in src
    assert "create_task(_boot_rest())" in src
    assert "await db.oi_snapshots.create_index" not in src


def test_kite_instrument_rows_off_loop():
    i = SERVER.index("async def _kite_instrument_rows")
    j = SERVER.find("\n@api_router.", i + 1)
    src = SERVER[i:j]
    assert "to_thread" in src
    assert "svc._load_instruments()" in src


def test_vrp_does_not_dump_instruments():
    vrp = (ROOT / "vrp_service.py").read_text(encoding="utf-8")
    i = vrp.index("def _index_token")
    j = vrp.find("\ndef ", i + 1)
    src = vrp[i:j]
    assert "_load_instruments" not in src


def test_seed_on_start_skips_unloaded_dump():
    src = _fn(TRACKER, "_seed_expiries_safe")
    assert "_loaded" in src
