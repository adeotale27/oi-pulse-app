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
