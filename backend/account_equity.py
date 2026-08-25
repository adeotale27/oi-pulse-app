"""Total trading book vs leftover margin.

Kite ``equity.net`` is *available for new trades*. A 30L account with 20L in
positions and 10L free reports ~10L net. Percent-of-account stats always use
**available + utilised** (leftover + locked) so the base stays 30L.

Kite Connect has no deposit / withdrawal / ledger endpoint (Console only).
Day-over-day gaps vs the prior close are stored as *inferred* cashflow and
include overnight MTM — they are not a bank statement.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

CASHFLOW_SHOW_MIN = 1000.0  # hide tiny overnight noise in the UI


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


def segment_book(seg: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """One Kite margins segment (equity or commodity), nested or flattened."""
    empty = {
        "total": 0.0,
        "available": 0.0,
        "utilised": 0.0,
        "cash": 0.0,
        "opening": 0.0,
        "collateral": 0.0,
    }
    if not isinstance(seg, dict) or not seg:
        return dict(empty)
    avail = seg.get("available") if isinstance(seg.get("available"), dict) else {}
    util = seg.get("utilised") if isinstance(seg.get("utilised"), dict) else {}
    available = _first(
        seg.get("net"),
        seg.get("available_net"),
        avail.get("net") if isinstance(avail, dict) else None,
        seg.get("live_balance"),
        avail.get("live_balance") if isinstance(avail, dict) else None,
    )
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
    if available is None:
        available = cash
    # Leftover margin + margin locked in trades = full book. Never use net alone.
    total = float(available) + float(utilised)
    if total <= 0 and (cash or opening):
        total = (cash or opening) + utilised
    return {
        "total": round(total, 2),
        "available": round(float(available or 0.0), 2),
        "utilised": round(float(utilised), 2),
        "cash": round(float(cash), 2),
        "opening": round(float(opening), 2),
        "collateral": round(float(collateral), 2),
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
    )
    if not any(funds.get(k) is not None for k in keys):
        return None
    return {
        "net": funds.get("commodity_net"),
        "cash": funds.get("commodity_cash"),
        "live_balance": funds.get("commodity_live_balance"),
        "opening_balance": funds.get("commodity_opening_balance"),
        "collateral": funds.get("commodity_collateral"),
        "utilised_debits": funds.get("commodity_utilised_debits"),
    }


def total_trading_equity(funds: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Full trading book: equity + commodity. ``total`` is the % denominator."""
    funds = funds if isinstance(funds, dict) else {}
    nested_eq = funds.get("equity") if isinstance(funds.get("equity"), dict) else None
    eq = segment_book(nested_eq or funds)
    cm = segment_book(_commodity_slice(funds))
    total = round(eq["total"] + cm["total"], 2)
    available = round(eq["available"] + cm["available"], 2)
    utilised = round(eq["utilised"] + cm["utilised"], 2)
    return {
        "total": total,
        "available": available,
        "utilised": utilised,
        "equity_total": eq["total"],
        "commodity_total": cm["total"],
        "cash": eq["cash"],
        "opening": eq["opening"],
        "collateral": eq["collateral"],
    }


def booked_pct(booked: Any, base: Any) -> Optional[float]:
    b = _num(base)
    if b < 1:
        return None
    return round(100.0 * _num(booked) / b, 4)


def infer_cashflow(prev: Optional[Dict[str, Any]], today_base: Any) -> Optional[float]:
    """today open book minus previous close (or previous live total)."""
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
    """Stamp live totals onto a journal snapshot (base freeze happens in apply_snapshot)."""
    book = total_trading_equity(funds)
    if book["total"] > 0:
        doc["funds_total"] = book["total"]
        doc["funds_available_net"] = book["available"]
        if doc.get("funds_base") is None:
            doc["funds_base"] = book["total"]
        pct = booked_pct(
            doc.get("booked_pnl") if doc.get("booked_pnl") is not None else doc.get("pnl_exited"),
            doc.get("funds_base"),
        )
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


def apply_period_equity(stats: Dict[str, Any], days: List[Dict[str, Any]], booked: Any) -> Dict[str, Any]:
    base = first_funds_base(days)
    stats["funds_base"] = base
    stats["booked_pct"] = booked_pct(booked, base)
    net, dep, wd = cashflow_totals(days)
    stats["inferred_cashflow"] = net
    stats["inferred_deposited"] = dep
    stats["inferred_withdrawn"] = wd
    stats["cashflow_inferred"] = True
    stats["kite_has_withdrawals"] = False
    return stats
