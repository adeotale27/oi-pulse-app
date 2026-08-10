"""Build Kite virtual-contract-note charge requests from the day order book."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable, Optional


def order_date_ymd(ts: Any) -> Optional[str]:
    """Normalise Kite order/trade timestamps to YYYY-MM-DD (IST session date)."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.strftime("%Y-%m-%d")
    if isinstance(ts, date):
        return ts.strftime("%Y-%m-%d")
    s = str(ts).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None


def trade_avg_by_order(trades: Optional[Iterable[dict]]) -> dict[str, float]:
    """Weighted average fill price per order_id from kite.trades()."""
    acc: dict[str, list[float]] = {}
    for t in trades or []:
        if not isinstance(t, dict):
            continue
        oid = str(t.get("order_id") or "").strip()
        if not oid:
            continue
        try:
            qty = float(t.get("quantity") or 0)
            px = float(t.get("average_price") or t.get("price") or 0)
        except (TypeError, ValueError):
            continue
        if qty <= 0 or px <= 0:
            continue
        bucket = acc.setdefault(oid, [0.0, 0.0])  # notional, qty
        bucket[0] += px * qty
        bucket[1] += qty
    out: dict[str, float] = {}
    for oid, (notional, qty) in acc.items():
        if qty > 0:
            out[oid] = notional / qty
    return out


def build_charge_params(
    orders: Optional[Iterable[dict]],
    *,
    today_ymd: str,
    trade_avgs: Optional[dict[str, float]] = None,
) -> tuple[list[dict], dict[str, int]]:
    """Filter COMPLETE day fills into virtual-contract-note payloads.

    Kite requires ``average_price`` to be **non-zero**. A single zero-price
    row in the batch makes ``/charges/orders`` fail — which blanked our
    Charges chip. Prefer order average_price; fall back to trades() VWAP.
    """
    trade_avgs = trade_avgs or {}
    params: list[dict] = []
    stats = {
        "complete_today": 0,
        "skipped_zero_price": 0,
        "skipped_other_day": 0,
        "open_today": 0,
        "rejected_today": 0,
        "cancelled_today": 0,
    }

    for o in orders or []:
        if not isinstance(o, dict):
            continue
        ymd = order_date_ymd(o.get("order_timestamp") or o.get("exchange_timestamp"))
        # Missing timestamp: still try (Kite usually always sends one).
        if ymd and ymd != today_ymd:
            status = str(o.get("status") or "").upper()
            if status == "COMPLETE":
                stats["skipped_other_day"] += 1
            continue

        status = str(o.get("status") or "").upper()
        if status in ("OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED", "PUT ORDER REQ RECEIVED"):
            stats["open_today"] += 1
            continue
        if status in ("REJECTED",):
            stats["rejected_today"] += 1
            continue
        if status in ("CANCELLED", "CANCELED"):
            stats["cancelled_today"] += 1
            continue
        if status != "COMPLETE":
            continue

        stats["complete_today"] += 1
        try:
            qty = int(o.get("filled_quantity") or o.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0
        try:
            avg = float(o.get("average_price") or 0)
        except (TypeError, ValueError):
            avg = 0.0
        if avg <= 0:
            oid = str(o.get("order_id") or "")
            avg = float(trade_avgs.get(oid) or 0)
        # Docs: average_price must be non-zero — skip rather than fail the batch.
        if qty <= 0 or avg <= 0:
            stats["skipped_zero_price"] += 1
            continue

        params.append({
            "order_id": str(o.get("order_id") or len(params) + 1),
            "exchange": o.get("exchange") or "NFO",
            "tradingsymbol": o.get("tradingsymbol"),
            "transaction_type": o.get("transaction_type") or "BUY",
            "variety": o.get("variety") or "regular",
            "product": o.get("product") or "NRML",
            "order_type": o.get("order_type") or "MARKET",
            "quantity": qty,
            "average_price": avg,
        })

    return params, stats


def aggregate_contract_notes(notes: Optional[Iterable[dict]]) -> dict:
    """Sum brokerage / tax lines from get_virtual_contract_note rows."""

    def _f(v) -> float:
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    brokerage = 0.0
    charges_total = 0.0
    transaction_tax = 0.0
    exchange_turnover_charge = 0.0
    sebi_turnover_charge = 0.0
    stamp_duty = 0.0
    gst_total = 0.0
    gst_igst = 0.0
    gst_cgst = 0.0
    gst_sgst = 0.0
    tax_types: set[str] = set()

    for row in notes or []:
        if not isinstance(row, dict):
            continue
        ch = row.get("charges") or {}
        if not isinstance(ch, dict):
            continue
        brokerage += _f(ch.get("brokerage"))
        charges_total += _f(ch.get("total"))
        transaction_tax += _f(ch.get("transaction_tax"))
        exchange_turnover_charge += _f(ch.get("exchange_turnover_charge"))
        sebi_turnover_charge += _f(ch.get("sebi_turnover_charge"))
        stamp_duty += _f(ch.get("stamp_duty"))
        tt = ch.get("transaction_tax_type")
        if tt:
            tax_types.add(str(tt).upper())
        gst = ch.get("gst") or {}
        if isinstance(gst, dict):
            gst_igst += _f(gst.get("igst"))
            gst_cgst += _f(gst.get("cgst"))
            gst_sgst += _f(gst.get("sgst"))
            if gst.get("total") is not None:
                gst_total += _f(gst.get("total"))
            else:
                gst_total += _f(gst.get("igst")) + _f(gst.get("cgst")) + _f(gst.get("sgst"))

    tax_label = "STT"
    if tax_types:
        if "STT" in tax_types:
            tax_label = "STT"
        elif len(tax_types) == 1:
            tax_label = next(iter(tax_types))
        else:
            tax_label = "Transaction tax"

    breakdown = [
        {"key": "brokerage", "label": "Brokerage", "amount": round(brokerage, 2)},
        {"key": "transaction_tax", "label": tax_label, "amount": round(transaction_tax, 2)},
        {
            "key": "exchange_turnover_charge",
            "label": "Exchange txn charge",
            "amount": round(exchange_turnover_charge, 2),
        },
        {
            "key": "sebi_turnover_charge",
            "label": "SEBI charges",
            "amount": round(sebi_turnover_charge, 2),
        },
        {"key": "stamp_duty", "label": "Stamp duty", "amount": round(stamp_duty, 2)},
        {"key": "gst", "label": "GST", "amount": round(gst_total, 2)},
    ]

    return {
        "ok": True,
        "brokerage": round(brokerage, 2),
        "charges_total": round(charges_total, 2),
        "breakdown": breakdown,
        "gst": {
            "igst": round(gst_igst, 2),
            "cgst": round(gst_cgst, 2),
            "sgst": round(gst_sgst, 2),
            "total": round(gst_total, 2),
        },
        "transaction_tax": round(transaction_tax, 2),
        "transaction_tax_label": tax_label,
        "exchange_turnover_charge": round(exchange_turnover_charge, 2),
        "sebi_turnover_charge": round(sebi_turnover_charge, 2),
        "stamp_duty": round(stamp_duty, 2),
    }


def empty_charges_payload(*, order_count: int = 0, note: str = "No completed orders today.") -> dict:
    base = aggregate_contract_notes([])
    base.update({
        "order_count": order_count,
        "source": "kite_virtual_contract",
        "note": note,
    })
    return base
