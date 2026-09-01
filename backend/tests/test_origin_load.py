"""Guards against origin stampedes that show up as Cloudflare 520/524."""
from pathlib import Path

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
