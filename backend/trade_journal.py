"""Trade journal — daily P&L snapshots + seller notes (admin / Kite book)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from market_hours import now_ist

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


def month_bounds(year: int, month: int) -> tuple[str, str]:
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    return start, end


def snapshot_from_positions(payload: Dict[str, Any], *, date: Optional[str] = None) -> Dict[str, Any]:
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
    return {
        "date": day,
        "pnl_total": round(total, 2),
        "pnl_open": round(open_pnl, 2),
        "pnl_exited": round(exited_pnl, 2),
        "open_count": int(payload.get("open_count") or sum(1 for r in rows if not r.get("exited"))),
        "exited_count": int(payload.get("exited_count") or sum(1 for r in rows if r.get("exited"))),
        "trade_count": len(rows),
        "win_trades": wins,
        "loss_trades": losses,
        "legs": legs,
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
    }


def month_stats(days: List[Dict[str, Any]]) -> Dict[str, Any]:
    traded = [d for d in days if _is_traded(d)]
    pnls = [_num(d.get("pnl_total")) for d in traded]
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
    best = max(traded, key=lambda d: _num(d.get("pnl_total"))) if traded else None
    worst = min(traded, key=lambda d: _num(d.get("pnl_total"))) if traded else None
    win_rate = round(100.0 * win_days / len(traded), 1) if traded else 0.0
    avg_win = round(sum(green) / len(green), 2) if green else 0.0
    avg_loss = round(sum(red) / len(red), 2) if red else 0.0
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
        "best_day": {"date": best.get("date"), "pnl": _num(best.get("pnl_total"))} if best else None,
        "worst_day": {"date": worst.get("date"), "pnl": _num(worst.get("pnl_total"))} if worst else None,
        "desk_score": min(100.0, score),
    }


def public_day(doc: Optional[Dict[str, Any]], *, include_images: bool = False) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
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
    raw = base64.b64decode(data)
    if len(raw) > MAX_SCREENSHOT_BYTES:
        raise ValueError("Image too large (max ~450KB)")
    if len(raw) < 32:
        raise ValueError("Image too small")
    return {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "mime": mime,
        "data": data,
    }


def _num(v) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0
    except (TypeError, ValueError):
        return 0.0


def _is_traded(d: Dict[str, Any]) -> bool:
    if int(d.get("trade_count") or 0) > 0:
        return True
    if int(d.get("open_count") or 0) + int(d.get("exited_count") or 0) > 0:
        return True
    return abs(_num(d.get("pnl_total"))) > 0.009
