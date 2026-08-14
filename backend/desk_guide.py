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
            "LLM pass every ~5 minutes when a key is set."
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


def compose_rules_guide(snap: Dict[str, Any]) -> str:
    bits: List[str] = []
    adj = snap.get("adjust") if isinstance(snap.get("adjust"), dict) else None
    if adj:
        hot = []
        for leg in adj.get("legs") or []:
            if not (leg.get("close") or leg.get("itm")):
                continue
            label = leg.get("s") or f"{leg.get('idx') or ''} {leg.get('side') or ''} {leg.get('K') or ''}".strip()
            why = "ITM — cut or define risk" if leg.get("itm") else "too close — roll or hedge"
            hot.append(f"{label} ({why})")
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
    fii = snap.get("fii") if isinstance(snap.get("fii"), dict) else None
    if fii and (fii.get("fiiNet") is not None or fii.get("diiNet") is not None):
        fn = fii.get("fiiNet")
        dn = fii.get("diiNet")
        bits.append(
            "Cash FII/DII: "
            + (f"FII {fn:+.0f} cr" if fn is not None else "FII —")
            + ", "
            + (f"DII {dn:+.0f} cr" if dn is not None else "DII —")
        )
    why = snap.get("why") or []
    why_not = snap.get("whyNot") or []
    if why:
        bits.append("Why carry: " + "; ".join(why[:4]))
    if why_not:
        bits.append("Why not: " + "; ".join(why_not[:4]))
    results = snap.get("results") or []
    if results:
        names = [r.get("name") for r in results if r.get("name")]
        if names:
            bits.append("Results: " + "; ".join(names[:6]))
    if not bits:
        bits.append("No extra LLM note. Use the Why carry / Why not columns and Positions adjust flags.")
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
    if not force and prev is not None and (now - prev_ts) < MIN_INTERVAL_S:
        return {**prev, "cached": True}
    if not llm_configured():
        payload = _rules_payload(snap)
        _last[surface] = payload
        _last_ts[surface] = now
        return payload
    try:
        text = await _call_llm(snap)
        payload = {
            **status(),
            "source": "llm",
            "guide": text,
            "cached": False,
        }
        _last[surface] = payload
        _last_ts[surface] = now
        return payload
    except Exception as exc:
        payload = _rules_payload(snap, extra={"llm_error": _clip(exc)[:120]})
        _last[surface] = payload
        _last_ts[surface] = now
        return payload


async def _call_llm(snap: Dict[str, Any]) -> str:
    import httpx

    key = (os.environ.get("OPENAI_API_KEY") or os.environ.get("DESK_GUIDE_API_KEY") or "").strip()
    base = (os.environ.get("DESK_GUIDE_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = (os.environ.get("DESK_GUIDE_MODEL") or "gpt-4o-mini").strip()
    system = (
        "You are the on-desk AI for an NSE index-options seller (NIFTY, SENSEX, BANKNIFTY). "
        "Use only the JSON. Do not place orders. Do not invent prices or strikes. "
        "Write 4-6 short punchy lines a trader can act on now: "
        "1) HOLD / ROLL / CUT / HEDGE for named shorts (adjust.legs) "
        "2) session OI vs the book 3) FII/DII + VIX + GIFT 4) results/holidays "
        "5) net Δ / ITM 6) one size note. Lead with the action verb."
    )
    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0.2,
                "max_tokens": 280,
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
    return text[:1200]
