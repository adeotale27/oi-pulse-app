"""Trade journal — daily P&L snapshots + seller notes (admin / Kite book)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, time as dtime, timezone
from typing import Any, Dict, List, Optional

from market_hours import is_trading_day, now_ist, IST

# Freeze after the last Positions auto-refresh (Index F&O 15:40 + 5 min catch-up).
EOD_LOCK_IST = dtime(15, 45)
HEATMAP_INDICES = ("NIFTY", "SENSEX", "BANKNIFTY")

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
    """NSE session day (weekday and not a holiday). Weekends never count."""
    if not iso or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(iso)):
        return False
    try:
        dt = datetime.strptime(str(iso), "%Y-%m-%d").replace(hour=12, tzinfo=IST)
    except ValueError:
        return False
    return is_trading_day(dt)


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
    """True when a Sat/Sun/holiday row was written by Positions poll, not the trader."""
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


def snapshot_from_positions(
    payload: Dict[str, Any],
    *,
    date: Optional[str] = None,
    charges: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a journal snapshot from /positions payload (does not include notes)."""
    rows = payload.get("positions") or []
    pnl = payload.get("pnl_today") or {}
    day = date or ist_ymd()
    legs = []
    wins = 0
    losses = 0
    for r in rows:
        pnl_v = _num(r.get("booked_pnl" if r.get("exited") else "pnl"))
        if r.get("exited"):
            if pnl_v > 0:
                wins += 1
            elif pnl_v < 0:
                losses += 1
        legs.append({
            "tradingsymbol": r.get("tradingsymbol") or r.get("display_name"),
            "index": r.get("index"),
            "side": r.get("side"),
            "strike": r.get("strike"),
            "quantity": r.get("quantity"),
            "exited": bool(r.get("exited")),
            "pnl": round(pnl_v, 2),
        })
    total = _num(pnl.get("total"))
    exited_pnl = _num(pnl.get("exited"))
    open_pnl = _num(pnl.get("open"))
    booked_legs = [leg for leg in legs if leg.get("exited")]
    index_pnl = _index_pnl_from_legs(legs)
    booked_index_pnl = _index_pnl_from_legs(booked_legs)
    doc = {
        "date": day,
        "pnl_total": round(total, 2),
        "pnl_open": round(open_pnl, 2),
        "pnl_exited": round(exited_pnl, 2),
        "booked_pnl": round(exited_pnl, 2),
        "open_count": int(payload.get("open_count") or sum(1 for r in rows if not r.get("exited"))),
        "exited_count": int(payload.get("exited_count") or sum(1 for r in rows if r.get("exited"))),
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
    return doc


def should_lock_eod(dt=None) -> bool:
    """True on an NSE trading day at/after 15:45 IST (last Positions auto-refresh)."""
    dt = dt or now_ist()
    if not is_trading_day(dt):
        return False
    return dt.time() >= EOD_LOCK_IST


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
) -> Optional[Dict[str, Any]]:
    """Fields to $set for P&L. None = leave stored P&L untouched (already locked / empty clobber)."""
    now = now or now_ist()
    existing = existing or {}
    if existing.get("eod_locked"):
        return None
    lock = bool(force_lock or should_lock_eod(now))
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
            return out
        if _is_traded(existing):
            return None
        return dict(snap)
    out = dict(snap)
    _carry_charges(out, existing)
    booked = round(_num(out.get("booked_pnl") if out.get("booked_pnl") is not None else out.get("pnl_exited")), 2)
    out["booked_pnl"] = booked
    if lock:
        out["eod_locked"] = True
        out["eod_locked_at"] = datetime.now(timezone.utc).isoformat()
        out["frozen_pnl"] = booked
    if out.get("charges_total") is not None:
        out["booked_after_charges"] = round(booked - _num(out.get("charges_total")), 2)
    return out


def year_heatmap(days: List[Dict[str, Any]], year: int) -> Dict[str, Any]:
    days = [d for d in days if include_on_journal_calendar(d)]
    by_index = {idx: [0.0] * 12 for idx in HEATMAP_INDICES}
    other = [0.0] * 12
    month_nets = [0.0] * 12
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
        ip = _booked_index_pnl(d)
        for idx, v in ip.items():
            key = str(idx).upper()
            if key in by_index:
                by_index[key][i] += _num(v)
            else:
                other[i] += _num(v)
    months = []
    for m in range(1, 13):
        i = m - 1
        months.append({
            "month": m,
            "net_pnl": round(month_nets[i], 2),
            "trading_days": month_days[i],
            "by_index": {idx: round(by_index[idx][i], 2) for idx in HEATMAP_INDICES},
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
    return {
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
    ip = d.get("booked_index_pnl")
    if isinstance(ip, dict) and ip:
        return ip
    legs = [leg for leg in (d.get("legs") or []) if isinstance(leg, dict) and leg.get("exited")]
    if legs:
        return _index_pnl_from_legs(legs)
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


def _index_pnl_from_legs(legs: List[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for leg in legs or []:
        idx = str(leg.get("index") or "OTHER").upper()
        out[idx] = round(out.get(idx, 0.0) + _num(leg.get("pnl")), 2)
    return out


def _is_traded(d: Dict[str, Any]) -> bool:
    """A journal day counts only when something was exited (booked), not open-only MTM."""
    if not d:
        return False
    if int(d.get("exited_count") or 0) > 0:
        return True
    if abs(_num(d.get("booked_pnl"))) > 0.009:
        return True
    if abs(_num(d.get("pnl_exited"))) > 0.009:
        return True
    legs = d.get("legs") or []
    if any(isinstance(x, dict) and x.get("exited") for x in legs):
        return True
    return False
