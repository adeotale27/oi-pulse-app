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

    surface = _clip(b.get("surface") or "carry")[:16].lower() or "carry"
    if surface not in ("carry", "positions", "desk"):
        surface = "carry"

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
        legs.append({
            "s": _clip(item.get("s"))[:24] or None,
            "side": side,
            "K": k,
            "idx": _clip(item.get("idx"))[:16] or None,
            "dist": dist,
            "itm": bool(item.get("itm")),
            "close": bool(item.get("close")),
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


def compose_rules_guide(snap: Dict[str, Any]) -> str:
    """What the OI chart cannot show: heavyweights, breadth, news, calendar, book."""
    bits: List[str] = []
    outside = snap.get("outside") if isinstance(snap.get("outside"), dict) else None
    briefing = (outside or {}).get("briefing")
    movers = (outside or {}).get("movers") or []
    news = (outside or {}).get("news") or []
    evs = (outside or {}).get("events") or []
    breadth = (outside or {}).get("breadth") if isinstance((outside or {}).get("breadth"), dict) else {}

    what = []
    if briefing:
        what.append(str(briefing))
    elif movers:
        what.append("Heavyweight cash (not option OI): " + ", ".join(
            f"{m.get('symbol')} {m['pct']:+.1f}%" if isinstance(m.get("pct"), (int, float)) else str(m.get("symbol"))
            for m in movers[:5]
        ))
    elif outside and outside.get("note"):
        what.append(str(outside.get("note")))
    hi = [e for e in evs if str(e.get("priority") or "").upper() in ("CRITICAL", "HIGH")]
    if hi:
        what.extend(e.get("event") for e in hi[:4] if e.get("event"))
    if what:
        bits.append("WHAT CHANGED")
        bits.extend(f"  {t}" for t in what if t)

    why = []
    for e in (hi or evs)[:4]:
        if e.get("why"):
            why.append(f"{e.get('symbol') or e.get('kind')}: {e.get('why')}")
    if news:
        why.extend((n.get("title") if isinstance(n, dict) else str(n)) for n in news[:3])
    nifty_b = breadth.get("NIFTY") if isinstance(breadth.get("NIFTY"), dict) else None
    if nifty_b and nifty_b.get("n"):
        why.append(f"NIFTY breadth {nifty_b.get('adv')}/{nifty_b.get('n')} advancing — not visible on the OI ladder.")
    if why:
        bits.append("WHY IT MATTERS")
        bits.extend(f"  {t}" for t in why if t)

    buyer = [e.get("buyer") for e in evs[:3] if e.get("buyer")]
    seller = [e.get("seller") for e in evs[:3] if e.get("seller")]
    if outside is not None or what or why:
        bits.append("OPTION BUYER")
        bits.append("  " + ("; ".join(buyer[:3]) if buyer else "No extra directional catalyst beyond the cash tape."))
        bits.append("OPTION SELLER")
        bits.append("  " + ("; ".join(seller[:3]) if seller else "No extra gap/event risk scored outside OI."))

    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else None
    if adj:
        hot = []
        for leg in adj.get("legs") or []:
            if not (leg.get("close") or leg.get("itm")):
                continue
            label = leg.get("s") or f"{leg.get('idx') or ''} {leg.get('side') or ''} {leg.get('K') or ''}".strip()
            reason = "ITM — cut or define risk" if leg.get("itm") else "too close — roll or hedge"
            hot.append(f"{label} ({reason})")
        if hot:
            bits.append("WATCH NEXT")
            bits.append("  Adjust first: " + "; ".join(hot[:4]))
        elif adj.get("adjustCount"):
            bits.append("WATCH NEXT")
            bits.append(f"  {int(adj.get('adjustCount') or 0)} short(s) too close — roll, hedge, or cut before adding")
        nd = adj.get("netDelta")
        try:
            ndf = float(nd) if nd is not None else None
        except (TypeError, ValueError):
            ndf = None
        if ndf is not None and abs(ndf) >= 10:
            if not any(x.startswith("WATCH NEXT") for x in bits):
                bits.append("WATCH NEXT")
            bits.append(f"  Net Δ {ndf:.0f} — flatten tilt before selling more premium")
        if adj.get("shortCount") and not hot and not adj.get("adjustCount"):
            if not any(x.startswith("WATCH NEXT") for x in bits):
                bits.append("WATCH NEXT")
            bits.append(f"  {int(adj.get('shortCount'))} short(s) still OK vs adjust % — hold, do not chase")
    why_carry = snap.get("why") or []
    why_not = snap.get("whyNot") or []
    if why_carry:
        bits.append("Why carry: " + "; ".join(why_carry[:4]))
    if why_not:
        bits.append("Why not: " + "; ".join(why_not[:4]))
    results = snap.get("results") or []
    if results:
        names = [r.get("name") for r in results if r.get("name")]
        if names:
            bits.append("Calendar (results): " + "; ".join(names[:6]))
    holidays = snap.get("holidays") or []
    if holidays:
        hnames = []
        for h in holidays[:3]:
            if isinstance(h, dict) and h.get("name"):
                hnames.append(h["name"])
            elif h:
                hnames.append(str(h))
        if hnames:
            bits.append("Holiday: " + "; ".join(hnames))
    if not bits:
        bits.append("No outside tape yet — upload constituents (Impact Risk), or wait for news/movers. Use the OI chart for PCR/walls.")
    return "\n".join(bits)


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
    system = (
        "You are an NSE index-options desk for buyers AND non-directional sellers. "
        "The trader already sees the OI chart (PCR, CE/PE change, walls) — do NOT recap OI numbers. "
        "Use ONLY the JSON. Lead with outside.briefing, outside.events, outside.movers (cash by weight), "
        "outside.breadth, news, results/holidays, and ITM/too-close adjust.legs. "
        "Format exactly: WHAT CHANGED / WHY IT MATTERS / OPTION BUYER / OPTION SELLER / WATCH NEXT. "
        "Explain what OI alone misses (heavyweight cash, breadth vs index, news, event risk). "
        "Never invent prices."
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
