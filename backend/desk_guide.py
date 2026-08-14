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

_last_ts = 0.0
_last: Optional[Dict[str, Any]] = None


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
        "band": _clip(b.get("band"))[:24] or None,
        "why": strs("why"),
        "whyNot": strs("whyNot"),
        "results": events,
        "holidays": holidays,
        "book": book,
        "vix": vix,
        "giftPct": gift,
        "weekday": weekday,
    }


def compose_rules_guide(snap: Dict[str, Any]) -> str:
    bits: List[str] = []
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
        bits.append("No extra LLM note. Use the Why carry / Why not columns.")
    return "\n".join(bits)


def reset_cache() -> None:
    global _last_ts, _last
    _last_ts = 0.0
    _last = None


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
    snap = compact_snapshot(body)
    now = time.monotonic()
    if _last is not None and (now - _last_ts) < MIN_INTERVAL_S:
        return {**_last, "cached": True}
    if not llm_configured():
        payload = _rules_payload(snap)
        _last = payload
        _last_ts = now
        return payload
    try:
        text = await _call_llm(snap)
        payload = {
            **status(),
            "source": "llm",
            "guide": text,
            "cached": False,
        }
        _last = payload
        _last_ts = now
        return payload
    except Exception as exc:
        payload = _rules_payload(snap, extra={"llm_error": _clip(exc)[:120]})
        _last = payload
        _last_ts = now
        return payload


async def _call_llm(snap: Dict[str, Any]) -> str:
    import httpx

    key = (os.environ.get("OPENAI_API_KEY") or os.environ.get("DESK_GUIDE_API_KEY") or "").strip()
    base = (os.environ.get("DESK_GUIDE_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = (os.environ.get("DESK_GUIDE_MODEL") or "gpt-4o-mini").strip()
    system = (
        "You are an NSE index-options seller coach. Use only the JSON. "
        "Do not place orders. Do not invent prices. Four short lines max: "
        "carry vs not, book vs session OI mismatch, results/holidays, one size note."
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
