from account_equity import (
    attach_live_funds,
    booked_pct,
    infer_cashflow,
    total_trading_equity,
)
from trade_journal import apply_snapshot, month_stats, period_stats, snapshot_from_positions


def test_total_book_is_available_plus_utilised_not_net():
    """20L in trades + 10L free = 30L base, never the 10L leftover."""
    book = total_trading_equity({
        "net": 1_000_000,
        "cash": 1_000_000,
        "utilised_debits": 2_000_000,
        "opening_balance": 3_000_000,
    })
    assert book["total"] == 3_000_000
    assert book["available"] == 1_000_000
    assert booked_pct(3000, book["total"]) == 0.1


def test_user_example_tuesday_compounded_base():
    assert booked_pct(27000, 3_003_000) == 0.8991


def test_commodity_added_to_equity_book():
    book = total_trading_equity({
        "net": 1_000_000,
        "utilised_debits": 2_000_000,
        "commodity_net": 50_000,
        "commodity_utilised_debits": 150_000,
    })
    assert book["total"] == 3_200_000
    assert book["commodity_total"] == 200_000


def test_nested_kite_margins_shape():
    book = total_trading_equity({
        "equity": {
            "net": 100,
            "available": {"cash": 100, "opening_balance": 400},
            "utilised": {"debits": 300},
        },
    })
    assert book["total"] == 400


def test_snapshot_stamps_funds_and_apply_freezes_base():
    payload = {
        "open_count": 0,
        "exited_count": 1,
        "pnl_today": {"open": 0, "exited": 3000, "booked": 3000, "total": 3000},
        "funds": {"net": 1_000_000, "utilised_debits": 2_000_000},
        "positions": [{
            "tradingsymbol": "NIFTY 24000 CE",
            "index": "NIFTY",
            "quantity": 0,
            "exited": True,
            "booked_pnl": 3000,
            "pnl": 3000,
        }],
    }
    snap = snapshot_from_positions(payload, date="2026-08-24")
    assert snap["funds_base"] == 3_000_000
    assert snap["funds_total"] == 3_000_000
    assert snap["booked_pct"] == 0.1
    later = snapshot_from_positions(
        {
            **payload,
            "pnl_today": {"open": 0, "exited": 3000, "booked": 3000, "total": 3000},
            "funds": {"net": 1_003_000, "utilised_debits": 2_000_000},
        },
        date="2026-08-24",
    )
    out = apply_snapshot(snap, later, force_lock=False)
    assert out["funds_base"] == 3_000_000
    assert out["funds_total"] == 3_003_000
    assert out["booked_pct"] == 0.1


def test_eod_lock_stores_funds_close():
    existing = {
        "date": "2026-08-24",
        "booked_pnl": 3000,
        "funds_base": 3_000_000,
        "funds_total": 3_003_000,
        "exited_count": 1,
        "trade_count": 1,
        "legs": [{"exited": True, "realised": 3000}],
    }
    snap = {
        "date": "2026-08-24",
        "booked_pnl": 3000,
        "pnl_exited": 3000,
        "funds_base": 3_003_000,
        "funds_total": 3_003_000,
        "trade_count": 1,
        "exited_count": 1,
        "legs": [{"exited": True}],
        "pnl_total": 3000,
    }
    out = apply_snapshot(existing, snap, force_lock=True)
    assert out["funds_base"] == 3_000_000
    assert out["funds_close"] == 3_003_000


def test_infer_cashflow_withdrawal():
    prev = {"funds_close": 3_030_000, "funds_total": 3_030_000}
    assert infer_cashflow(prev, 2_530_000) == -500_000


def test_month_and_period_pct_use_first_day_base():
    days = [
        {
            "date": "2026-08-24",
            "booked_pnl": 3000,
            "funds_base": 3_000_000,
            "exited_count": 1,
            "win_trades": 1,
            "loss_trades": 0,
            "legs": [{"index": "NIFTY", "exited": True, "realised": 3000}],
        },
        {
            "date": "2026-08-25",
            "booked_pnl": 27000,
            "funds_base": 3_003_000,
            "inferred_cashflow": -10_000,
            "exited_count": 1,
            "win_trades": 1,
            "loss_trades": 0,
            "legs": [{"index": "NIFTY", "exited": True, "realised": 27000}],
        },
    ]
    m = month_stats(days)
    assert m["net_pnl"] == 30000
    assert m["funds_base"] == 3_000_000
    assert m["booked_pct"] == 1.0
    assert m["inferred_withdrawn"] == 10_000
    assert m["kite_has_withdrawals"] is False
    p = period_stats(days, start="2026-08-24", end="2026-08-25")
    assert p["booked_pct"] == 1.0
    assert p["funds_base"] == 3_000_000


def test_attach_live_funds_ignores_empty():
    doc = {"booked_pnl": 10}
    attach_live_funds(doc, None)
    assert "funds_base" not in doc
