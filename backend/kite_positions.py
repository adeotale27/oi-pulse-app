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
            elif field == "last_price" and abs(alt) > 1e-12:
                # Day LTP is usually fresher than net during the session.
                row[field] = p.get(field)
            elif field == "realised" and abs(alt) > abs(cur) + 1e-9:
                # Today's square-off / partial close often lands on the day row.
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
    mark_to_market: bool = False,
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

    def _booked_from_kite_fields():
        """Kite Positions Booked column.

        The Connect API often puts the whole P&L into ``unrealised`` and leaves
        ``realised`` at 0. Treat that as “no split” and do not book 0.
        """
        if abs(kite_realised) > 1e-9:
            return kite_realised, "realised"
        if abs(kite_unrealised) > 1e-9 and abs(kite_unrealised - kite_pnl) > max(1.0, 0.02 * abs(kite_pnl or 1.0)):
            return kite_pnl - kite_unrealised, "kite_pnl_minus_unrealised"
        return None, None

    if exited:
        # Flat row: Kite Booked = P/L (qty term is 0). Prefer realised, then pnl.
        split, split_src = _booked_from_kite_fields()
        if split is not None:
            booked = split
            source = split_src or "realised"
        elif abs(kite_pnl) > 1e-9:
            booked = kite_pnl
            source = "pnl"
        elif value_pnl is not None and abs(value_pnl) > 1e-9:
            booked = value_pnl
            source = "buy_sell_value"
        else:
            booked = computed
            source = "buy_sell"
        return {
            "pnl": round(booked, 2),
            "realised": round(booked, 2),
            "unrealised": 0.0,
            "booked_pnl": round(booked, 2),
            "pnl_source": source,
            "partial": False,
            "closed_quantity": matched,
        }

    # Open: Kite positions().pnl often lags quotes. Prefer official MTM when
    # we just refreshed last_price from kite.quote.
    if mark_to_market and value_pnl is not None:
        open_pnl = value_pnl
        source = "quote_mtm"
    elif abs(kite_pnl) > 1e-9:
        open_pnl = kite_pnl
        source = "kite"
    elif value_pnl is not None:
        open_pnl = value_pnl
        source = "buy_sell_value"
    else:
        open_pnl = computed
        source = "buy_sell"

    partial = matched > 0
    booked = 0.0
    booked_source = source
    split, split_src = _booked_from_kite_fields()
    if split is not None:
        booked = split
        booked_source = split_src or "realised"
    elif matched > 0 and abs(computed) > 1e-9:
        booked = computed
        booked_source = "buy_sell"
    elif matched > 0 and (abs(sv) > 1e-9 or abs(bv) > 1e-9):
        booked = sv - bv
        booked_source = "buy_sell_value_closed"

    api_split = split_src == "kite_pnl_minus_unrealised" or (
        abs(kite_realised) > 1e-9 and abs(kite_unrealised) > 1e-9
        and abs(kite_unrealised - kite_pnl) > max(1.0, 0.02 * abs(kite_pnl or 1.0))
    )
    if mark_to_market:
        unrealised_out = open_pnl - booked
    elif api_split:
        unrealised_out = kite_unrealised
    else:
        unrealised_out = open_pnl - booked

    return {
        "pnl": round(open_pnl, 2),
        "realised": round(booked, 2),
        "unrealised": round(unrealised_out, 2),
        "booked_pnl": round(booked, 2),
        "pnl_source": booked_source if partial else source,
        "partial": partial,
        "closed_quantity": matched,
    }


def quote_last_price(quotes: Optional[dict], key: str) -> Optional[float]:
    if not isinstance(quotes, dict) or not key:
        return None
    q = quotes.get(key)
    if not isinstance(q, dict):
        q = quotes.get(str(key).upper())
    if not isinstance(q, dict):
        return None
    lp = q.get("last_price") or (q.get("ohlc") or {}).get("close")
    try:
        v = float(lp) if lp is not None else None
    except (TypeError, ValueError):
        return None
    if v is None or v != v or v <= 0:
        return None
    return v


def apply_live_ltp_to_open_rows(rows: list, quotes: Optional[dict]) -> None:
    """Mark open legs to kite.quote LTP. Mutates rows in place."""
    if not rows or not quotes:
        return
    for row in rows:
        if not isinstance(row, dict) or row.get("exited"):
            continue
        ex = row.get("exchange")
        ts = row.get("tradingsymbol")
        if not ex or not ts:
            continue
        lp = quote_last_price(quotes, f"{ex}:{ts}")
        if lp is None:
            continue
        try:
            qty = int(row.get("quantity") or 0)
        except (TypeError, ValueError):
            continue
        if qty == 0:
            row["last_price"] = lp
            continue
        bits = booked_pnl_from_kite_row(
            qty=qty,
            buy_qty=int(row.get("buy_quantity") or 0),
            sell_qty=int(row.get("sell_quantity") or 0),
            buy_price=float(row.get("buy_price") or 0),
            sell_price=float(row.get("sell_price") or 0),
            pnl=float(row.get("pnl") or 0),
            realised=float(row.get("realised") or 0),
            unrealised=float(row.get("unrealised") or 0),
            exited=False,
            buy_value=float(row.get("buy_value") or 0),
            sell_value=float(row.get("sell_value") or 0),
            last_price=lp,
            multiplier=float(row.get("multiplier") or 1) or 1.0,
            mark_to_market=True,
        )
        try:
            keep_booked = float(row["booked_pnl"]) if row.get("booked_pnl") is not None else bits["booked_pnl"]
        except (TypeError, ValueError):
            keep_booked = bits["booked_pnl"]
        row["last_price"] = lp
        row["pnl"] = bits["pnl"]
        row["booked_pnl"] = round(keep_booked, 2)
        row["realised"] = round(keep_booked, 2)
        row["unrealised"] = round(bits["pnl"] - keep_booked, 2)
        row["pnl_source"] = bits["pnl_source"]


def booked_today_from_row(row: Optional[dict]) -> float:
    """Realised money locked today: full exits + partial closes. Never open MTM."""
    if not isinstance(row, dict):
        return 0.0
    try:
        booked = float(row.get("booked_pnl") if row.get("booked_pnl") is not None else 0)
    except (TypeError, ValueError):
        booked = 0.0
    if booked != booked:
        booked = 0.0
    if row.get("exited"):
        if abs(booked) > 1e-9:
            return booked
        for key in ("realised", "pnl"):
            try:
                v = float(row.get(key) or 0)
            except (TypeError, ValueError):
                continue
            if v == v:
                return v
        return 0.0
    try:
        realised = float(row.get("realised") if row.get("realised") is not None else booked)
    except (TypeError, ValueError):
        realised = booked
    if realised != realised:
        realised = 0.0
    return realised
