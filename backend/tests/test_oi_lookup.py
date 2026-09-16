from oi_lookup import nearest_strike_index, prefer_newer_snapshot, trim_snapshot_around
from public_json import strip_secret_settings


def test_prefer_newer_snapshot():
    older = {"timestamp": "2026-09-16T03:00:00+00:00"}
    newer = {"timestamp": "2026-09-16T03:00:15+00:00"}
    assert prefer_newer_snapshot(older, newer) is newer
    assert prefer_newer_snapshot(newer, older) is newer


def test_trim_snapshot_around_centers_atm():
    strikes = [{"strike": s, "ce_oi": 1, "pe_oi": 1} for s in range(73000, 76100, 100)]
    snap = {"atm": 74300, "strikes": strikes, "timestamp": "t"}
    out = trim_snapshot_around(snap, 10)
    vals = [r["strike"] for r in out["strikes"]]
    assert vals[0] == 73300
    assert vals[-1] == 75300
    assert vals[10] == 74300
    assert len(snap["strikes"]) == 31
    moved = trim_snapshot_around({**snap, "atm": 75000}, 10)
    mid = [r["strike"] for r in moved["strikes"]][10]
    assert mid == 75000


def test_nearest_strike_when_atm_missing():
    strikes = [{"strike": s} for s in (100, 200, 300)]
    assert nearest_strike_index(strikes, 190) == 1


def test_strip_secret_settings():
    cleaned, dropped = strip_secret_settings(
        {
            "oi_poll_interval_seconds": 15,
            "api_key": "leak",
            "telegram_bot_token": "x",
            "enabled_indices": ["NIFTY"],
        }
    )
    assert cleaned["oi_poll_interval_seconds"] == 15
    assert "api_key" not in cleaned
    assert "telegram_bot_token" in dropped
    assert "api_key" in dropped
