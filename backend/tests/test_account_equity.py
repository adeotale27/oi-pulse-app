from account_equity import (
    attach_live_funds,
    booked_pct,
    choose_funds_base,
    infer_cashflow,
    pnl_after_charges,
    total_trading_equity,
)
from trade_journal import apply_snapshot, month_stats, period_stats, snapshot_from_positions


def test_wallet_is_opening_not_span_or_leftover():
    """15L in the wallet, 20L SPAN on a leveraged book → base stays 15L."""
    book = total_trading_equity({
        "net": 500_000,
        "cash": 500_000,
        "utilised_debits": 2_000_000,
        "opening_balance": 1_500_000,
    })
    assert book["total"] == 1_500_000
    assert book["available"] == 500_000
    assert book["utilised"] == 2_000_000
    assert booked_pct(1500, book["total"]) == 0.1


def test_user_example_after_charges_is_point_one_percent():
    """₹1,500 after ₹200 charges on ₹15L wallet = 0.10%."""
    made = pnl_after_charges({"booked_pnl": 1700, "charges_total": 200})
    assert made == 1500
    assert booked_pct(made, 1_500_000) == 0.1


def test_screenshot_cash_plus_span_is_not_wallet():
    """Kite leftover ₹13,719 + SPAN ₹36.11L must not become ₹72.5L."""
    book = total_trading_equity({
        "net": 13_719,
        "cash": 3_639_055,
        "utilised_debits": 3_611_618,
        "opening_balance": 3_625_000,
    })
    assert book["total"] == 3_625_000
    assert booked_pct(15_431, book["total"]) == 0.4257


def test_missing_opening_uses_cash_when_cash_is_full_wallet():
    book = total_trading_equity({
        "net": 13_719,
        "cash": 3_639_055,
        "utilised_debits": 3_611_618,
    })
    assert book["total"] == 3_639_055


def test_duplicate_commodity_payload_does_not_double_wallet():
    book = total_trading_equity({
        "opening_balance": 3_625_000,
        "net": 13_719,
        "utilised_debits": 3_611_618,
        "commodity_opening_balance": 3_625_000,
        "commodity_net": 13_719,
        "commodity_utilised_debits": 3_611_618,
    })
    assert book["total"] == 3_625_000


def test_collateral_and_payin_count_as_wallet():
    book = total_trading_equity({
        "opening_balance": 1_000_000,
        "collateral": 400_000,
        "intraday_payin": 100_000,
        "net": 200_000,
        "utilised_debits": 1_200_000,
    })
    assert book["total"] == 1_500_000


def test_commodity_wallet_not_commodity_span():
    book = total_trading_equity({
        "opening_balance": 3_000_000,
        "utilised_debits": 2_000_000,
        "net": 1_000_000,
        "commodity_opening_balance": 200_000,
        "commodity_utilised_debits": 800_000,
        "commodity_net": 50_000,
    })
    assert book["total"] == 3_200_000
    assert book["commodity_total"] == 200_000


def test_nested_kite_margins_uses_opening():
    book = total_trading_equity({
        "equity": {
            "net": 100,
            "available": {"cash": 100, "opening_balance": 400},
            "utilised": {"debits": 300},
        },
    })
    assert book["total"] == 400


def test_snapshot_stamps_wallet_and_after_charges_pct():
    payload = {
        "open_count": 0,
        "exited_count": 1,
        "pnl_today": {"open": 0, "exited": 1700, "booked": 1700, "total": 1700},
        "funds": {
            "net": 500_000,
            "utilised_debits": 2_000_000,
            "opening_balance": 1_500_000,
        },
        "positions": [{
            "tradingsymbol": "NIFTY 24000 CE",
            "index": "NIFTY",
            "quantity": 0,
            "exited": True,
            "booked_pnl": 1700,
            "pnl": 1700,
        }],
    }
    snap = snapshot_from_positions(
        payload,
        date="2026-08-24",
        charges={"brokerage": 40, "charges_total": 200, "source": "kite"},
    )
    assert snap["funds_base"] == 1_500_000
    assert snap["booked_after_charges"] == 1500
    assert snap["booked_pct"] == 0.1
    later = snapshot_from_positions(
        {
            **payload,
            "funds": {
                "net": 501_500,
                "utilised_debits": 2_000_000,
                "opening_balance": 1_500_000,
            },
        },
        date="2026-08-24",
        charges={"brokerage": 40, "charges_total": 200, "source": "kite"},
    )
    out = apply_snapshot(snap, later, force_lock=False)
    assert out["funds_base"] == 1_500_000
    assert out["booked_pct"] == 0.1


def test_apply_snapshot_replaces_inflated_span_base():
    existing = {
        "date": "2026-08-24",
        "booked_pnl": 1500,
        "booked_after_charges": 1500,
        "funds_base": 7_250_000,
        "funds_total": 7_250_000,
        "exited_count": 1,
        "trade_count": 1,
        "legs": [{"exited": True, "realised": 1500}],
    }
    snap = {
        "date": "2026-08-24",
        "booked_pnl": 1500,
        "pnl_exited": 1500,
        "booked_after_charges": 1500,
        "funds_base": 3_625_000,
        "funds_total": 3_625_000,
        "trade_count": 1,
        "exited_count": 1,
        "legs": [{"exited": True}],
        "pnl_total": 1500,
    }
    out = apply_snapshot(existing, snap, force_lock=True)
    assert out["funds_base"] == 3_625_000
    assert out["funds_close"] == 3_625_000


def test_infer_cashflow_withdrawal():
    prev = {"funds_close": 3_030_000, "funds_total": 3_030_000}
    assert infer_cashflow(prev, 2_530_000) == -500_000


def test_month_pct_is_after_charges_on_first_wallet():
    days = [
        {
            "date": "2026-08-24",
            "booked_pnl": 3200,
            "charges_total": 200,
            "booked_after_charges": 3000,
            "funds_base": 3_000_000,
            "exited_count": 1,
            "win_trades": 1,
            "loss_trades": 0,
            "legs": [{"index": "NIFTY", "exited": True, "realised": 3200}],
        },
        {
            "date": "2026-08-25",
            "booked_pnl": 27200,
            "charges_total": 200,
            "booked_after_charges": 27000,
            "funds_base": 3_003_000,
            "inferred_cashflow": -10_000,
            "exited_count": 1,
            "win_trades": 1,
            "loss_trades": 0,
            "legs": [{"index": "NIFTY", "exited": True, "realised": 27200}],
        },
    ]
    m = month_stats(days)
    assert m["net_pnl"] == 30400
    assert m["funds_base"] == 3_000_000
    assert m["booked_pct"] == 1.0
    p = period_stats(days, start="2026-08-24", end="2026-08-25")
    assert p["booked_after_charges"] == 30000
    assert p["booked_pct"] == 1.0


def test_attach_live_funds_ignores_empty():
    doc = {"booked_pnl": 10}
    attach_live_funds(doc, None)
    assert "funds_base" not in doc
