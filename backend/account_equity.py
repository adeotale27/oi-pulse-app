"""Wallet capital vs leftover margin vs SPAN.

Kite ``equity.net`` is leftover for *new* trades. ``utilised.debits`` is SPAN /
exposure on the leveraged book (hedges included). Neither is “money in the
account”.

Percent-of-account uses **wallet capital**: opening cash + collateral +
intraday pay-in (equity + commodity). Example: ₹15L in the wallet, ₹25L
notional via leverage, ₹1,500 booked after ₹200 charges → 0.10% of 15L.

Kite Connect has no deposit / withdrawal ledger. Day-over-day wallet gaps are
*inferred* cashflow and can include overnight MTM.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

CASHFLOW_SHOW_MIN = 1000.0
# Old V8.13 freeze was leftover + SPAN (~2× wallet). Replace that, not a real pay-in.
INFLATED_BASE_RATIO = 1.25


def _num(v: Any) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0
    except (TypeError, ValueError):
        return 0.0


def _first(*vals: Any) -> Optional[float]:
    for v in vals:
        if v is None:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if n == n:
            return n
    return None


def segment_wallet(seg: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Cash you actually hold in one Kite segment — never SPAN / utilised."""
    empty = {
        "wallet": 0.0,
        "available": 0.0,
        "utilised": 0.0,
        "cash": 0.0,
        "opening": 0.0,
        "collateral": 0.0,
        "payin": 0.0,
        "live": 0.0,
    }
    if not isinstance(seg, dict) or not seg:
        return dict(empty)
    avail = seg.get("available") if isinstance(seg.get("available"), dict) else {}
    util = seg.get("utilised") if isinstance(seg.get("utilised"), dict) else {}
    available = _first(
        seg.get("net"),
        seg.get("available_net"),
        avail.get("net") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    utilised = _first(
        seg.get("utilised_debits"),
        util.get("debits") if isinstance(util, dict) else None,
        0.0,
    ) or 0.0
    cash = _first(
        seg.get("cash"),
        avail.get("cash") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    opening = _first(
        seg.get("opening_balance"),
        avail.get("opening_balance") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    collateral = _first(
        seg.get("collateral"),
        avail.get("collateral") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    payin = _first(
        seg.get("intraday_payin"),
        avail.get("intraday_payin") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    live = _first(
        seg.get("live_balance"),
        avail.get("live_balance") if isinstance(avail, dict) else None,
        0.0,
    ) or 0.0
    # Opening is start-of-day cash (does not include today's P&L or SPAN).
    if opening > 0:
        wallet = opening + collateral + max(payin, 0.0)
    elif live > 0:
        wallet = live + collateral
    elif cash > 0:
        wallet = cash + collateral
    else:
        wallet = 0.0
    return {
        "wallet": round(wallet, 2),
        "available": round(float(available), 2),
        "utilised": round(float(utilised), 2),
        "cash": round(float(cash), 2),
        "opening": round(float(opening), 2),
        "collateral": round(float(collateral), 2),
        "payin": round(float(payin), 2),
        "live": round(float(live), 2),
    }


def _commodity_slice(funds: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(funds, dict):
        return None
    nested = funds.get("commodity")
    if isinstance(nested, dict) and nested:
        return nested
    keys = (
        "commodity_net",
        "commodity_cash",
        "commodity_utilised_debits",
        "commodity_opening_balance",
        "commodity_collateral",
        "commodity_live_balance",
        "commodity_intraday_payin",
    )
    if not any(funds.get(k) is not None for k in keys):
        return None
    return {
        "net": funds.get("commodity_net"),
        "cash": funds.get("commodity_cash"),
        "live_balance": funds.get("commodity_live_balance"),
        "opening_balance": funds.get("commodity_opening_balance"),
        "collateral": funds.get("commodity_collateral"),
        "intraday_payin": funds.get("commodity_intraday_payin"),
        "utilised_debits": funds.get("commodity_utilised_debits"),
    }


def total_trading_equity(funds: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Wallet capital: equity + commodity cash. ``total`` is the % denominator."""
    funds = funds if isinstance(funds, dict) else {}
    nested_eq = funds.get("equity") if isinstance(funds.get("equity"), dict) else None
    eq = segment_wallet(nested_eq or funds)
    cm = segment_wallet(_commodity_slice(funds))
    total = round(eq["wallet"] + cm["wallet"], 2)
    available = round(eq["available"] + cm["available"], 2)
    utilised = round(eq["utilised"] + cm["utilised"], 2)
    return {
        "total": total,
        "wallet": total,
        "available": available,
        "utilised": utilised,
        "equity_total": eq["wallet"],
        "commodity_total": cm["wallet"],
        "cash": eq["cash"],
        "opening": eq["opening"],
        "collateral": round(eq["collateral"] + cm["collateral"], 2),
        "payin": round(eq["payin"] + cm["payin"], 2),
    }


def booked_pct(made: Any, base: Any) -> Optional[float]:
    b = _num(base)
    if b < 1:
        return None
    return round(100.0 * _num(made) / b, 4)


def pnl_after_charges(doc: Optional[Dict[str, Any]], booked: Any = None) -> float:
    """What we made: booked P&L minus brokerage/taxes. Never gross booked."""
    d = doc if isinstance(doc, dict) else {}
    if d.get("booked_after_charges") is not None:
        return round(_num(d.get("booked_after_charges")), 2)
    if booked is None:
        if d.get("booked_pnl") is not None:
            booked = d.get("booked_pnl")
        else:
            booked = d.get("pnl_exited")
    made = _num(booked)
    if d.get("charges_total") is not None:
        return round(made - _num(d.get("charges_total")), 2)
    return round(made, 2)


def choose_funds_base(existing_base: Any, wallet: Any) -> Optional[float]:
    """Keep a sane freeze; replace leftover+SPAN (e.g. 72L vs 36L wallet)."""
    wallet_n = _num(wallet)
    old = _num(existing_base) if existing_base is not None else 0.0
    if wallet_n >= 1 and old >= 1 and old > wallet_n * INFLATED_BASE_RATIO:
        return round(wallet_n, 2)
    if old >= 1:
        return round(old, 2)
    if wallet_n >= 1:
        return round(wallet_n, 2)
    return None


def infer_cashflow(prev: Optional[Dict[str, Any]], today_base: Any) -> Optional[float]:
    """today wallet minus previous close (or previous wallet)."""
    if not prev:
        return None
    prior = _first(prev.get("funds_close"), prev.get("funds_total"), prev.get("funds_base"))
    base = _num(today_base)
    if prior is None or prior < 1 or base < 1:
        return None
    gap = round(base - float(prior), 2)
    if abs(gap) < 0.5:
        return 0.0
    return gap


def attach_live_funds(doc: Dict[str, Any], funds: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Stamp wallet capital onto a journal snapshot."""
    book = total_trading_equity(funds)
    if book["total"] > 0:
        doc["funds_total"] = book["total"]
        doc["funds_available_net"] = book["available"]
        doc["funds_utilised"] = book["utilised"]
        if doc.get("funds_base") is None:
            doc["funds_base"] = book["total"]
        pct = booked_pct(pnl_after_charges(doc), doc.get("funds_base"))
        if pct is not None:
            doc["booked_pct"] = pct
    return doc


def first_funds_base(days: List[Dict[str, Any]]) -> Optional[float]:
    ordered = sorted(
        (d for d in (days or []) if isinstance(d, dict)),
        key=lambda d: str(d.get("date") or ""),
    )
    for d in ordered:
        b = _num(d.get("funds_base"))
        if b >= 1:
            return round(b, 2)
    return None


def cashflow_totals(days: List[Dict[str, Any]]) -> Tuple[float, float, float]:
    """(net, deposits, withdrawals) from inferred_cashflow. Withdrawals are positive rupees out."""
    net = 0.0
    deposited = 0.0
    withdrawn = 0.0
    for d in days or []:
        if not isinstance(d, dict) or d.get("inferred_cashflow") is None:
            continue
        v = _num(d.get("inferred_cashflow"))
        net += v
        if v > 0:
            deposited += v
        elif v < 0:
            withdrawn += -v
    return round(net, 2), round(deposited, 2), round(withdrawn, 2)


def apply_period_equity(stats: Dict[str, Any], days: List[Dict[str, Any]], made: Any) -> Dict[str, Any]:
    base = first_funds_base(days)
    stats["funds_base"] = base
    stats["booked_pct"] = booked_pct(made, base)
    net, dep, wd = cashflow_totals(days)
    stats["inferred_cashflow"] = net
    stats["inferred_deposited"] = dep
    stats["inferred_withdrawn"] = wd
    stats["cashflow_inferred"] = True
    stats["kite_has_withdrawals"] = False
    return stats
