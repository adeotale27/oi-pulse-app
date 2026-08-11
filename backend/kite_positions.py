"""Normalise Kite Connect positions().net / positions().day into desk rows."""

from __future__ import annotations

from typing import Any, Optional


def position_key(p: dict) -> tuple:
    return (
        str(p.get("exchange") or ""),
        str(p.get("tradingsymbol") or ""),
        str(p.get("product") or ""),
    )


def merge_kite_net_day(net: Optional[list], day: Optional[list]) -> list[dict]:
    """Build the book the way Kite UI does.

    Zerodha docs (carry-forward square-off):
      • net quantity = 0  → actual current position (exited / flat)
      • day quantity ≠ 0 → today's square-off trade snapshot only

    Never let a day row overwrite a flat net row — that falsely resurrects
    closed legs as open (e.g. day buy-to-close qty +325 on a net-0 short).
    """
    # Defensive: callers sometimes shadow `net` with equity margin floats.
    if not isinstance(net, list):
        net = []
    if not isinstance(day, list):
        day = []

    by_key: dict[tuple, dict] = {}
    source: dict[tuple, str] = {}

    for p in net:
        key = position_key(p)
        if not key[1]:
            continue
        by_key[key] = dict(p)
        source[key] = "net"

    for p in day:
        key = position_key(p)
        if not key[1]:
            continue
        if key not in by_key:
            row = dict(p)
            row["day_quantity"] = p.get("quantity")
            by_key[key] = row
            source[key] = "day"
            continue
        # Net already owns this instrument — keep net quantity / average / pnl.
        # Never overwrite net.quantity with day.quantity (square-off day legs
        # stay non-zero while net is flat — that was resurrecting exited trades).
        row = by_key[key]
        row["day_quantity"] = p.get("quantity")
        for field in (
            "buy_quantity",
            "sell_quantity",
            "buy_price",
            "sell_price",
            "buy_value",
            "sell_value",
            "day_buy_quantity",
            "day_sell_quantity",
            "day_buy_price",
            "day_sell_price",
            "day_buy_value",
            "day_sell_value",
            "realised",
            "unrealised",
            "multiplier",
            "last_price",
        ):
            try:
                cur = float(row.get(field) or 0)
            except (TypeError, ValueError):
                cur = 0.0
            try:
                alt = float(p.get(field) or 0)
            except (TypeError, ValueError):
                alt = 0.0
            if abs(cur) < 1e-12 and abs(alt) > 1e-12:
                row[field] = p.get(field)
        # Prefer day's last_price when net is flat (LTP still useful for UI).
        try:
            if abs(float(row.get("quantity") or 0)) < 1e-12 and p.get("last_price") is not None:
                row["last_price"] = p.get("last_price")
        except (TypeError, ValueError):
            pass
        row["_merged_from"] = "net+day"
        by_key[key] = row

    out = []
    for key, p in by_key.items():
        p = dict(p)
        p["_source"] = source.get(key, "net")
        out.append(p)
    return out


def booked_pnl_from_kite_row(
    *,
    qty: int,
    buy_qty: int,
    sell_qty: int,
    buy_price: float,
    sell_price: float,
    pnl: float,
    realised: float,
    unrealised: float,
    exited: bool,
    buy_value: float = 0.0,
    sell_value: float = 0.0,
    last_price: float = 0.0,
    multiplier: float = 1.0,
) -> dict[str, Any]:
    """Normalise today's P&L so exited legs use booked money.

    Kite formula (forum / docs):
      pnl = (sell_value - buy_value) + (quantity * last_price * multiplier)
    Flat / exited → quantity term is 0 → sell_value - buy_value.
    """
    kite_pnl = float(pnl or 0)
    kite_realised = float(realised or 0)
    kite_unrealised = float(unrealised or 0)
    mult = float(multiplier or 1) or 1.0
    bv = float(buy_value or 0)
    sv = float(sell_value or 0)
    lp = float(last_price or 0)

    value_pnl = None
    if abs(bv) > 1e-9 or abs(sv) > 1e-9:
        value_pnl = (sv - bv) + (float(qty) * lp * mult)

    computed = 0.0
    matched = min(max(int(buy_qty), 0), max(int(sell_qty), 0))
    if matched > 0 and (buy_price or sell_price):
        computed = (float(sell_price) - float(buy_price)) * matched * mult

    if exited:
        if value_pnl is not None and abs(value_pnl) > 1e-9:
            booked = value_pnl
            source = "buy_sell_value"
        elif abs(kite_realised) > 1e-9:
            booked = kite_realised
            source = "realised"
        elif abs(kite_pnl) > 1e-9:
            booked = kite_pnl
            source = "pnl"
        else:
            booked = computed
            source = "buy_sell"
        return {
            "pnl": round(booked, 2),
            "realised": round(booked, 2),
            "unrealised": 0.0,
            "booked_pnl": round(booked, 2),
            "pnl_source": source,
        }

    # Open: prefer live Kite pnl; fall back to official formula.
    if abs(kite_pnl) > 1e-9:
        open_pnl = kite_pnl
        source = "kite"
    elif value_pnl is not None:
        open_pnl = value_pnl
        source = "buy_sell_value"
    else:
        open_pnl = computed
        source = "buy_sell"

    return {
        "pnl": round(open_pnl, 2),
        "realised": round(kite_realised, 2),
        "unrealised": round(
            kite_unrealised if abs(kite_unrealised) > 1e-9 else (open_pnl - kite_realised),
            2,
        ),
        "booked_pnl": round(kite_realised, 2),
        "pnl_source": source,
    }
