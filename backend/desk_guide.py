"""Optional LLM desk guide for carry / OI vs book.

The live OI poll and alert engine are unchanged. This path:

- Accepts a compact JSON snapshot from the desk (no Kite secrets).
- If OPENAI_API_KEY / DESK_GUIDE_API_KEY is unset, returns the rule case as `source: rules`.
- If a key is set, calls a chat model at most once per DESK_GUIDE_MIN_INTERVAL_S (default 300).

Never put access tokens, API keys, or raw Kite payloads in the prompt.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

MIN_INTERVAL_S = int(os.environ.get("DESK_GUIDE_MIN_INTERVAL_S", "300"))
MAX_ITEMS = 8
MAX_CHARS = 240

_last_ts: Dict[str, float] = {}
_last: Dict[str, Dict[str, Any]] = {}


def llm_configured() -> bool:
    return bool(
        (os.environ.get("OPENAI_API_KEY") or os.environ.get("DESK_GUIDE_API_KEY") or "").strip()
    )


def status() -> Dict[str, Any]:
    return {
        "enabled": llm_configured(),
        "source": "llm" if llm_configured() else "rules",
        "interval_s": MIN_INTERVAL_S,
        "model": (os.environ.get("DESK_GUIDE_MODEL") or "gpt-4o-mini").strip(),
        "note": (
            "LLM pass when a key is set (Ask AI / ~5 min). Rules coach always uses the latest OI tape."
            if llm_configured()
            else "Rule copilot is on the carry brief. Set OPENAI_API_KEY (or DESK_GUIDE_API_KEY) for a language-model pass."
        ),
    }


def _clip(s: Any) -> str:
    t = " ".join(str(s or "").split())
    return t[:MAX_CHARS]


def compact_snapshot(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    def strs(key: str) -> List[str]:
        out = []
        for item in (b.get(key) or [])[:MAX_ITEMS]:
            t = _clip(item)
            if t:
                out.append(t)
        return out

    events = []
    for item in (b.get("results") or [])[:MAX_ITEMS]:
        if isinstance(item, dict):
            events.append({
                "name": _clip(item.get("name")),
                "date": _clip(item.get("date")),
                "daysAway": item.get("daysAway"),
                "index": _clip(item.get("index")),
            })
        else:
            events.append({"name": _clip(item)})

    holidays = []
    for item in (b.get("holidays") or [])[:MAX_ITEMS]:
        if isinstance(item, dict):
            holidays.append({"name": _clip(item.get("name")), "date": _clip(item.get("date"))})
        else:
            holidays.append({"name": _clip(item)})

    surface = _clip(b.get("surface") or "")[:16].lower()
    if surface in ("desk-panel", "desk_panel"):
        surface = "desk"
    if surface not in ("carry", "positions", "desk"):
        # Untyped snapshots: overnight case vs market tape vs book.
        if b.get("why") or b.get("whyNot") or b.get("band"):
            surface = "carry"
        elif b.get("adjust"):
            surface = "positions"
        else:
            surface = "desk"

    book = b.get("book") if isinstance(b.get("book"), dict) else None
    if book:
        by_index = {}
        raw = book.get("byIndex") if isinstance(book.get("byIndex"), dict) else {}
        for idx, bag in list(raw.items())[:6]:
            if not isinstance(bag, dict):
                continue
            by_index[_clip(idx)[:16]] = {
                "ce": int(bag.get("ce") or 0),
                "pe": int(bag.get("pe") or 0),
                "n": int(bag.get("n") or 0),
            }
        book = {
            "openCount": int(book.get("openCount") or 0),
            "shortCount": int(book.get("shortCount") or 0),
            "byIndex": by_index,
        }

    journal = _compact_journal(b.get("journal"))
    memory = _compact_memory(b.get("memory"))
    sells = _compact_sells(b.get("sells"))
    index = _clip(b.get("index"))[:16] or None
    session_focus = _clip(b.get("session_focus") or index)[:16] or None

    vix = b.get("vix")
    gift = b.get("giftPct")
    try:
        vix = float(vix) if vix is not None else None
    except (TypeError, ValueError):
        vix = None
    try:
        gift = float(gift) if gift is not None else None
    except (TypeError, ValueError):
        gift = None

    weekday = b.get("weekday")
    try:
        weekday = int(weekday) if weekday is not None else None
    except (TypeError, ValueError):
        weekday = None

    return {
        "surface": surface,
        "band": _clip(b.get("band"))[:24] or None,
        "why": strs("why"),
        "whyNot": strs("whyNot"),
        "results": events,
        "holidays": holidays,
        "book": book,
        "adjust": _compact_adjust(b.get("adjust")),
        "fii": _compact_fii(b.get("fii")),
        "oi": _compact_oi(b.get("oi")),
        "outside": _compact_outside(b.get("outside")),
        "vix": vix,
        "giftPct": gift,
        "weekday": weekday,
        "index": index,
        "session_focus": session_focus,
        "journal": journal,
        "memory": memory,
        "sells": sells,
    }


def _compact_adjust(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    legs = []
    for item in (raw.get("legs") or [])[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        side = _clip(item.get("side")).upper()[:2]
        if side not in ("CE", "PE"):
            side = None
        dist = item.get("dist")
        try:
            dist = float(dist) if dist is not None else None
        except (TypeError, ValueError):
            dist = None
        k = item.get("K")
        try:
            k = float(k) if k is not None else None
        except (TypeError, ValueError):
            k = None
        def lfnum(key: str):
            try:
                v = item.get(key)
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None
        legs.append({
            "s": _clip(item.get("s"))[:24] or None,
            "side": side,
            "K": k,
            "idx": _clip(item.get("idx"))[:16] or None,
            "dist": dist,
            "itm": bool(item.get("itm")),
            "close": bool(item.get("close")),
            "iv": lfnum("iv"),
            "delta": lfnum("delta"),
            "theta": lfnum("theta"),
        })
    def fnum(key: str):
        try:
            v = raw.get(key)
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    def inum(key: str):
        try:
            v = raw.get(key)
            return int(v) if v is not None else 0
        except (TypeError, ValueError):
            return 0
    return {
        "netDelta": fnum("netDelta"),
        "netTheta": fnum("netTheta"),
        "netVega": fnum("netVega"),
        "avgIv": fnum("avgIv"),
        "shortCount": inum("shortCount"),
        "adjustCount": inum("adjustCount"),
        "pnl": fnum("pnl"),
        "legs": legs,
    }


def _compact_oi(raw: Any) -> List[Dict[str, Any]]:
    rows = raw if isinstance(raw, list) else []
    out: List[Dict[str, Any]] = []
    for item in rows[:6]:
        if not isinstance(item, dict):
            continue
        def fnum(key: str):
            try:
                v = item.get(key)
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None
        def inum(key: str):
            try:
                v = item.get(key)
                return int(float(v)) if v is not None else None
            except (TypeError, ValueError):
                return None
        idx = _clip(item.get("idx") or item.get("index"))[:16] or None
        if not idx:
            continue
        out.append({
            "idx": idx,
            "px": fnum("px") if item.get("px") is not None else fnum("price"),
            "atm": inum("atm"),
            "pcr": fnum("pcr"),
            "ceChg": inum("ceChg"),
            "peChg": inum("peChg"),
            "callWall": inum("callWall"),
            "putWall": inum("putWall"),
            "expiry": _clip(item.get("expiry"))[:12] or None,
        })
    return out


def _compact_fii(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    def fnum(key: str):
        try:
            v = raw.get(key)
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    out = {
        "date": _clip(raw.get("date"))[:16] or None,
        "fiiNet": fnum("fiiNet"),
        "diiNet": fnum("diiNet"),
    }
    if not out["date"] and out["fiiNet"] is None and out["diiNet"] is None:
        return None
    return out


def _compact_memory(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    lines = []
    for item in (raw.get("lines") or [])[:6]:
        t = _clip(item)
        if t:
            lines.append(t)
    buckets = []
    for item in (raw.get("buckets") or [])[:8]:
        if not isinstance(item, dict):
            continue
        side = _clip(item.get("side")).upper()[:2]
        if side not in ("CE", "PE"):
            side = None
        n = item.get("n")
        wins = item.get("wins")
        wr = item.get("win_rate")
        try:
            n = int(n) if n is not None else 0
        except (TypeError, ValueError):
            n = 0
        try:
            wins = int(wins) if wins is not None else 0
        except (TypeError, ValueError):
            wins = 0
        try:
            wr = float(wr) if wr is not None else None
        except (TypeError, ValueError):
            wr = None
        buckets.append({
            "index": _clip(item.get("index"))[:16] or None,
            "side": side,
            "weekday": _clip(item.get("weekday"))[:12] or None,
            "n": n,
            "wins": wins,
            "win_rate": wr,
        })
    if not lines and not buckets:
        return None
    return {"lines": lines, "buckets": buckets}


def _compact_sells(raw: Any) -> List[Dict[str, Any]]:
    rows = raw if isinstance(raw, list) else []
    out: List[Dict[str, Any]] = []
    for item in rows[:3]:
        if not isinstance(item, dict):
            continue
        side = _clip(item.get("side")).upper()[:2]
        if side not in ("CE", "PE"):
            side = None
        strike = item.get("strike")
        score = item.get("score")
        try:
            strike = float(strike) if strike is not None else None
        except (TypeError, ValueError):
            strike = None
        try:
            score = float(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        out.append({
            "s": _clip(item.get("s"))[:28] or None,
            "strike": strike,
            "side": side,
            "score": score,
            "why": _clip(item.get("why"))[:80] or None,
        })
    return out


def _compact_journal(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else raw
    def fnum(key: str):
        try:
            v = stats.get(key)
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    def inum(key: str):
        try:
            v = stats.get(key)
            return int(float(v)) if v is not None else None
        except (TypeError, ValueError):
            return None
    by_index = {}
    raw_ix = stats.get("by_index") if isinstance(stats.get("by_index"), dict) else {}
    for idx, val in list(raw_ix.items())[:6]:
        try:
            by_index[_clip(idx)[:16]] = float(val)
        except (TypeError, ValueError):
            continue
    out = {
        "booked_pnl": fnum("booked_pnl") if stats.get("booked_pnl") is not None else fnum("net_pnl"),
        "win_rate": fnum("win_rate"),
        "trading_days": inum("trading_days"),
        "win_trades": inum("win_trades") if stats.get("win_trades") is not None else inum("win_days"),
        "loss_trades": inum("loss_trades") if stats.get("loss_trades") is not None else inum("lose_days"),
        "by_index": by_index or None,
    }
    if all(v is None for k, v in out.items() if k != "by_index") and not by_index:
        return None
    return out


def _compact_outside(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    movers = []
    for item in (raw.get("movers") or [])[:8]:
        if not isinstance(item, dict):
            continue
        pct = item.get("pct")
        try:
            pct = float(pct) if pct is not None else None
        except (TypeError, ValueError):
            pct = None
        w = item.get("weightage")
        try:
            w = float(w) if w is not None else None
        except (TypeError, ValueError):
            w = None
        movers.append({
            "symbol": _clip(item.get("symbol"))[:16] or None,
            "name": _clip(item.get("name"))[:40] or None,
            "index": _clip(item.get("index"))[:16] or None,
            "weightage": w,
            "pct": pct,
            "note": _clip(item.get("note"))[:160] or None,
        })
    news = []
    for item in (raw.get("news") or [])[:8]:
        if isinstance(item, dict):
            t = _clip(item.get("title"))[:140]
            if t:
                news.append({"title": t})
        else:
            t = _clip(item)
            if t:
                news.append({"title": t})
    events = []
    for item in (raw.get("events") or [])[:12]:
        if not isinstance(item, dict):
            continue
        events.append({
            "priority": _clip(item.get("priority"))[:12] or None,
            "kind": _clip(item.get("kind"))[:16] or None,
            "symbol": _clip(item.get("symbol"))[:16] or None,
            "index": _clip(item.get("index"))[:16] or None,
            "event": _clip(item.get("event"))[:160] or None,
            "why": _clip(item.get("why"))[:180] or None,
            "buyer": _clip(item.get("buyer"))[:140] or None,
            "seller": _clip(item.get("seller"))[:140] or None,
        })
    breadth = raw.get("breadth") if isinstance(raw.get("breadth"), dict) else None
    briefing = _clip(raw.get("briefing"))[:400] or None
    if not movers and not news and not events and not raw.get("note") and not briefing:
        return None
    return {
        "movers": movers,
        "news": news,
        "events": events,
        "breadth": breadth,
        "briefing": briefing,
        "quote_source": _clip(raw.get("quote_source"))[:12] or None,
        "note": _clip(raw.get("note"))[:180] or None,
    }


def _fmt_chg(n: Any) -> str:
    try:
        v = int(n)
    except (TypeError, ValueError):
        return "—"
    sign = "+" if v > 0 else ""
    if abs(v) >= 100000:
        return f"{sign}{v / 100000:.1f}L"
    if abs(v) >= 1000:
        return f"{sign}{v / 1000:.1f}k"
    return f"{sign}{v}"


def _holiday_names(snap: Dict[str, Any]) -> List[str]:
    names: List[str] = []
    for h in (snap.get("holidays") or [])[:3]:
        if isinstance(h, dict) and h.get("name"):
            names.append(str(h["name"]))
        elif h:
            names.append(str(h))
    return names


def _adjust_watch(snap: Dict[str, Any]) -> List[str]:
    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else None
    bits: List[str] = []
    if not adj:
        return bits
    hot = []
    for leg in adj.get("legs") or []:
        if not (leg.get("close") or leg.get("itm")):
            continue
        label = leg.get("s") or f"{leg.get('idx') or ''} {leg.get('side') or ''} {leg.get('K') or ''}".strip()
        reason = "ITM — cut or define risk" if leg.get("itm") else "too close — roll or hedge"
        hot.append(f"{label} ({reason})")
    if hot:
        bits.append("Adjust first: " + "; ".join(hot[:4]))
    elif adj.get("adjustCount"):
        bits.append(f"{int(adj.get('adjustCount') or 0)} short(s) too close — roll, hedge, or cut before adding")
    nd = adj.get("netDelta")
    try:
        ndf = float(nd) if nd is not None else None
    except (TypeError, ValueError):
        ndf = None
    if ndf is not None and abs(ndf) >= 10:
        bits.append(f"Net Δ {ndf:.0f} — flatten tilt before selling more premium")
    if adj.get("shortCount") and not hot and not adj.get("adjustCount"):
        bits.append(f"{int(adj.get('shortCount'))} short(s) still OK vs adjust % — hold, do not chase")
    return bits


def carry_outside(outside: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Cash/news that can gap the book overnight — not the full Desk AI tape."""
    raw = outside if isinstance(outside, dict) else {}
    movers = []
    for item in raw.get("movers") or []:
        if not isinstance(item, dict):
            continue
        try:
            w = float(item.get("weightage") or 0)
            p = float(item.get("pct") or 0)
        except (TypeError, ValueError):
            continue
        impact = abs(w * p / 100.0)
        if impact < 0.08 and abs(p) < 1.5:
            continue
        movers.append({
            "symbol": item.get("symbol"),
            "pct": p,
            "weightage": w,
            "index": item.get("index"),
            "impact": round(w * p / 100.0, 3),
        })
    movers.sort(key=lambda m: abs(m.get("impact") or 0), reverse=True)
    movers = movers[:3]
    events = []
    for e in raw.get("events") or []:
        if not isinstance(e, dict):
            continue
        if str(e.get("priority") or "").upper() not in ("CRITICAL", "HIGH"):
            continue
        events.append(e)
    events = events[:3]
    keys = ("rbi", "fomc", "fed", "holiday", "gap", "result", "sebi", "crude", "usd/inr", "rupee", "vix", "geopolit")
    news = []
    for n in raw.get("news") or []:
        title = (n.get("title") if isinstance(n, dict) else str(n)) or ""
        low = title.lower()
        if any(k in low for k in keys):
            news.append({"title": title} if not isinstance(n, dict) else {"title": n.get("title")})
        if len(news) >= 2:
            break
    return {"movers": movers, "news": news, "events": events}


def _oi_writer_line(row: Dict[str, Any]) -> str:
    idx = row.get("idx") or row.get("index") or "Index"
    ce = row.get("ceChg")
    pe = row.get("peChg")
    try:
        ce_n = int(ce) if ce is not None else 0
        pe_n = int(pe) if pe is not None else 0
    except (TypeError, ValueError):
        ce_n, pe_n = 0, 0
    writer = "put writers" if pe_n >= ce_n else "call writers"
    bits = [str(idx), writer]
    if row.get("pcr") is not None:
        try:
            bits.append(f"PCR {float(row['pcr']):.2f}")
        except (TypeError, ValueError):
            pass
    bits.append(f"CE {_fmt_chg(ce_n)} PE {_fmt_chg(pe_n)}")
    if row.get("callWall") or row.get("putWall"):
        bits.append(f"walls {row.get('callWall') or '—'}/{row.get('putWall') or '—'}")
    return " · ".join(str(x) for x in bits)


def _tape_side_from_oi(snap: Dict[str, Any]) -> Optional[str]:
    """call_writers if CE OI change leads, else put_writers. None if no tape."""
    rows = [r for r in (snap.get("oi") or []) if isinstance(r, dict)]
    if not rows:
        return None
    focus = str(snap.get("session_focus") or snap.get("index") or "")
    pick = None
    if focus:
        for row in rows:
            if str(row.get("idx") or row.get("index") or "") == focus:
                pick = row
                break
    if pick is None:
        pick = rows[0]
    try:
        ce_n = int(pick.get("ceChg") or 0)
        pe_n = int(pick.get("peChg") or 0)
    except (TypeError, ValueError):
        return None
    if ce_n == 0 and pe_n == 0:
        return None
    return "call_writers" if ce_n > pe_n else "put_writers"


def named_leg_actions(adjust: Any, tape_side: Optional[str] = None) -> Dict[str, List[str]]:
    """Per-leg hold / cut / roll / fight vs writer tape. Uses tradingsymbols."""
    holds: List[str] = []
    cuts: List[str] = []
    rolls: List[str] = []
    fight: List[str] = []
    if not isinstance(adjust, dict):
        return {"holds": holds, "cuts": cuts, "rolls": rolls, "fight": fight}
    for leg in (adjust.get("legs") or [])[:8]:
        if not isinstance(leg, dict):
            continue
        s = str(leg.get("s") or "").strip()
        if not s:
            continue
        side = str(leg.get("side") or "").upper()
        if leg.get("itm"):
            cuts.append(s)
            continue
        if leg.get("close"):
            rolls.append(s)
            continue
        if tape_side == "call_writers" and side == "CE":
            holds.append(s)
        elif tape_side == "put_writers" and side == "PE":
            holds.append(s)
        elif tape_side == "call_writers" and side == "PE":
            fight.append(s)
        elif tape_side == "put_writers" and side == "CE":
            fight.append(s)
        else:
            holds.append(s)
    return {
        "holds": holds[:4],
        "cuts": cuts[:4],
        "rolls": rolls[:4],
        "fight": fight[:4],
    }


def _named_action_lines(snap: Dict[str, Any]) -> Dict[str, List[str]]:
    named = named_leg_actions(snap.get("adjust"), _tape_side_from_oi(snap))
    do: List[str] = []
    dont: List[str] = []
    if named["holds"]:
        do.append("Hold " + ", ".join(named["holds"]) + " — sits with writers.")
    if named["cuts"]:
        dont.append("Cut/define " + ", ".join(named["cuts"]))
    if named["rolls"]:
        dont.append("Roll " + ", ".join(named["rolls"]) + " (too close to spot).")
    if named["fight"]:
        dont.append("Reduce / do not add " + ", ".join(named["fight"]) + " — fighting the tape.")
    return {"do": do, "dont": dont, "named": named}


def _journal_line(snap: Dict[str, Any]) -> Optional[str]:
    j = snap.get("journal") if isinstance(snap.get("journal"), dict) else None
    if not j:
        return None
    bits = []
    if j.get("trading_days"):
        bits.append(f"{int(j['trading_days'])} booked days")
    if j.get("win_rate") is not None:
        bits.append(f"win {float(j['win_rate']):.0f}%")
    if j.get("booked_pnl") is not None:
        bits.append(f"booked {float(j['booked_pnl']):+.0f}")
    if not bits:
        return None
    return "Journal last window: " + " · ".join(bits)


def _memory_line(snap: Dict[str, Any]) -> Optional[str]:
    mem = snap.get("memory") if isinstance(snap.get("memory"), dict) else None
    if not mem:
        return None
    lines = [str(x) for x in (mem.get("lines") or []) if str(x).strip()]
    if not lines:
        return None
    return "Book memory: " + lines[0]


def _sells_line(snap: Dict[str, Any]) -> Optional[str]:
    rows = snap.get("sells") if isinstance(snap.get("sells"), list) else []
    bits = []
    for item in rows[:3]:
        if not isinstance(item, dict):
            continue
        label = item.get("s") or " ".join(
            str(x) for x in (item.get("strike"), item.get("side")) if x is not None
        ).strip()
        why = item.get("why")
        if label and why:
            bits.append(f"{label} — {why}")
        elif label:
            bits.append(str(label))
    if not bits:
        return None
    return "Sell ideas (your ranker): " + "; ".join(bits)


def _compose_carry(snap: Dict[str, Any]) -> str:
    """Overnight: do / don't for the open book — greeks, IV, VIX, events, journal."""
    bits: List[str] = []
    do: List[str] = []
    dont: List[str] = []
    band = str(snap.get("band") or "")
    vix = snap.get("vix")
    gift = snap.get("giftPct")
    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else {}
    book = snap.get("book") if isinstance(snap.get("book"), dict) else {}
    outside = snap.get("outside") if isinstance(snap.get("outside"), dict) else {}
    watch = _adjust_watch(snap)

    if band == "DO_NOT_CARRY":
        dont.append("Do not hold unhedged premium through the gap — cut or make it defined-risk.")
    elif band == "REDUCE":
        dont.append("Reduce the index working against you; hold only shorts session OI still supports.")
    else:
        do.append("Calendar looks holdable if shorts stay hedged and not too close to spot.")

    if vix is not None and vix >= 18:
        dont.append(f"India VIX {vix:.1f} — overnight gap typically wider; do not add naked shorts.")
    elif vix is not None and vix < 15:
        do.append(f"India VIX {vix:.1f} — vol not elevated for a hold.")
    if gift is not None and abs(float(gift)) >= 0.35:
        dont.append(f"GIFT {float(gift):+.2f}% vs cash — expect a gap; size down.")
    elif gift is not None and abs(float(gift)) < 0.2:
        do.append("GIFT near flat vs cash.")

    avg_iv = adj.get("avgIv")
    if avg_iv is not None and float(avg_iv) >= 22:
        dont.append(f"Short-book IV ~{float(avg_iv):.0f}% — rich but gap/vega risk into the next open.")
    elif avg_iv is not None and float(avg_iv) <= 10:
        dont.append(f"Short-book IV ~{float(avg_iv):.0f}% — cheap premium; do not add size overnight.")
    nd = adj.get("netDelta")
    if nd is not None and abs(float(nd)) >= 10:
        dont.append(f"Net Δ {float(nd):.0f} — flatten tilt before carrying naked.")
    nt = adj.get("netTheta")
    if nt is not None and float(nt) > 0:
        do.append(f"Theta still paying (~{float(nt):.0f}/day) if the gap does not blow through shorts.")
    for w in watch[:3]:
        if "Adjust first" in w or "too close" in w or "ITM" in w:
            dont.append(w)
        else:
            do.append(w)

    for row in (snap.get("oi") or [])[:3]:
        if isinstance(row, dict):
            do.append(_oi_writer_line(row))

    for s in (snap.get("why") or [])[:3]:
        do.append(str(s))
    for s in (snap.get("whyNot") or [])[:4]:
        dont.append(str(s))

    movers = outside.get("movers") or []
    impacts = []
    for m in movers[:3]:
        if not isinstance(m, dict) or not m.get("symbol"):
            continue
        try:
            pct = float(m.get("pct")) if m.get("pct") is not None else None
        except (TypeError, ValueError):
            pct = None
        pct_s = f"{pct:+.1f}%" if pct is not None else ""
        impacts.append(f"{m.get('symbol')} {pct_s}".strip())
    if impacts:
        dont.append("Cash that can gap the book: " + "; ".join(impacts))
    for e in (outside.get("events") or [])[:3]:
        if isinstance(e, dict) and e.get("event"):
            dont.append(str(e.get("event")))
    hnames = _holiday_names(snap)
    if hnames:
        dont.append("Holiday in window: " + "; ".join(hnames))
    jl = _journal_line(snap)
    if jl:
        do.append(jl)
    ml = _memory_line(snap)
    if ml:
        do.append(ml)
    shorts = int(book.get("shortCount") or 0)
    if shorts:
        do.append(f"Open book: {shorts} short option{'s' if shorts != 1 else ''}.")

    named_lines = _named_action_lines(snap)
    do = named_lines["do"] + do
    dont = named_lines["dont"] + dont

    # Dedup while keeping order
    seen = set()
    def take(rows: List[str], n: int) -> List[str]:
        out = []
        for r in rows:
            t = " ".join(str(r).split())
            if not t or t in seen:
                continue
            seen.add(t)
            out.append(t)
            if len(out) >= n:
                break
        return out

    do_u = take(do, 7)
    dont_u = take(dont, 8)
    bits.append("DO")
    bits.extend(f"  {t}" for t in (do_u or ["No extra overnight tailwind — size as a gap, not a conviction hold."]))
    bits.append("DON'T")
    bits.extend(f"  {t}" for t in (dont_u or ["No hard overnight block from VIX, events, or the book."]))
    return "\n".join(bits)


def _compose_desk(snap: Dict[str, Any]) -> str:
    """Live strip: OI tape + book + cash/news + do/don't. Not overnight-only."""
    bits: List[str] = []
    outside = snap.get("outside") if isinstance(snap.get("outside"), dict) else {}
    movers = outside.get("movers") or []
    news = outside.get("news") or []
    evs = outside.get("events") or []
    breadth = outside.get("breadth") if isinstance(outside.get("breadth"), dict) else {}
    focus = snap.get("session_focus") or snap.get("index")

    tape = []
    if focus:
        tape.append(f"Session focus {focus} (Mon–Tue NIFTY · Wed–Thu SENSEX).")
    for row in (snap.get("oi") or [])[:3]:
        if isinstance(row, dict):
            tape.append(_oi_writer_line(row))
    if tape:
        bits.append("TAPE")
        bits.extend(f"  {t}" for t in tape)

    book = snap.get("book") if isinstance(snap.get("book"), dict) else None
    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else None
    book_bits = []
    if book and book.get("shortCount"):
        parts = [f"{int(book['shortCount'])} open shorts"]
        for idx, bag in list((book.get("byIndex") or {}).items())[:3]:
            parts.append(f"{idx} {int(bag.get('ce') or 0)} CE / {int(bag.get('pe') or 0)} PE")
        book_bits.append(" · ".join(parts))
    if adj:
        g = []
        if adj.get("netDelta") is not None:
            g.append(f"Δ {float(adj['netDelta']):.0f}")
        if adj.get("netTheta") is not None:
            g.append(f"Θ {float(adj['netTheta']):.0f}")
        if adj.get("avgIv") is not None:
            g.append(f"IV {float(adj['avgIv']):.0f}%")
        if g:
            book_bits.append("Greeks " + " · ".join(g))
        for w in _adjust_watch(snap)[:2]:
            book_bits.append(w)
    if book_bits:
        bits.append("BOOK")
        bits.extend(f"  {t}" for t in book_bits)
    jl = _journal_line(snap)
    if jl:
        bits.append("JOURNAL")
        bits.append(f"  {jl}")
    ml = _memory_line(snap)
    if ml:
        bits.append("MEMORY")
        bits.append(f"  {ml}")

    what = []
    if movers:
        what.append("Heavyweights: " + ", ".join(
            f"{m.get('symbol')} {m['pct']:+.1f}%" if isinstance(m.get("pct"), (int, float)) else str(m.get("symbol"))
            for m in movers[:5]
        ))
    briefing = outside.get("briefing")
    if briefing and not str(briefing).lower().startswith("session focus"):
        what.append(str(briefing)[:220])
    hi = [e for e in evs if str(e.get("priority") or "").upper() in ("CRITICAL", "HIGH")]
    if hi:
        what.extend(e.get("event") for e in hi[:3] if e.get("event"))
    if news:
        what.extend((n.get("title") if isinstance(n, dict) else str(n)) for n in news[:2])
    nifty_b = breadth.get("NIFTY") if isinstance(breadth.get("NIFTY"), dict) else None
    if nifty_b and nifty_b.get("n"):
        what.append(f"NIFTY breadth {nifty_b.get('adv')}/{nifty_b.get('n')} advancing.")
    bnf_b = breadth.get("BANKNIFTY") if isinstance(breadth.get("BANKNIFTY"), dict) else None
    if bnf_b and bnf_b.get("n"):
        what.append(f"BANKNIFTY breadth {bnf_b.get('adv')}/{bnf_b.get('n')} advancing.")
    if what:
        bits.append("WHAT CHANGED")
        bits.extend(f"  {t}" for t in what if t)

    do: List[str] = []
    dont: List[str] = []
    seller = [e.get("seller") for e in evs[:3] if e.get("seller")]
    buyer = [e.get("buyer") for e in evs[:3] if e.get("buyer")]
    for row in (snap.get("oi") or [])[:2]:
        if not isinstance(row, dict):
            continue
        ce = int(row.get("ceChg") or 0)
        pe = int(row.get("peChg") or 0)
        idx = row.get("idx") or "Index"
        if ce > pe:
            do.append(f"{idx}: call writers — prefer CE shorts / do not chase PE shorts.")
            dont.append(f"{idx}: do not add PE shorts into a call-writer tape.")
        else:
            do.append(f"{idx}: put writers — prefer PE shorts / do not chase CE shorts.")
            dont.append(f"{idx}: do not add CE shorts into a put-writer tape.")
    named_lines = _named_action_lines(snap)
    do.extend(named_lines["do"])
    dont.extend(named_lines["dont"])
    sl = _sells_line(snap)
    if sl:
        do.append(sl)
    do.extend(seller[:2])
    if buyer:
        dont.append("Buyers: " + "; ".join(buyer[:2]))
    vix = snap.get("vix")
    if vix is not None and vix >= 18:
        dont.append(f"VIX {vix:.1f} — size down, do not sell more naked premium.")
    bits.append("DO")
    bits.extend(f"  {t}" for t in (do[:4] or ["Stay with session writers; do not fade a one-print cash spike."]))
    bits.append("DON'T")
    bits.extend(f"  {t}" for t in (dont[:4] or ["Do not invent a trade if OI and cash are quiet."]))
    if not bits:
        bits.append("Waiting for OI / news. Keep the chart as source of truth.")
    return "\n".join(bits)


def _compose_positions(snap: Dict[str, Any]) -> str:
    """Radar: book risk vs cash. Not the overnight carry card."""
    bits: List[str] = []
    named = named_leg_actions(snap.get("adjust"), _tape_side_from_oi(snap))
    watch: List[str] = []
    if named["cuts"]:
        watch.append("Buy back / roll: " + ", ".join(named["cuts"]) + " — ITM.")
    if named["rolls"]:
        watch.append("Roll out: " + ", ".join(named["rolls"]) + " — too close.")
    if named["fight"]:
        watch.append("Reduce: " + ", ".join(named["fight"]) + " — fighting writers.")
    if named["holds"]:
        watch.append("Hold: " + ", ".join(named["holds"]))
    for w in _adjust_watch(snap):
        if w not in watch:
            watch.append(w)
    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else {}
    nd = adj.get("netDelta")
    try:
        ndf = float(nd) if nd is not None else None
    except (TypeError, ValueError):
        ndf = None
    if ndf is not None and abs(ndf) >= 10:
        hedge = f"Hedge |Δ| {ndf:.0f} — futures or far OTM option, not more shorts"
        if hedge not in watch:
            watch.append(hedge)
    sl = _sells_line(snap)
    if sl:
        watch.append(sl)
    ml = _memory_line(snap)
    if ml:
        watch.append(ml)
    if watch:
        bits.append("WATCH NEXT")
        bits.extend(f"  {t}" for t in watch[:8])
    outside = snap.get("outside") if isinstance(snap.get("outside"), dict) else None
    briefing = (outside or {}).get("briefing")
    movers = (outside or {}).get("movers") or []
    if briefing:
        bits.append("Cash vs book: " + str(briefing)[:220])
    elif movers:
        top = movers[0]
        sym = top.get("symbol") or "Heavyweight"
        pct = top.get("pct")
        line = f"{sym}"
        if isinstance(pct, (int, float)):
            line += f" {pct:+.1f}%"
        bits.append("Cash vs book: " + line + " — size shorts off this, not off PCR.")
    if not bits:
        bits.append("Book looks quiet vs adjust %. Open Desk AI for the cash tape; this radar is your shorts.")
    return "\n".join(bits)


def _guide_surface(snap: Optional[Dict[str, Any]] = None) -> str:
    s = str((snap or {}).get("surface") or "").lower()
    if s in ("desk-panel", "desk_panel"):
        return "desk"
    if s in ("carry", "positions", "desk"):
        return s
    if (snap or {}).get("why") or (snap or {}).get("whyNot") or (snap or {}).get("band"):
        return "carry"
    if (snap or {}).get("adjust"):
        return "positions"
    return "desk"


def compose_rules_guide(snap: Dict[str, Any]) -> str:
    """Surface-specific coach so carry / desk / radar are not the same dump."""
    surface = _guide_surface(snap)
    if surface == "carry":
        return _compose_carry(snap)
    if surface == "positions":
        return _compose_positions(snap)
    return _compose_desk(snap)


def reset_cache() -> None:
    global _last_ts, _last
    _last_ts = {}
    _last = {}


def _rules_payload(snap: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {
        **status(),
        "source": "rules",
        "guide": compose_rules_guide(snap),
        "cached": False,
    }
    if extra:
        out.update(extra)
    return out


async def maybe_guide(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    global _last_ts, _last
    body = body or {}
    snap = compact_snapshot(body)
    surface = str(snap.get("surface") or "carry")
    now = time.monotonic()
    prev = _last.get(surface)
    prev_ts = _last_ts.get(surface, 0.0)
    force = bool(body.get("force"))
    skip_llm = bool(body.get("skip_llm"))
    rules = compose_rules_guide(snap)
    if skip_llm or not llm_configured():
        payload = {
            **status(),
            "source": "rules",
            "guide": rules,
            "rules_guide": rules,
            "cached": False,
        }
        _last[surface] = payload
        _last_ts[surface] = now
        return payload
    llm_fresh = (
        prev is not None
        and prev.get("source") == "llm"
        and prev.get("guide")
        and not force
        and (now - prev_ts) < MIN_INTERVAL_S
    )
    if llm_fresh:
        return {
            **prev,
            "rules_guide": rules,
            "cached": True,
            "guide": prev.get("guide") or rules,
        }
    try:
        text = await _call_llm(snap)
        payload = {
            **status(),
            "source": "llm",
            "guide": text,
            "rules_guide": rules,
            "cached": False,
        }
        _last[surface] = payload
        _last_ts[surface] = now
        return payload
    except Exception as exc:
        payload = {
            **status(),
            "source": "rules",
            "guide": rules,
            "rules_guide": rules,
            "cached": False,
            "llm_error": _clip(exc)[:120],
        }
        _last[surface] = payload
        _last_ts[surface] = now
        return payload


async def _call_llm(snap: Dict[str, Any]) -> str:
    import httpx

    key = (os.environ.get("OPENAI_API_KEY") or os.environ.get("DESK_GUIDE_API_KEY") or "").strip()
    base = (os.environ.get("DESK_GUIDE_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = (os.environ.get("DESK_GUIDE_MODEL") or "gpt-4o-mini").strip()
    surface = str(snap.get("surface") or "desk")
    if surface == "carry":
        system = (
            "You write an overnight HOLD note for NSE index-option sellers. "
            "Format exactly: DO (bullets) then DON'T (bullets). "
            "Use why/whyNot, band, vix, giftPct, adjust (delta/theta/IV/legs), oi writer tape, journal, memory, holidays, outside events. "
            "Name tradingsymbols from adjust.legs (Hold / Cut/define / Roll). Max 10 short lines. Never invent prices or strikes."
        )
    elif surface == "positions":
        system = (
            "You coach the open shorts book on Radar. Use ONLY adjust.legs / netDelta, optional sells "
            "(explain the ranker, do not invent a list), memory.lines, and a one-line outside.briefing if present. "
            "Name each short: ITM = buy back/roll; too close = roll; fighting tape = reduce; |Δ| large = hedge, not more shorts. "
            "Lead with WATCH NEXT. Max 6 lines. Never invent prices."
        )
    else:
        system = (
            "You are an NSE index-options desk for sellers first, then buyers. "
            "Format exactly: TAPE / BOOK / JOURNAL / WHAT CHANGED / DO / DON'T. "
            "Use oi (PCR, CE/PE, walls), book, adjust greeks, journal, memory.lines, sells (explain top 3 from the ranker only). "
            "Name tradingsymbols from adjust.legs. DO/DON'T must be trade actions. Never invent prices or extra sell strikes. Max 16 lines."
        )
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0.15,
                "max_tokens": 520,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": str(snap)},
                ],
            },
        )
        r.raise_for_status()
        data = r.json()
    text = (
        (((data.get("choices") or [{}])[0].get("message") or {}).get("content"))
        or ""
    ).strip()
    if not text:
        raise RuntimeError("empty LLM content")
    return text[:1800]
