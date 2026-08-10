"""Tests for Kite day-charges param building."""

from datetime import datetime

from kite_charges import (
    aggregate_contract_notes,
    build_charge_params,
    order_date_ymd,
    trade_avg_by_order,
)


def test_order_date_ymd_formats():
    assert order_date_ymd("2026-08-10 11:22:33") == "2026-08-10"
    assert order_date_ymd("2026-08-10T11:22:33+05:30") == "2026-08-10"
    assert order_date_ymd(datetime(2026, 8, 10, 11, 22, 33)) == "2026-08-10"


def test_skips_zero_average_price():
    """Zero avg would make /charges/orders fail the whole batch."""
    orders = [
        {
            "order_id": "1",
            "status": "COMPLETE",
            "order_timestamp": "2026-08-10 10:00:00",
            "exchange": "NFO",
            "tradingsymbol": "NIFTY2581124150PE",
            "transaction_type": "BUY",
            "variety": "regular",
            "product": "NRML",
            "order_type": "MARKET",
            "filled_quantity": 325,
            "average_price": 0,
        },
        {
            "order_id": "2",
            "status": "COMPLETE",
            "order_timestamp": "2026-08-10 10:05:00",
            "exchange": "NFO",
            "tradingsymbol": "NIFTY2581124200PE",
            "transaction_type": "SELL",
            "variety": "regular",
            "product": "NRML",
            "order_type": "LIMIT",
            "filled_quantity": 65,
            "average_price": 12.5,
        },
    ]
    params, stats = build_charge_params(orders, today_ymd="2026-08-10")
    assert len(params) == 1
    assert params[0]["order_id"] == "2"
    assert stats["skipped_zero_price"] == 1
    assert stats["complete_today"] == 2


def test_trade_avg_backfill():
    orders = [
        {
            "order_id": "9",
            "status": "COMPLETE",
            "order_timestamp": "2026-08-10 10:00:00",
            "exchange": "NFO",
            "tradingsymbol": "NIFTY2581124150PE",
            "transaction_type": "BUY",
            "variety": "regular",
            "product": "NRML",
            "order_type": "MARKET",
            "filled_quantity": 100,
            "average_price": 0,
        }
    ]
    trades = [
        {"order_id": "9", "quantity": 60, "average_price": 3.5},
        {"order_id": "9", "quantity": 40, "price": 3.0},
    ]
    avgs = trade_avg_by_order(trades)
    params, stats = build_charge_params(orders, today_ymd="2026-08-10", trade_avgs=avgs)
    assert len(params) == 1
    assert abs(params[0]["average_price"] - 3.3) < 1e-9
    assert stats["skipped_zero_price"] == 0


def test_aggregate_notes():
    notes = [
        {
            "charges": {
                "brokerage": 20,
                "total": 45.5,
                "transaction_tax": 10,
                "transaction_tax_type": "STT",
                "exchange_turnover_charge": 5,
                "sebi_turnover_charge": 0.5,
                "stamp_duty": 1,
                "gst": {"igst": 9, "cgst": 0, "sgst": 0, "total": 9},
            }
        }
    ]
    out = aggregate_contract_notes(notes)
    assert out["charges_total"] == 45.5
    assert out["brokerage"] == 20
    assert out["transaction_tax_label"] == "STT"
    assert out["gst"]["total"] == 9
