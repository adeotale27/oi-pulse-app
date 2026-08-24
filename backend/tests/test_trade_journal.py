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
    charges_usable,
    apply_charges,
    iso_is_trading_day,
    is_closed_session_auto_snapshot,
    include_on_journal_calendar,
    period_stats,
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
    assert snap["booked_index_pnl"].get("NIFTY", 0) == 0
    assert snap["booked_index_pnl"]["SENSEX"] == 500.5
    assert snap["exited_count"] == 1
    assert snap["win_trades"] == 1
    assert snap["loss_trades"] == 0
    assert len(snap["legs"]) == 2


def test_snapshot_includes_partial_close_realised():
    """3 lots closed of 13 still-open: journal books Kite realised, not only flat exits."""
    payload = {
        "open_count": 1,
        "exited_count": 1,
        "partial_count": 1,
        "pnl_today": {
            "open": 19000.0,
            "exited": 8400.0,
            "booked": 21000.0,
            "total": 27400.0,
        },
        "positions": [
            {
                "tradingsymbol": "NIFTY 24000 CE",
                "index": "NIFTY",
                "side": "CE",
                "quantity": -650,
                "exited": False,
                "partial": True,
                "closed_quantity": 195,
                "pnl": 19000.0,
                "realised": 12600.0,
                "booked_pnl": 12600.0,
            },
            {
                "tradingsymbol": "SENSEX 76600 PE",
                "index": "SENSEX",
                "side": "PE",
                "quantity": 0,
                "exited": True,
                "booked_pnl": 8400.0,
                "realised": 8400.0,
                "pnl": 8400.0,
            },
        ],
    }
    snap = snapshot_from_positions(payload, date="2026-08-13")
    assert snap["booked_pnl"] == 21000.0
    assert snap["pnl_exited"] == 21000.0
    assert snap["partial_count"] == 1
    assert snap["win_trades"] == 2
    assert snap["booked_index_pnl"]["NIFTY"] == 12600.0
    assert snap["booked_index_pnl"]["SENSEX"] == 8400.0
    nifty = next(leg for leg in snap["legs"] if leg["index"] == "NIFTY")
    assert nifty["partial"] is True
    assert nifty["exited"] is False
    assert nifty["realised"] == 12600.0
    assert day_pnl(snap) == 21000.0
    s = month_stats([snap])
    assert s["net_pnl"] == 21000.0
    assert s["trading_days"] == 1


def test_month_stats_win_rate_and_best_day():
    days = [
        {"date": "2026-08-03", "booked_pnl": 2000, "pnl_exited": 2000, "exited_count": 2},
        {"date": "2026-08-04", "booked_pnl": -400, "pnl_exited": -400, "exited_count": 1},
        {
            "date": "2026-08-05",
            "pnl_total": 800,
            "trade_count": 1,
            "open_count": 1,
            "exited_count": 0,
            "index_pnl": {"NIFTY": 800},
        },
    ]
    s = month_stats(days)
    assert s["trading_days"] == 2
    assert s["win_days"] == 1
    assert s["lose_days"] == 1
    assert s["net_pnl"] == 1600
    assert s["best_day"]["date"] == "2026-08-03"
    assert s["worst_day"]["date"] == "2026-08-04"
    assert s["profit_factor"] == 5.0
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

    kept = sanitize_journal_fields({
        "went_well": "good day",
        "tags": ["Expiry", "SENSEX", "Theta", "Plan followed"],
        "followed_plan": False,
        "rating": None,
    })
    assert kept["went_well"] == "good day"
    assert kept["tags"] == ["Expiry", "SENSEX", "Theta", "Plan followed"]
    assert kept["followed_plan"] is False
    assert kept["rating"] is None


def test_decode_screenshot_rejects_non_image_payload():
    import base64
    data = base64.b64encode(b"not-an-image-just-text-padding-xxxxxxxx").decode()
    try:
        decode_screenshot({"mime": "image/jpeg", "data": data, "name": "x.jpg"})
        assert False, "expected error"
    except ValueError:
        pass


def test_decode_screenshot_accepts_jpeg_magic():
    import base64
    # Minimal JPEG SOI + padding so length >= 32.
    raw = b"\xff\xd8\xff" + (b"\x00" * 40)
    data = base64.b64encode(raw).decode()
    out = decode_screenshot({"mime": "image/jpeg", "data": data, "name": "ok.jpg"})
    assert out["mime"] == "image/jpeg"
    assert out["id"]


def test_month_bounds():
    assert month_bounds(2026, 8) == ("2026-08-01", "2026-09-01")
    assert month_bounds(2026, 12) == ("2026-12-01", "2027-01-01")


def test_should_lock_eod_at_1545_on_weekday():
    ist = timezone(timedelta(hours=5, minutes=30))
    before = datetime(2026, 8, 13, 15, 44, tzinfo=ist)
    at = datetime(2026, 8, 13, 15, 45, tzinfo=ist)
    after = datetime(2026, 8, 13, 16, 5, tzinfo=ist)
    sunday = datetime(2026, 8, 16, 16, 0, tzinfo=ist)
    assert should_lock_eod(before) is False
    assert should_lock_eod(at) is True
    assert should_lock_eod(after) is True
    assert should_lock_eod(sunday) is False


def test_should_lock_eod_waits_for_mcx_when_gold_enabled():
    ist = timezone(timedelta(hours=5, minutes=30))
    eve = datetime(2026, 8, 13, 16, 0, tzinfo=ist)
    late = datetime(2026, 8, 13, 23, 35, tzinfo=ist)
    assert should_lock_eod(eve) is True
    assert should_lock_eod(eve, enabled_indices=["NIFTY", "GOLD"]) is False
    assert should_lock_eod(late, enabled_indices=["NIFTY", "GOLD"]) is True


def test_weekend_journal_autos_are_not_trading_days():
    assert iso_is_trading_day("2026-08-14") is True
    assert iso_is_trading_day("2026-08-15") is False
    assert iso_is_trading_day("2026-08-16") is False
    sat = {
        "date": "2026-08-15",
        "booked_pnl": 2100,
        "exited_count": 1,
        "went_well": "",
        "notes": "",
        "tags": [],
    }
    assert is_closed_session_auto_snapshot(sat) is True
    assert include_on_journal_calendar(sat) is False
    sat_notes = {**sat, "notes": "weekend review"}
    assert is_closed_session_auto_snapshot(sat_notes) is False
    assert include_on_journal_calendar(sat_notes) is True
    s = month_stats([
        {"date": "2026-08-14", "booked_pnl": 2100, "pnl_exited": 2100, "exited_count": 1},
        sat,
    ])
    assert s["trading_days"] == 1
    assert s["net_pnl"] == 2100


def test_journal_sessions_skip_full_holidays_keep_muhurat():
    assert iso_is_trading_day("2026-01-26") is False  # Republic Day
    assert iso_is_trading_day("2026-11-10") is False  # Balipratipada
    assert iso_is_trading_day("2026-03-03") is False  # Holi
    assert iso_is_trading_day("2026-11-08") is False  # listed Muhurat but Sunday 2026
    assert iso_is_trading_day("2025-10-21") is True  # Diwali Laxmi Pujan muhurat (Tue)
    muhurat = {
        "date": "2025-10-21",
        "booked_pnl": 800,
        "exited_count": 1,
        "went_well": "",
        "notes": "",
        "tags": [],
    }
    republic = {
        "date": "2026-01-26",
        "booked_pnl": 800,
        "exited_count": 1,
        "went_well": "",
        "notes": "",
        "tags": [],
    }
    assert is_closed_session_auto_snapshot(muhurat) is False
    assert include_on_journal_calendar(muhurat) is True
    assert is_closed_session_auto_snapshot(republic) is True
    assert include_on_journal_calendar(republic) is False
    s = month_stats([
        {"date": "2025-10-17", "booked_pnl": 100, "pnl_exited": 100, "exited_count": 1},
        muhurat,
        republic,
    ])
    assert s["trading_days"] == 2
    assert s["net_pnl"] == 900


def test_should_lock_eod_muhurat_after_session_close():
    ist = timezone(timedelta(hours=5, minutes=30))
    before = datetime(2025, 10, 21, 14, 49, tzinfo=ist)
    at = datetime(2025, 10, 21, 14, 50, tzinfo=ist)
    after_regular = datetime(2025, 10, 21, 15, 45, tzinfo=ist)
    morning = datetime(2025, 10, 21, 13, 0, tzinfo=ist)
    republic = datetime(2026, 1, 26, 16, 0, tzinfo=ist)
    sunday_listed = datetime(2026, 11, 8, 20, 0, tzinfo=ist)
    assert should_lock_eod(morning) is False
    assert should_lock_eod(before) is False
    assert should_lock_eod(at) is True
    assert should_lock_eod(after_regular) is True
    assert should_lock_eod(republic) is False
    assert should_lock_eod(sunday_listed) is False
    assert should_lock_eod(republic, live_session=True) is False  # before 20:00
    assert should_lock_eod(datetime(2026, 1, 26, 20, 0, tzinfo=ist), live_session=True) is True


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
    assert locked["frozen_pnl"] == 500.5
    assert locked["booked_pnl"] == 500.5


def test_apply_snapshot_locks_live_book_at_close():
    snap = snapshot_from_positions(_payload(), date="2026-08-13")
    ist = timezone(timedelta(hours=5, minutes=30))
    close = datetime(2026, 8, 13, 15, 45, tzinfo=ist)
    out = apply_snapshot({}, snap, now=close)
    assert out["eod_locked"] is True
    assert out["frozen_pnl"] == 500.5
    assert out["booked_pnl"] == 500.5
    assert day_pnl(out) == 500.5


def test_snapshot_fields_are_what_mongo_stores():
    """Journal snapshot is a Mongo document shape — not Kite and not the browser."""
    snap = snapshot_from_positions(
        _payload(),
        date="2026-08-13",
        charges={"brokerage": 40.0, "charges_total": 120.5, "source": "kite_virtual_contract"},
    )
    for key in (
        "date", "booked_pnl", "pnl_exited", "pnl_open", "pnl_total",
        "brokerage", "charges_total", "booked_after_charges", "legs", "snapshot_at",
    ):
        assert key in snap
    assert snap["date"] == "2026-08-13"
    assert snap["brokerage"] == 40.0
    assert snap["charges_total"] == 120.5
    assert snap["booked_after_charges"] == 380.0


def test_year_heatmap_by_index_and_month():
    days = [
        {
            "date": "2026-07-02",
            "booked_pnl": 1000,
            "pnl_exited": 1000,
            "exited_count": 1,
            "eod_locked": True,
            "frozen_pnl": 1000,
            "booked_index_pnl": {"NIFTY": 1000},
            "index_pnl": {"NIFTY": 1000},
        },
        {
            "date": "2026-08-13",
            "booked_pnl": -200,
            "pnl_exited": -200,
            "exited_count": 1,
            "eod_locked": True,
            "frozen_pnl": -200,
            "booked_index_pnl": {"SENSEX": -200},
            "index_pnl": {"SENSEX": -200},
        },
    ]
    h = year_heatmap(days, 2026)
    assert h["month_nets"][6] == 1000
    assert h["month_nets"][7] == -200
    assert h["by_index"]["NIFTY"][6] == 1000
    assert h["by_index"]["SENSEX"][7] == -200
    assert h["months"][7]["trading_days"] == 1


def test_year_heatmap_ignores_open_nifty_mtm():
    days = [
        {
            "date": "2026-08-13",
            "pnl_total": 19074,
            "pnl_open": -1600,
            "booked_pnl": 20674,
            "open_count": 9,
            "exited_count": 11,
            "index_pnl": {"NIFTY": -1600, "SENSEX": 20674},
            "booked_index_pnl": {"SENSEX": 20674},
            "legs": [
                {"index": "NIFTY", "exited": False, "pnl": -1600},
                {"index": "SENSEX", "exited": True, "pnl": 20674},
            ],
        },
        {
            "date": "2026-08-12",
            "pnl_total": -400,
            "open_count": 2,
            "exited_count": 0,
            "index_pnl": {"NIFTY": -400},
            "booked_index_pnl": {},
            "legs": [{"index": "NIFTY", "exited": False, "pnl": -400}],
        },
    ]
    h = year_heatmap(days, 2026)
    assert h["by_index"]["NIFTY"][7] == 0
    assert h["by_index"]["SENSEX"][7] == 20674
    assert h["month_nets"][7] == 20674
    assert h["months"][7]["trading_days"] == 1


def test_year_heatmap_infers_index_from_symbol():
    """Locked days may omit leg.index; SENSEX booked still belongs on the SENSEX row."""
    days = [
        {
            "date": "2026-08-13",
            "booked_pnl": 23100,
            "exited_count": 1,
            "partial_count": 1,
            "booked_index_pnl": {"NIFTY": 2100},
            "legs": [
                {"tradingsymbol": "NIFTY26AUG24800CE", "index": "NIFTY", "exited": True, "realised": 2100, "pnl": 2100},
                {"tradingsymbol": "SENSEX26AUG76800PE", "partial": True, "realised": 21000, "pnl": 21000},
            ],
        },
    ]
    h = year_heatmap(days, 2026)
    assert h["by_index"]["NIFTY"][7] == 2100
    assert h["by_index"]["SENSEX"][7] == 21000
    assert h["month_nets"][7] == 23100
    assert h["other"][7] == 0


def test_snapshot_and_heatmap_others_for_non_desk():
    """Enabled MCX majors get their own heatmap row; FINNIFTY/stocks stay Others."""
    snap = snapshot_from_positions(
        {
            "exited_count": 3,
            "pnl_today": {"open": 0, "exited": 900, "booked": 900, "total": 900},
            "positions": [
                {
                    "tradingsymbol": "GOLD26AUG76000CE",
                    "index": "GOLD",
                    "quantity": 0,
                    "exited": True,
                    "booked_pnl": 400,
                    "realised": 400,
                    "pnl": 400,
                },
                {
                    "tradingsymbol": "FINNIFTY26AUG25000CE",
                    "quantity": 0,
                    "exited": True,
                    "booked_pnl": 300,
                    "realised": 300,
                    "pnl": 300,
                },
                {
                    "tradingsymbol": "RELIANCE26AUG1400CE",
                    "quantity": 0,
                    "exited": True,
                    "booked_pnl": 200,
                    "realised": 200,
                    "pnl": 200,
                },
            ],
        },
        date="2026-08-13",
    )
    assert snap["legs"][0]["index"] == "GOLD"
    assert snap["booked_index_pnl"]["GOLD"] == 400
    assert snap["booked_index_pnl"]["OTHER"] == 500
    assert snap["booked_index_pnl"].get("NIFTY", 0) == 0
    h = year_heatmap([snap], 2026)
    assert h["by_index"]["GOLD"][7] == 400
    assert h["other"][7] == 500
    assert h["by_index"]["NIFTY"][7] == 0
    assert h["month_nets"][7] == 900


def test_snapshot_fills_index_from_tradingsymbol():
    snap = snapshot_from_positions(
        {
            "exited_count": 1,
            "pnl_today": {"open": 0, "exited": 21000, "booked": 21000, "total": 21000},
            "positions": [
                {
                    "tradingsymbol": "SENSEX26AUG76800PE",
                    "quantity": 0,
                    "exited": True,
                    "booked_pnl": 21000,
                    "pnl": 21000,
                },
            ],
        },
        date="2026-08-13",
    )
    assert snap["legs"][0]["index"] == "SENSEX"
    assert snap["booked_index_pnl"]["SENSEX"] == 21000


def test_snapshot_copies_ledger_clocks_onto_legs():
    snap = snapshot_from_positions(
        {
            "exited_count": 1,
            "pnl_today": {"open": 0, "exited": 500, "booked": 500, "total": 500},
            "positions": [
                {
                    "tradingsymbol": "NIFTY26AUG24000CE",
                    "quantity": 0,
                    "exited": True,
                    "booked_pnl": 500,
                    "pnl": 500,
                    "entry_time": "2026-08-21 14:32:11",
                    "exit_time": "2026-08-24 10:04:12",
                    "carried": True,
                    "token_gap": True,
                },
            ],
        },
        date="2026-08-24",
    )
    leg = snap["legs"][0]
    assert leg["entry_time"] == "2026-08-21 14:32:11"
    assert leg["exit_time"] == "2026-08-24 10:04:12"
    assert leg["carried"] is True
    assert leg["token_gap"] is True


def test_day_pnl_never_uses_open_total():
    assert day_pnl({"pnl_total": 5000, "booked_pnl": 1200, "pnl_exited": 1200}) == 1200
    assert day_pnl({"pnl_total": -400, "open_count": 2, "exited_count": 0}) == 0
    assert day_pnl({
        "pnl_total": 800,
        "legs": [
            {"exited": False, "pnl": 300},
            {"exited": True, "pnl": 500},
        ],
    }) == 500


def test_empty_charges_are_not_usable():
    assert charges_usable(None) is False
    assert charges_usable({}) is False
    assert charges_usable({"brokerage": 0, "charges_total": 0, "note": "No priced fills today."}) is False
    assert charges_usable({"brokerage": 40, "charges_total": 120}) is True
    snap = snapshot_from_positions(_payload(), date="2026-08-13", charges={"brokerage": 0, "charges_total": 0})
    assert "brokerage" not in snap
    assert "booked_after_charges" not in snap


def test_carry_charges_recomputes_after_charges_from_booked():
    existing = {
        "date": "2026-08-13",
        "brokerage": 40.0,
        "charges_total": 120.5,
        "booked_after_charges": 380.0,
        "booked_pnl": 500.5,
        "exited_count": 1,
        "eod_locked": False,
    }
    snap = snapshot_from_positions(_payload(), date="2026-08-13")
    out = apply_snapshot(existing, snap)
    assert out["charges_total"] == 120.5
    assert out["booked_pnl"] == 500.5
    assert out["booked_after_charges"] == 380.0
    snap["booked_pnl"] = 800.0
    snap["pnl_exited"] = 800.0
    out2 = apply_snapshot(existing, snap)
    assert out2["booked_after_charges"] == round(800.0 - 120.5, 2)
    patched = apply_charges({"booked_pnl": 20674}, {"brokerage": 40, "charges_total": 185.25})
    assert patched["booked_after_charges"] == round(20674 - 185.25, 2)


def test_apply_snapshot_revises_locked_same_day_booked():
    """Expiry leftover settle after 15:45 must update the frozen journal row."""
    existing = {
        "date": "2026-08-18",
        "pnl_total": 50076.0,
        "pnl_exited": 50076.0,
        "booked_pnl": 50076.0,
        "frozen_pnl": 50076.0,
        "trade_count": 15,
        "exited_count": 15,
        "eod_locked": True,
        "eod_locked_at": "2026-08-18T10:15:00+00:00",
        "went_well": "held",
        "charges_total": 2228.4,
        "brokerage": 1060.25,
    }
    snap = snapshot_from_positions({
        "open_count": 0,
        "exited_count": 16,
        "pnl_today": {"open": 0, "exited": 47489.15, "booked": 47489.15, "total": 47489.15},
        "positions": [
            {
                "tradingsymbol": "NIFTY2681823250PE",
                "index": "NIFTY",
                "side": "PE",
                "quantity": 0,
                "exited": True,
                "booked_pnl": 47489.15,
                "pnl": 47489.15,
            },
        ],
    }, date="2026-08-18")
    out = apply_snapshot(existing, snap)
    assert out is not None
    assert out["eod_locked"] is True
    assert out["eod_locked_at"] == existing["eod_locked_at"]
    assert out["booked_pnl"] == 47489.15
    assert out["frozen_pnl"] == 47489.15
    assert out["charges_total"] == 2228.4
    assert out["booked_after_charges"] == round(47489.15 - 2228.4, 2)
    empty = snapshot_from_positions({"positions": [], "pnl_today": {"total": 0, "open": 0, "exited": 0}})
    assert apply_snapshot(existing, empty) is None


def test_period_stats_from_to_and_index_filter():
    days = [
        {
            "date": "2026-08-17",
            "booked_pnl": 1000.25,
            "pnl_exited": 1000.25,
            "exited_count": 2,
            "charges_total": 100.10,
            "brokerage": 40.05,
            "legs": [
                {"tradingsymbol": "NIFTY1", "index": "NIFTY", "exited": True, "realised": 800.25, "pnl": 800.25},
                {"tradingsymbol": "SENSEX1", "index": "SENSEX", "exited": True, "realised": 200.00, "pnl": 200.00},
            ],
        },
        {
            "date": "2026-08-18",
            "booked_pnl": -50.50,
            "pnl_exited": -50.50,
            "exited_count": 1,
            "charges_total": 25.25,
            "brokerage": 10.00,
            "legs": [
                {"tradingsymbol": "NIFTY2", "index": "NIFTY", "exited": True, "realised": -50.50, "pnl": -50.50},
            ],
        },
        {
            "date": "2026-08-19",
            "booked_pnl": 9.99,
            "pnl_exited": 9.99,
            "exited_count": 1,
            "charges_total": 1.00,
            "legs": [
                {"tradingsymbol": "BANKNIFTY1", "index": "BANKNIFTY", "exited": True, "realised": 9.99, "pnl": 9.99},
            ],
        },
    ]
    all_s = period_stats(days, start="2026-08-17", end="2026-08-18")
    assert all_s["booked_pnl"] == 949.75
    assert all_s["charges_total"] == 125.35
    assert all_s["brokerage"] == 50.05
    assert all_s["booked_after_charges"] == round(949.75 - 125.35, 2)
    assert all_s["win_trades"] == 2
    assert all_s["loss_trades"] == 1
    assert all_s["win_rate"] == round(100.0 * 2 / 3, 2)
    assert all_s["trading_days"] == 2
    nifty = period_stats(days, start="2026-08-17", end="2026-08-18", index="NIFTY")
    assert nifty["booked_pnl"] == 749.75
    assert nifty["win_trades"] == 1
    assert nifty["loss_trades"] == 1
    assert nifty["win_rate"] == 50.0
    assert nifty["charges_are_all_indices"] is True
    assert nifty["charges_total"] == 125.35
    assert nifty["booked_after_charges"] is None
