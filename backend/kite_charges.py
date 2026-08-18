"""Build Kite virtual-contract-note charge requests from the day order book."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

IST = timezone(timedelta(hours=5, minutes=30))


def has_fills_on_date(
    trades: Optional[Iterable[dict]] = None,
    orders: Optional[Iterable[dict]] = None,
    *,
    today_ymd: str,
) -> bool:
    """True when Kite has a fill or COMPLETE order stamped on ``today_ymd``."""
    for t in trades or []:
        if not isinstance(t, dict):
            continue
        ymd = order_date_ymd(
            t.get("fill_timestamp") or t.get("order_timestamp") or t.get("exchange_timestamp")
        )
        if ymd != today_ymd:
            continue
        try:
            qty = float(t.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if qty > 0:
            return True
    for o in orders or []:
        if not isinstance(o, dict):
            continue
        ymd = order_date_ymd(o.get("order_timestamp") or o.get("exchange_timestamp"))
        if ymd != today_ymd:
            continue
        status = str(o.get("status") or "").upper().strip()
        if status != "COMPLETE":
            continue
        try:
            qty = float(o.get("filled_quantity") or o.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if qty > 0:
            return True
    return False


def quotes_traded_on_date(quotes: Optional[dict], today_ymd: str) -> bool:
    """True when a Kite quote last_trade_time is on ``today_ymd`` (live special session)."""
    if not isinstance(quotes, dict):
        return False
    rows = quotes.values() if quotes else []
    for q in rows:
        if not isinstance(q, dict):
            continue
        inner = q.get("ohlc") if isinstance(q.get("ohlc"), dict) else None
        ymd = order_date_ymd(
            q.get("last_trade_time")
            or q.get("timestamp")
            or q.get("exchange_timestamp")
            or (inner.get("last_trade_time") if inner else None)
        )
        if ymd != today_ymd:
            continue
        try:
            lp = float(q.get("last_price") or 0)
        except (TypeError, ValueError):
            lp = 0.0
        if lp > 0:
            return True
    return False


def parse_kite_timestamp(ts: Any) -> Optional[datetime]:
    """Best-effort datetime for Kite last_trade_time / order timestamps (IST if naive)."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=IST)
        return ts
    s = str(ts).strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        if "T" in s or "+" in s[10:] or s.count("-") > 2:
            dt = datetime.fromisoformat(s[:32])
        else:
            dt = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt
    except Exception:
        return None


def newest_last_trade_age_seconds(quotes: Optional[dict], *, now: Optional[datetime] = None) -> Optional[float]:
    """Age in seconds of the newest quote last_trade_time, or None."""
    if not isinstance(quotes, dict):
        return None
    now = now or datetime.now(IST)
    if now.tzinfo is None:
        now = now.replace(tzinfo=IST)
    best = None
    for q in quotes.values():
        if not isinstance(q, dict):
            continue
        inner = q.get("ohlc") if isinstance(q.get("ohlc"), dict) else None
        ts = parse_kite_timestamp(
            q.get("last_trade_time")
            or q.get("timestamp")
            or q.get("exchange_timestamp")
            or (inner.get("last_trade_time") if inner else None)
        )
        if ts is None:
            continue
        age = (now - ts.astimezone(now.tzinfo)).total_seconds()
        if best is None or age < best:
            best = age
    return best


def quote_session_live_now(
    quotes: Optional[dict],
    *,
    now: Optional[datetime] = None,
    max_age_seconds: float = 180,
) -> bool:
    """True when an index last_trade_time is within ``max_age_seconds`` — session is printing."""
    age = newest_last_trade_age_seconds(quotes, now=now)
    return age is not None and 0 <= age <= max_age_seconds


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


def index_orders_by_id(orders: Optional[Iterable[dict]]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for o in orders or []:
        if not isinstance(o, dict):
            continue
        oid = str(o.get("order_id") or "").strip()
        if oid:
            out[oid] = o
    return out


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


def build_charge_params_from_trades(
    trades: Optional[Iterable[dict]],
    *,
    today_ymd: str,
    orders_by_id: Optional[dict[str, dict]] = None,
) -> tuple[list[dict], dict[str, int]]:
    """Primary path: every day fill from kite.trades() → contract-note row.

    Positions P&L can move without a usable COMPLETE order average_price.
    Trades always carry a non-zero fill price for executed quantity.
    """
    orders_by_id = orders_by_id or {}
    stats = {
        "trades_today": 0,
        "trades_used": 0,
        "trades_skipped_zero": 0,
        "trades_skipped_other_day": 0,
        "source": "trades",
    }
    # One virtual-note row per order_id. Zerodha F&O brokerage is ₹20 per
    # executed *order*, not per exchange fill — sending every trade_id
    # double-counts brokerage (and GST on that brokerage).
    buckets: dict[str, dict] = {}
    orphan = 0

    for t in trades or []:
        if not isinstance(t, dict):
            continue
        ymd = order_date_ymd(
            t.get("fill_timestamp") or t.get("order_timestamp") or t.get("exchange_timestamp")
        )
        if ymd and ymd != today_ymd:
            stats["trades_skipped_other_day"] += 1
            continue
        stats["trades_today"] += 1
        try:
            qty = float(t.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        try:
            avg = float(t.get("average_price") or t.get("price") or 0)
        except (TypeError, ValueError):
            avg = 0.0
        if qty <= 0 or avg <= 0:
            stats["trades_skipped_zero"] += 1
            continue

        oid = str(t.get("order_id") or "").strip()
        if not oid:
            orphan += 1
            oid = str(t.get("trade_id") or f"t{orphan}")
        parent = orders_by_id.get(oid) or {}
        b = buckets.get(oid)
        if not b:
            b = {
                "order_id": oid,
                "exchange": t.get("exchange") or parent.get("exchange") or "NFO",
                "tradingsymbol": t.get("tradingsymbol") or parent.get("tradingsymbol"),
                "transaction_type": t.get("transaction_type") or parent.get("transaction_type") or "BUY",
                "variety": parent.get("variety") or "regular",
                "product": t.get("product") or parent.get("product") or "NRML",
                "order_type": parent.get("order_type") or "MARKET",
                "_notional": 0.0,
                "_qty": 0.0,
            }
            buckets[oid] = b
        b["_notional"] += avg * qty
        b["_qty"] += qty
        stats["trades_used"] += 1

    params: list[dict] = []
    for b in buckets.values():
        qty = int(round(b["_qty"]))
        avg = (b["_notional"] / b["_qty"]) if b["_qty"] else 0.0
        if qty <= 0 or avg <= 0:
            continue
        params.append({
            "order_id": b["order_id"],
            "exchange": b["exchange"],
            "tradingsymbol": b["tradingsymbol"],
            "transaction_type": b["transaction_type"],
            "variety": b["variety"],
            "product": b["product"],
            "order_type": b["order_type"],
            "quantity": qty,
            "average_price": avg,
        })

    return params, stats


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
        "source": "orders",
    }

    for o in orders or []:
        if not isinstance(o, dict):
            continue
        ymd = order_date_ymd(o.get("order_timestamp") or o.get("exchange_timestamp"))
        # Missing timestamp: still try (Kite usually always sends one).
        if ymd and ymd != today_ymd:
            status = str(o.get("status") or "").upper().strip()
            if status == "COMPLETE":
                stats["skipped_other_day"] += 1
            continue

        status = str(o.get("status") or "").upper().strip()
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
            qty = int(float(o.get("filled_quantity") or o.get("quantity") or 0))
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


def resolve_charge_params(
    orders: Optional[Iterable[dict]],
    trades: Optional[Iterable[dict]],
    *,
    today_ymd: str,
) -> tuple[list[dict], dict[str, Any]]:
    """One charge row per executed order (not per fill).

    COMPLETE orders with a usable average are preferred (matches Zerodha
    brokerage). Otherwise collapse kite.trades() by order_id so split
    fills do not each attract ₹20.
    """
    orders_by_id = index_orders_by_id(orders)
    order_params, order_stats = build_charge_params(
        orders,
        today_ymd=today_ymd,
        trade_avgs=trade_avg_by_order(trades),
    )
    if order_params:
        _, trade_stats = build_charge_params_from_trades(
            trades, today_ymd=today_ymd, orders_by_id=orders_by_id
        )
        stats = {**trade_stats, **order_stats, "source": "orders"}
        return order_params, stats

    trade_params, trade_stats = build_charge_params_from_trades(
        trades, today_ymd=today_ymd, orders_by_id=orders_by_id
    )
    stats = {**order_stats, **trade_stats, "source": "trades"}
    return trade_params, stats


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
        # Some SDK versions nest under data; tolerate both.
        ch = row.get("charges")
        if ch is None and isinstance(row.get("data"), dict):
            ch = (row.get("data") or {}).get("charges")
        if not isinstance(ch, dict):
            # Flat charge dict?
            if any(k in row for k in ("brokerage", "total", "transaction_tax")):
                ch = row
            else:
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

    # If Kite left total empty but lines exist, sum the lines.
    if abs(charges_total) < 1e-9:
        lined = (
            brokerage
            + transaction_tax
            + exchange_turnover_charge
            + sebi_turnover_charge
            + stamp_duty
            + gst_total
        )
        if abs(lined) > 1e-9:
            charges_total = lined

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
