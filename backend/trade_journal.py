"""Trade journal — daily P&L snapshots + seller notes (admin / Kite book)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, time as dtime, timezone
from typing import Any, Dict, List, Optional

from market_hours import (
    is_trading_day,
    is_journal_session_day,
    now_ist,
    IST,
    eod_lock_time,
)
from universe import DESK_IDS, HEATMAP_IDS, match_symbol_prefix
from account_equity import (
    apply_period_equity,
    attach_live_funds,
    booked_pct as equity_booked_pct,
    choose_funds_base,
    first_funds_base,
    pnl_after_charges,
)

# Freeze after the last Positions auto-refresh (Index F&O close + 5 min catch-up).
EOD_LOCK_IST = dtime(15, 45)
# Fallback if special-session close is missing (evening Muhurat).
SPECIAL_SESSION_LOCK_IST = dtime(20, 0)
HEATMAP_INDICES = HEATMAP_IDS

MAX_NOTE_CHARS = 8000
MAX_SCREENSHOTS = 4
MAX_SCREENSHOT_BYTES = 450_000
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
DEFAULT_TAGS = [
    "Held",
    "Rolled",
    "Cut",
    "Too close",
    "Expiry",
    "NIFTY",
    "SENSEX",
    "BANKNIFTY",
    "Theta",
    "Hedge",
    "Plan followed",
    "Plan broken",
]


def ist_ymd(dt=None) -> str:
    d = dt or now_ist()
    return d.strftime("%Y-%m-%d")


def iso_is_trading_day(iso: Optional[str]) -> bool:
    """Journal session day: weekday with a cash/F&O print, including Muhurat."""
    if not iso or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(iso)):
        return False
    try:
        dt = datetime.strptime(str(iso), "%Y-%m-%d").replace(hour=12, tzinfo=IST)
    except ValueError:
        return False
    return is_journal_session_day(dt)


def has_user_journal_content(doc: Optional[Dict[str, Any]]) -> bool:
    if not doc:
        return False
    for key in ("went_well", "went_wrong", "notes"):
        if str(doc.get(key) or "").strip():
            return True
    if doc.get("tags"):
        return True
    if doc.get("rating") is not None:
        return True
    if doc.get("followed_plan") is not None:
        return True
    shots = doc.get("screenshots") or []
    if any(isinstance(s, dict) and s.get("id") for s in shots):
        return True
    return False


def is_closed_session_auto_snapshot(doc: Optional[Dict[str, Any]]) -> bool:
    """True when a Sat/Sun/full-holiday row was written by Positions poll, not the trader.

    Muhurat auto-snapshots are kept (that day is a journal session).
    """
    if not doc:
        return False
    iso = doc.get("date")
    if iso_is_trading_day(iso):
        return False
    return not has_user_journal_content(doc)


def include_on_journal_calendar(doc: Optional[Dict[str, Any]]) -> bool:
    if not doc:
        return False
    if iso_is_trading_day(doc.get("date")):
        return True
    return has_user_journal_content(doc)


def month_bounds(year: int, month: int) -> tuple[str, str]:
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    return start, end


def charges_usable(charges: Optional[Dict[str, Any]]) -> bool:
    """True when Kite returned real brokerage / charges (not an empty placeholder)."""
    if not charges:
        return False
    if _num(charges.get("charges_total") if charges.get("charges_total") is not None else charges.get("total")) > 0:
        return True
    if _num(charges.get("brokerage")) > 0:
        return True
    return False


def apply_charges(doc: Dict[str, Any], charges: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Attach Zerodha brokerage / total charges (our DB only — never sent to Kite)."""
    charges = charges or {}
    brokerage = _num(charges.get("brokerage"))
    total = _num(charges.get("charges_total") if charges.get("charges_total") is not None else charges.get("total"))
    if total <= 0 and brokerage:
        total = brokerage
    booked = _num(doc.get("booked_pnl") if doc.get("booked_pnl") is not None else doc.get("pnl_exited"))
    doc["brokerage"] = round(brokerage, 2)
    doc["charges_total"] = round(total, 2)
    doc["charges_source"] = charges.get("charges_source") or charges.get("source") or "none"
    doc["booked_after_charges"] = round(booked - total, 2)
    return doc


def _resolve_trading_date(existing: Optional[Dict[str, Any]], snap: Optional[Dict[str, Any]]) -> str:
    if not existing and not snap:
        return ist_ymd()
    value = (existing or {}).get("trading_date") or (existing or {}).get("date") or (snap or {}).get("trading_date") or (snap or {}).get("date") or ist_ymd()
    return str(value)[:10]


def snapshot_from_positions(
    payload: Dict[str, Any],
    *,
    date: Optional[str] = None,
    charges: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a journal snapshot from /positions payload (does not include notes).

    Booked P&L is realised money: fully exited legs plus partial closes that
    still have open quantity. Open MTM is stored separately and is not the calendar.
    """
    from kite_positions import booked_today_from_row

    rows = payload.get("positions") or []
    pnl = payload.get("pnl_today") or {}
    day = date or ist_ymd()
    legs = []
    wins = 0
    losses = 0
    partial_n = 0
    for r in rows:
        booked_v = booked_today_from_row(r)
        partial = bool(r.get("partial")) or (
            not r.get("exited") and abs(booked_v) > 1e-9
        )
        if r.get("exited") or partial:
            if booked_v > 0:
                wins += 1
            elif booked_v < 0:
                losses += 1
        if partial and not r.get("exited"):
            partial_n += 1
        pnl_v = booked_v if (r.get("exited") or partial) else _num(r.get("pnl"))
        leg = {
            "tradingsymbol": r.get("tradingsymbol") or r.get("display_name"),
            "index": _leg_index_label(r),
            "side": r.get("side"),
            "strike": r.get("strike"),
            "quantity": r.get("quantity"),
            "exited": bool(r.get("exited")),
            "partial": bool(partial and not r.get("exited")),
            "closed_quantity": r.get("closed_quantity"),
            "realised": round(booked_v, 2),
            "pnl": round(pnl_v, 2),
        }
        for k in ("entry_time", "exit_time", "entry_source", "exit_source", "carried", "token_gap", "partials"):
            if r.get(k) is not None:
                leg[k] = r.get(k)
        legs.append(leg)
    total = _num(pnl.get("total"))
    exited_only = _num(pnl.get("exited"))
    open_pnl = _num(pnl.get("open"))
    if pnl.get("booked") is not None:
        booked = _num(pnl.get("booked"))
    else:
        booked = round(sum(booked_today_from_row(r) for r in rows), 2)
    booked_legs = [
        leg for leg in legs
        if leg.get("exited") or leg.get("partial") or abs(_num(leg.get("realised"))) > 1e-9
    ]
    booked_index_pnl = _index_pnl_from_legs(booked_legs, pnl_key="realised")
    index_pnl = _index_pnl_from_legs(legs)
    full_exits = sum(1 for r in rows if r.get("exited"))
    doc = {
        "date": day,
        "trading_date": day,
        "pnl_total": round(total, 2),
        "pnl_open": round(open_pnl, 2),
        "pnl_exited": round(booked, 2),
        "booked_pnl": round(booked, 2),
        "exited_only_pnl": round(exited_only, 2),
        "open_count": int(payload.get("open_count") or sum(1 for r in rows if not r.get("exited"))),
        "exited_count": int(payload.get("exited_count") or full_exits),
        "partial_count": int(payload.get("partial_count") or partial_n),
        "trade_count": len(rows),
        "win_trades": wins,
        "loss_trades": losses,
        "legs": legs,
        "index_pnl": index_pnl,
        "booked_index_pnl": booked_index_pnl,
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
    }
    if charges_usable(charges):
        apply_charges(doc, charges)
    attach_live_funds(doc, payload.get("funds"))
    return doc


def should_lock_eod(dt=None, *, live_session: bool = False, enabled_indices=None) -> bool:
    """True when the journal should freeze booked P&L for this IST clock.

    Regular NSE-only desks lock at 15:45. If MCX names are enabled, lock after
    that commodity's close + 5 min so evening GOLD/CRUDE prints are not dropped.
    Muhurat locks at that session's close + 5 min. Unlisted live sessions lock at 20:00.
    """
    dt = dt or now_ist()
    if is_trading_day(dt):
        return dt.time() >= eod_lock_time(dt, enabled_indices=enabled_indices)
    if live_session:
        return dt.time() >= SPECIAL_SESSION_LOCK_IST
    return False


def snapshot_is_empty(snap: Optional[Dict[str, Any]]) -> bool:
    if not snap:
        return True
    if int(snap.get("trade_count") or 0) > 0:
        return False
    if int(snap.get("open_count") or 0) + int(snap.get("exited_count") or 0) > 0:
        return False
    if snap.get("legs"):
        return False
    return abs(_num(snap.get("pnl_total"))) < 0.01 and abs(_num(snap.get("pnl_exited"))) < 0.01


def day_pnl(d: Optional[Dict[str, Any]]) -> float:
    """Calendar / heatmap / stats: exited (booked) P&L only — never live open MTM."""
    if not d:
        return 0.0
    if d.get("booked_pnl") is not None:
        return _num(d.get("booked_pnl"))
    if d.get("pnl_exited") is not None:
        return _num(d.get("pnl_exited"))
    exited_legs = [x for x in (d.get("legs") or []) if isinstance(x, dict) and x.get("exited")]
    if exited_legs:
        return round(sum(_num(x.get("pnl")) for x in exited_legs), 2)
    if d.get("eod_locked") and d.get("frozen_pnl") is not None:
        return _num(d.get("frozen_pnl"))
    return 0.0


def apply_snapshot(
    existing: Optional[Dict[str, Any]],
    snap: Dict[str, Any],
    *,
    force_lock: bool = False,
    now=None,
    live_session: bool = False,
    enabled_indices=None,
) -> Optional[Dict[str, Any]]:
    """Fields to $set for P&L. None = leave stored P&L untouched (empty clobber).

    After EOD lock, a non-empty same-day snap may still revise booked P&L (expiry
    leftover hedges booked after 15:45). Notes / tags / screenshots are not in snap.
    """
    now = now or now_ist()
    existing = existing or {}
    keep_day = _resolve_trading_date(existing, snap)
    snap_day = str(snap.get("date") or "")
    if existing.get("eod_locked"):
        if snapshot_is_empty(snap):
            return None
        exist_day = str(existing.get("trading_date") or existing.get("date") or "")
        if exist_day and snap_day and exist_day != snap_day:
            out = dict(snap)
            out["date"] = exist_day
            out["trading_date"] = exist_day
            _carry_charges(out, existing)
            booked = round(_num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited")), 2)
            out["booked_pnl"] = booked
            out["eod_locked"] = True
            out["eod_locked_at"] = existing.get("eod_locked_at") or datetime.now(timezone.utc).isoformat()
            out["frozen_pnl"] = booked
            if out.get("charges_total") is not None:
                out["booked_after_charges"] = round(booked - _num(out.get("charges_total")), 2)
            _carry_funds(out, existing, lock=True)
            return out
        out = dict(snap)
        out["date"] = keep_day
        out["trading_date"] = keep_day
        _carry_charges(out, existing)
        booked = round(_num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited")), 2)
        out["booked_pnl"] = booked
        out["eod_locked"] = True
        out["eod_locked_at"] = existing.get("eod_locked_at") or datetime.now(timezone.utc).isoformat()
        out["frozen_pnl"] = booked
        if out.get("charges_total") is not None:
            out["booked_after_charges"] = round(booked - _num(out.get("charges_total")), 2)
        _carry_funds(out, existing, lock=True)
        return out
    lock = bool(force_lock or should_lock_eod(now, live_session=live_session, enabled_indices=enabled_indices))
    if snapshot_is_empty(snap):
        if _is_traded(existing) and lock:
            booked = existing.get("booked_pnl")
            if booked is None:
                booked = existing.get("pnl_exited")
            if booked is None:
                booked = existing.get("frozen_pnl")
            if booked is None:
                booked = existing.get("pnl_total")
            frozen = existing.get("frozen_pnl")
            if frozen is None:
                frozen = booked
            out = {
                "eod_locked": True,
                "eod_locked_at": datetime.now(timezone.utc).isoformat(),
                "frozen_pnl": round(_num(frozen), 2),
                "booked_pnl": round(_num(booked), 2),
            }
            _carry_charges(out, existing)
            _carry_funds(out, existing, lock=True)
            return out
        if _is_traded(existing):
            return None
        empty_out = dict(snap)
        empty_out["date"] = keep_day
        empty_out["trading_date"] = keep_day
        _carry_funds(empty_out, existing, lock=False)
        return empty_out
    out = dict(snap)
    out["date"] = keep_day
    out["trading_date"] = keep_day
    _carry_charges(out, existing)
    booked = round(_num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited")), 2)
    out["booked_pnl"] = booked
    if lock:
        out["eod_locked"] = True
        out["eod_locked_at"] = datetime.now(timezone.utc).isoformat()
        out["frozen_pnl"] = booked
    if out.get("charges_total") is not None:
        out["booked_after_charges"] = round(booked - _num(out.get("charges_total")), 2)
    _carry_funds(out, existing, lock=lock)
    return out


def year_heatmap(days: List[Dict[str, Any]], year: int) -> Dict[str, Any]:
    days = [d for d in days if include_on_journal_calendar(d)]
    by_index = {idx: [0.0] * 12 for idx in HEATMAP_INDICES}
    other = [0.0] * 12
    month_nets = [0.0] * 12
    month_made = [0.0] * 12
    month_days = [0] * 12
    for d in days:
        date_s = str(d.get("date") or "")
        if len(date_s) < 7:
            continue
        try:
            y = int(date_s[:4])
            mo = int(date_s[5:7])
        except (TypeError, ValueError):
            continue
        if y != year or mo < 1 or mo > 12:
            continue
        i = mo - 1
        pnl = day_pnl(d)
        if _is_traded(d):
            month_nets[i] += pnl
            month_days[i] += 1
            month_made[i] += pnl_after_charges(d)
        ip = _booked_index_pnl(d)
        attributed = 0.0
        for idx, v in ip.items():
            key = str(idx).upper()
            amt = _num(v)
            attributed += amt
            if key in by_index:
                by_index[key][i] += amt
            else:
                other[i] += amt
        gap = pnl - attributed
        if _is_traded(d) and abs(gap) > 0.5:
            other[i] += gap
    months = []
    for m in range(1, 13):
        i = m - 1
        month_days_docs = [
            d for d in days
            if str(d.get("date") or "")[5:7] == f"{m:02d}" and str(d.get("date") or "")[:4] == str(year)
        ]
        m_base = first_funds_base(month_days_docs)
        months.append({
            "month": m,
            "net_pnl": round(month_nets[i], 2),
            "trading_days": month_days[i],
            "by_index": {idx: round(by_index[idx][i], 2) for idx in HEATMAP_INDICES},
            "other": round(other[i], 2),
            "funds_base": m_base,
            "booked_pct": equity_booked_pct(month_made[i], m_base),
            "made_pnl": round(month_made[i], 2),
        })
    return {
        "year": year,
        "indices": list(HEATMAP_INDICES),
        "by_index": {idx: [round(v, 2) for v in by_index[idx]] for idx in HEATMAP_INDICES},
        "other": [round(v, 2) for v in other],
        "month_nets": [round(v, 2) for v in month_nets],
        "months": months,
    }


def month_stats(days: List[Dict[str, Any]]) -> Dict[str, Any]:
    traded = [d for d in days if _is_traded(d) and iso_is_trading_day(d.get("date"))]
    pnls = [day_pnl(d) for d in traded]
    green = [p for p in pnls if p > 0]
    red = [p for p in pnls if p < 0]
    net = round(sum(pnls), 2) if pnls else 0.0
    win_days = len(green)
    lose_days = len(red)
    profit_factor = None
    if red:
        profit_factor = round(sum(green) / abs(sum(red)), 2) if sum(red) else None
    elif green:
        profit_factor = 3.0
    best = max(traded, key=day_pnl) if traded else None
    worst = min(traded, key=day_pnl) if traded else None
    win_rate = round(100.0 * win_days / len(traded), 1) if traded else 0.0
    avg_win = round(sum(green) / len(green), 2) if green else 0.0
    avg_loss = round(sum(red) / len(red), 2) if red else 0.0
    tw = sum(int(d.get("win_trades") or 0) for d in traded)
    tl = sum(int(d.get("loss_trades") or 0) for d in traded)
    trade_n = tw + tl
    trade_win_rate = round(100.0 * tw / trade_n, 1) if trade_n else 0.0
    avg_wl = round(abs(avg_win) / abs(avg_loss), 2) if avg_loss else (None if not avg_win else 3.0)
    # Seller desk score 0–100: win-day rate, profit factor, green-day consistency.
    pf_n = min(3.0, profit_factor or 0.0) / 3.0
    wr_n = (win_days / len(traded)) if traded else 0.0
    if len(pnls) >= 2:
        mean = sum(abs(p) for p in pnls) / len(pnls) or 1.0
        var = sum((p - (sum(pnls) / len(pnls))) ** 2 for p in pnls) / len(pnls)
        std = var ** 0.5
        cons = max(0.0, 1.0 - min(1.5, std / mean) / 1.5)
    else:
        cons = 0.5 if traded else 0.0
    score = round(100 * (wr_n * 0.4 + pf_n * 0.35 + cons * 0.25), 1)
    out = {
        "net_pnl": net,
        "trading_days": len(traded),
        "win_days": win_days,
        "lose_days": lose_days,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "best_day": {"date": best.get("date"), "pnl": day_pnl(best)} if best else None,
        "worst_day": {"date": worst.get("date"), "pnl": day_pnl(worst)} if worst else None,
        "desk_score": min(100.0, score),
        "trade_wins": tw,
        "trade_losses": tl,
        "trade_win_rate": trade_win_rate,
        "avg_win_loss_ratio": avg_wl,
    }
    apply_period_equity(out, days, round(sum(pnl_after_charges(d) for d in traded), 2))
    return out


def _booked_legs(d: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        leg for leg in (d.get("legs") or [])
        if isinstance(leg, dict) and (
            leg.get("exited") or leg.get("partial") or abs(_num(leg.get("realised"))) > 0.009
        )
    ]


def _leg_matches_index(leg: Dict[str, Any], index: str) -> bool:
    want = str(index or "").strip().upper()
    if not want or want in ("ALL", "ALL_INDICES", "*"):
        return True
    if want == "OTHER":
        return _heatmap_index(leg) == "OTHER"
    return _leg_index_label(leg) == want or _heatmap_index(leg) == want


def period_stats(
    days: List[Dict[str, Any]],
    *,
    start: str,
    end: str,
    index: Optional[str] = None,
) -> Dict[str, Any]:
    """From–to booked profit, Kite charges, and trade win % (optional index filter)."""
    want = str(index or "").strip().upper()
    if want in ("", "ALL", "ALL_INDICES", "*"):
        want = None
    rows = []
    for d in days or []:
        date_s = str(d.get("date") or "")
        if len(date_s) < 10 or date_s < start or date_s > end:
            continue
        if not include_on_journal_calendar(d):
            continue
        rows.append(d)

    booked = 0.0
    charges = 0.0
    brokerage = 0.0
    charge_days = 0
    wins = 0
    losses = 0
    traded_days = 0
    win_days = 0
    lose_days = 0
    by_index: Dict[str, float] = {}

    for d in rows:
        legs = _booked_legs(d)
        if want:
            legs = [leg for leg in legs if _leg_matches_index(leg, want)]
            day_booked = round(sum(
                _num(leg.get("realised") if leg.get("realised") is not None else leg.get("pnl"))
                for leg in legs
            ), 2)
            if not legs:
                ip = _booked_index_pnl(d)
                day_booked = round(_num(ip.get(want if want != "OTHER" else "OTHER")), 2)
        else:
            day_booked = round(day_pnl(d), 2)
        if abs(day_booked) > 0.009 or legs:
            traded_days += 1
            if day_booked > 0:
                win_days += 1
            elif day_booked < 0:
                lose_days += 1
        booked += day_booked
        for leg in legs:
            rv = _num(leg.get("realised") if leg.get("realised") is not None else leg.get("pnl"))
            if rv > 0:
                wins += 1
            elif rv < 0:
                losses += 1
            key = _leg_index_label(leg)
            by_index[key] = round(by_index.get(key, 0.0) + rv, 2)
        if d.get("charges_total") is not None:
            charges += _num(d.get("charges_total"))
            charge_days += 1
        if d.get("brokerage") is not None:
            brokerage += _num(d.get("brokerage"))

    trade_n = wins + losses
    win_rate = round(100.0 * wins / trade_n, 2) if trade_n else 0.0
    day_win_rate = round(100.0 * win_days / traded_days, 2) if traded_days else 0.0
    booked = round(booked, 2)
    charges = round(charges, 2)
    brokerage = round(brokerage, 2)
    out = {
        "from": start,
        "to": end,
        "index": want or "ALL",
        "booked_pnl": booked,
        "charges_total": charges,
        "brokerage": brokerage,
        "booked_after_charges": round(booked - charges, 2) if not want else None,
        "charges_are_all_indices": bool(want),
        "charge_days": charge_days,
        "win_trades": wins,
        "loss_trades": losses,
        "win_rate": win_rate,
        "win_days": win_days,
        "lose_days": lose_days,
        "day_win_rate": day_win_rate,
        "trading_days": traded_days,
        "by_index": by_index,
    }
    apply_period_equity(
        out,
        rows,
        out["booked_after_charges"] if out["booked_after_charges"] is not None else booked,
    )
    return out


def public_day(doc: Optional[Dict[str, Any]], *, include_images: bool = False) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    # Calendar / day hero: booked only (public_day must not feed display_pnl back into day_pnl).
    view = {k: v for k, v in out.items() if k != "display_pnl"}
    out["display_pnl"] = day_pnl(view)
    booked = _num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited"))
    charges = _num(out.get("charges_total"))
    if out.get("booked_after_charges") is None and (out.get("charges_total") is not None or out.get("brokerage") is not None):
        out["booked_after_charges"] = round(booked - charges, 2)
    pct = equity_booked_pct(pnl_after_charges(out), out.get("funds_base"))
    if pct is not None:
        out["booked_pct"] = pct
    shots = out.get("screenshots") or []
    if include_images:
        out["screenshots"] = [
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "mime": s.get("mime"),
                "data": s.get("data"),
            }
            for s in shots
            if s.get("id")
        ]
    else:
        out["screenshots"] = [
            {"id": s.get("id"), "name": s.get("name"), "mime": s.get("mime")}
            for s in shots
            if s.get("id")
        ]
        out["screenshot_count"] = len(out["screenshots"])
    return out


def sanitize_journal_fields(body: Dict[str, Any]) -> Dict[str, Any]:
    def clip(v) -> str:
        s = "" if v is None else str(v)
        return s.strip()[:MAX_NOTE_CHARS]

    tags = body.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    clean_tags = []
    for t in tags[:12]:
        s = re.sub(r"[^\w\s+\-./]", "", str(t or "")).strip()[:24]
        if s and s not in clean_tags:
            clean_tags.append(s)
    rating = body.get("rating")
    try:
        rating_n = int(rating) if rating is not None and rating != "" else None
    except (TypeError, ValueError):
        rating_n = None
    if rating_n is not None:
        rating_n = max(1, min(5, rating_n))
    followed = body.get("followed_plan")
    if followed not in (True, False, None):
        followed = None
    return {
        "went_well": clip(body.get("went_well")),
        "went_wrong": clip(body.get("went_wrong")),
        "notes": clip(body.get("notes")),
        "tags": clean_tags,
        "rating": rating_n,
        "followed_plan": followed,
        "journal_updated_at": datetime.now(timezone.utc).isoformat(),
    }


def decode_screenshot(payload: Dict[str, Any]) -> Dict[str, Any]:
    mime = str(payload.get("mime") or "image/jpeg").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise ValueError("Unsupported image type")
    name = re.sub(r"[^\w.\- ]", "", str(payload.get("name") or "shot"))[:80] or "shot"
    data = str(payload.get("data") or "")
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    data = re.sub(r"\s+", "", data)
    if not data:
        raise ValueError("Empty image")
    import base64
    raw = base64.b64decode(data, validate=False)
    if len(raw) > MAX_SCREENSHOT_BYTES:
        raise ValueError("Image too large (max ~450KB)")
    if len(raw) < 32:
        raise ValueError("Image too small")
    if not _image_magic_ok(raw, mime):
        raise ValueError("Image data does not match type")
    return {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "mime": mime,
        "data": data,
    }


def _image_magic_ok(raw: bytes, mime: str) -> bool:
    if mime == "image/jpeg":
        return raw[:3] == b"\xff\xd8\xff"
    if mime == "image/png":
        return raw.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/gif":
        return raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a")
    if mime == "image/webp":
        return len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    return False


def _booked_index_pnl(d: Dict[str, Any]) -> Dict[str, float]:
    """Per-index booked P&L. Never use live index_pnl (includes open MTM)."""
    legs = [
        leg for leg in (d.get("legs") or [])
        if isinstance(leg, dict) and (
            leg.get("exited") or leg.get("partial") or abs(_num(leg.get("realised"))) > 0.009
        )
    ]
    if legs:
        return _index_pnl_from_legs(legs, pnl_key="realised")
    ip = d.get("booked_index_pnl")
    if isinstance(ip, dict) and ip:
        return _fold_heatmap_pnl({str(k).upper(): _num(v) for k, v in ip.items()})
    return {}


def _carry_charges(out: Dict[str, Any], existing: Dict[str, Any]) -> None:
    for k in ("brokerage", "charges_total", "charges_source"):
        if out.get(k) is None and existing.get(k) is not None:
            out[k] = existing[k]
    if out.get("charges_total") is not None:
        booked = _num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited"))
        out["booked_after_charges"] = round(booked - _num(out.get("charges_total")), 2)


def _num(v) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0
    except (TypeError, ValueError):
        return 0.0


def _carry_funds(out: Dict[str, Any], existing: Dict[str, Any], *, lock: bool = False) -> None:
    """Keep a sane wallet freeze; never keep leftover+SPAN as the base."""
    existing = existing or {}
    wallet = out.get("funds_base")
    if wallet is None:
        wallet = out.get("funds_total")
    if wallet is None:
        wallet = existing.get("funds_total")
    chosen = choose_funds_base(existing.get("funds_base"), wallet)
    if chosen is not None:
        out["funds_base"] = chosen
    if out.get("funds_total") is None and existing.get("funds_total") is not None:
        out["funds_total"] = existing["funds_total"]
    if out.get("funds_available_net") is None and existing.get("funds_available_net") is not None:
        out["funds_available_net"] = existing["funds_available_net"]
    if existing.get("inferred_cashflow") is not None and out.get("inferred_cashflow") is None:
        old_b = _num(existing.get("funds_base"))
        if chosen is None or old_b < 1 or abs(old_b - chosen) <= 1:
            out["inferred_cashflow"] = existing["inferred_cashflow"]
    if lock:
        close = out.get("funds_total")
        if close is None:
            close = existing.get("funds_close")
        if close is None:
            close = existing.get("funds_total")
        if close is not None:
            out["funds_close"] = close
    elif existing.get("funds_close") is not None:
        out["funds_close"] = existing["funds_close"]
    pct = equity_booked_pct(pnl_after_charges(out), out.get("funds_base"))
    if pct is not None:
        out["booked_pct"] = pct


def _leg_index_label(leg: Dict[str, Any]) -> str:
    """Keep the Kite/parsed name on the journal leg (GOLD, FINNIFTY, RELIANCE, …)."""
    raw = str(leg.get("index") or "").strip().upper()
    if raw and raw not in ("OTHER", "UNKNOWN"):
        return raw
    ts = str(leg.get("tradingsymbol") or leg.get("display_name") or "").strip()
    prefix = match_symbol_prefix(ts)
    if prefix:
        return prefix
    return raw or "OTHER"


def _heatmap_index(leg: Dict[str, Any]) -> str:
    """Named heatmap rows (desk + MCX majors); FINNIFTY/stocks stay OTHER."""
    raw = str(leg.get("index") or "").strip().upper()
    if raw in HEATMAP_INDICES:
        return raw
    ts = str(leg.get("tradingsymbol") or leg.get("display_name") or "").strip()
    prefix = match_symbol_prefix(ts)
    if prefix in HEATMAP_INDICES:
        return prefix
    try:
        from fno_symbol import parse_fno_option_symbol
        parsed = parse_fno_option_symbol(ts)
    except Exception:
        parsed = None
    if parsed:
        idx = str(parsed.get("index") or "").upper()
        if idx in HEATMAP_INDICES:
            return idx
    compact = ts.upper().replace(" ", "")
    for name in sorted(HEATMAP_INDICES, key=len, reverse=True):
        if compact.startswith(name):
            return name
    return "OTHER"


def _fold_heatmap_pnl(ip: Dict[str, float]) -> Dict[str, float]:
    """Named heatmap buckets plus OTHER for FINNIFTY, stocks, minis, etc."""
    out = {k: 0.0 for k in HEATMAP_INDICES}
    other = 0.0
    for k, v in (ip or {}).items():
        key = str(k).upper()
        amt = _num(v)
        if key in HEATMAP_INDICES:
            out[key] = round(out[key] + amt, 2)
        else:
            other += amt
    out["OTHER"] = round(other, 2)
    return out


def _index_pnl_from_legs(legs: List[Dict[str, Any]], *, pnl_key: str = "pnl") -> Dict[str, float]:
    raw: Dict[str, float] = {}
    for leg in legs or []:
        idx = _heatmap_index(leg)
        val = _num(leg.get(pnl_key))
        if pnl_key == "realised" and abs(val) < 1e-9:
            val = _num(leg.get("pnl"))
        raw[idx] = round(raw.get(idx, 0.0) + val, 2)
    return _fold_heatmap_pnl(raw)


def _is_traded(d: Dict[str, Any]) -> bool:
    """A journal day counts when money was booked (full exit or partial close), not open-only MTM."""
    if not d:
        return False
    if int(d.get("exited_count") or 0) > 0:
        return True
    if int(d.get("partial_count") or 0) > 0:
        return True
    if abs(_num(d.get("booked_pnl"))) > 0.009:
        return True
    if abs(_num(d.get("pnl_exited"))) > 0.009:
        return True
    legs = d.get("legs") or []
    if any(
        isinstance(x, dict) and (x.get("exited") or x.get("partial") or abs(_num(x.get("realised"))) > 0.009)
        for x in legs
    ):
        return True
    return False
