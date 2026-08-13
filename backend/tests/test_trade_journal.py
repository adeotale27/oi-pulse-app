from datetime import datetime, timezone, timedelta

from trade_journal import (
    snapshot_from_positions,
    month_stats,
    sanitize_journal_fields,
    decode_screenshot,
    month_bounds,
    should_lock_eod,
    apply_snapshot,
    snapshot_is_empty,
    year_heatmap,
    day_pnl,
)


def _payload():
    return {
        "open_count": 2,
        "exited_count": 1,
        "pnl_today": {"open": 1000.0, "exited": 500.5, "total": 1500.5},
        "positions": [
            {"tradingsymbol": "NIFTY 24000 CE", "index": "NIFTY", "side": "CE", "strike": 24000, "quantity": -75, "exited": False, "pnl": 800},
            {"tradingsymbol": "SENSEX 76600 PE", "index": "SENSEX", "side": "PE", "strike": 76600, "quantity": 0, "exited": True, "booked_pnl": 500.5, "pnl": 500.5},
        ],
    }


def test_snapshot_counts_exited_wins():
    snap = snapshot_from_positions(_payload(), date="2026-08-13")
    assert snap["date"] == "2026-08-13"
    assert snap["pnl_total"] == 1500.5
    assert snap["booked_pnl"] == 500.5
    assert snap["index_pnl"]["NIFTY"] == 800
    assert snap["index_pnl"]["SENSEX"] == 500.5
    assert snap["exited_count"] == 1
    assert snap["win_trades"] == 1
    assert snap["loss_trades"] == 0
    assert len(snap["legs"]) == 2


def test_month_stats_win_rate_and_best_day():
    days = [
        {"date": "2026-08-03", "pnl_total": 2000, "trade_count": 2, "open_count": 0, "exited_count": 2},
        {"date": "2026-08-04", "pnl_total": -400, "trade_count": 1, "open_count": 0, "exited_count": 1},
        {"date": "2026-08-05", "pnl_total": 800, "trade_count": 1, "open_count": 1, "exited_count": 0},
    ]
    s = month_stats(days)
    assert s["trading_days"] == 3
    assert s["win_days"] == 2
    assert s["lose_days"] == 1
    assert s["net_pnl"] == 2400
    assert s["best_day"]["date"] == "2026-08-03"
    assert s["worst_day"]["date"] == "2026-08-04"
    assert s["profit_factor"] == 7.0
    assert 0 <= s["desk_score"] <= 100


def test_sanitize_clips_and_tags():
    out = sanitize_journal_fields({
        "went_well": "a" * 9000,
        "went_wrong": "rolled too late",
        "notes": None,
        "tags": ["Held", "Held", "bad<script>", ""],
        "rating": 9,
        "followed_plan": True,
    })
    assert len(out["went_well"]) == 8000
    assert out["rating"] == 5
    assert out["followed_plan"] is True
    assert "Held" in out["tags"]
    assert all("<" not in t for t in out["tags"])


def test_decode_screenshot_rejects_bad_mime():
    try:
        decode_screenshot({"mime": "application/pdf", "data": "aaaa", "name": "x"})
        assert False, "expected error"
    except ValueError:
        pass


def test_month_bounds():
    assert month_bounds(2026, 8) == ("2026-08-01", "2026-09-01")
    assert month_bounds(2026, 12) == ("2026-12-01", "2027-01-01")


def test_should_lock_eod_at_1541_on_weekday():
    ist = timezone(timedelta(hours=5, minutes=30))
    before = datetime(2026, 8, 13, 15, 40, tzinfo=ist)
    at = datetime(2026, 8, 13, 15, 41, tzinfo=ist)
    after = datetime(2026, 8, 13, 16, 5, tzinfo=ist)
    sunday = datetime(2026, 8, 16, 16, 0, tzinfo=ist)
    assert should_lock_eod(before) is False
    assert should_lock_eod(at) is True
    assert should_lock_eod(after) is True
    assert should_lock_eod(sunday) is False


def test_apply_snapshot_does_not_clobber_locked_or_empty():
    existing = {
        "date": "2026-08-13",
        "pnl_total": 1500.5,
        "pnl_exited": 500.5,
        "trade_count": 2,
        "eod_locked": True,
        "frozen_pnl": 1500.5,
    }
    empty = snapshot_from_positions({"positions": [], "pnl_today": {"total": 0, "open": 0, "exited": 0}})
    assert snapshot_is_empty(empty)
    assert apply_snapshot(existing, empty, force_lock=True) is None

    live = {
        "date": "2026-08-13",
        "pnl_total": 1500.5,
        "pnl_exited": 500.5,
        "trade_count": 2,
        "open_count": 1,
        "exited_count": 1,
        "eod_locked": False,
    }
    ist = timezone(timedelta(hours=5, minutes=30))
    morning = datetime(2026, 8, 13, 11, 0, tzinfo=ist)
    assert apply_snapshot(live, empty, now=morning) is None
    locked = apply_snapshot(live, empty, force_lock=True, now=morning)
    assert locked["eod_locked"] is True
    assert locked["frozen_pnl"] == 1500.5


def test_apply_snapshot_locks_live_book_at_close():
    snap = snapshot_from_positions(_payload(), date="2026-08-13")
    ist = timezone(timedelta(hours=5, minutes=30))
    close = datetime(2026, 8, 13, 15, 41, tzinfo=ist)
    out = apply_snapshot({}, snap, now=close)
    assert out["eod_locked"] is True
    assert out["frozen_pnl"] == 1500.5
    assert out["booked_pnl"] == 500.5
    assert day_pnl(out) == 1500.5


def test_year_heatmap_by_index_and_month():
    days = [
        {
            "date": "2026-07-02",
            "pnl_total": 1000,
            "trade_count": 1,
            "eod_locked": True,
            "frozen_pnl": 1000,
            "index_pnl": {"NIFTY": 1000},
        },
        {
            "date": "2026-08-13",
            "pnl_total": -200,
            "trade_count": 1,
            "eod_locked": True,
            "frozen_pnl": -200,
            "index_pnl": {"SENSEX": -200},
        },
    ]
    h = year_heatmap(days, 2026)
    assert h["month_nets"][6] == 1000
    assert h["month_nets"][7] == -200
    assert h["by_index"]["NIFTY"][6] == 1000
    assert h["by_index"]["SENSEX"][7] == -200
    assert h["months"][7]["trading_days"] == 1
