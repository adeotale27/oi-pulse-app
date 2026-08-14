"""Outside-the-chart tape for Desk AI: heavyweight cash movers + news.

This is intentionally NOT the OI chain (the trader already has that chart).
Uses uploaded index constituents + Kite (or Yahoo fallback) + public RSS.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

TOP_N = {"NIFTY": 12, "BANKNIFTY": 10, "SENSEX": 10}
NEWS_FEEDS = (
    "https://news.google.com/rss/search?q=Nifty+OR+Sensex+OR+%22Bank+Nifty%22+OR+RBI+OR+FOMC+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
)
UA = "Mozilla/5.0 (compatible; OIPulseDesk/5.19; +https://github.com/adeotale27/oi-pulse-app)"
CACHE_S = 45.0

_cache: Dict[str, Any] = {"at": 0.0, "pack": None}


def _clip(s: Any, n: int = 160) -> str:
    return " ".join(str(s or "").split())[:n]


def kite_key(symbol: str) -> str:
    return f"NSE:{str(symbol or '').strip().upper()}"


def yahoo_symbol(symbol: str) -> str:
    return f"{str(symbol or '').strip().upper()}.NS"


def parse_rss_items(xml_text: str, limit: int = 8) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not xml_text or not xml_text.strip():
        return out
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for item in root.iter("item"):
        title = _clip((item.findtext("title") or ""), 140)
        if not title:
            continue
        out.append({
            "title": title,
            "source": _clip(item.findtext("source") or "", 40),
        })
        if len(out) >= limit:
            break
    return out


def score_mover(weightage: Optional[float], pct: Optional[float]) -> float:
    try:
        w = float(weightage or 0)
    except (TypeError, ValueError):
        w = 0.0
    try:
        p = abs(float(pct or 0))
    except (TypeError, ValueError):
        p = 0.0
    return p * max(w, 0.5)


def is_material_move(weightage: Optional[float], pct: Optional[float]) -> bool:
    try:
        w = float(weightage or 0)
        p = abs(float(pct or 0))
    except (TypeError, ValueError):
        return False
    if p >= 1.2:
        return True
    if w >= 3.0 and p >= 0.7:
        return True
    if w >= 1.5 and p >= 1.0:
        return True
    return False


def seller_note(pct: Optional[float], weightage: Optional[float]) -> str:
    try:
        p = float(pct or 0)
        w = float(weightage or 0)
    except (TypeError, ValueError):
        return "heavyweight moving — size shorts"
    wt = f"{w:.1f}% wt" if w else "heavyweight"
    if p <= -1.2:
        return f"{wt} dumping — index can slip the put wall; do not add PE shorts"
    if p <= -0.7:
        return f"{wt} heavy — respect downside; fade only if puts still adding on the chart"
    if p >= 1.2:
        return f"{wt} ripping — call wall can get tested; do not chase CE shorts"
    if p >= 0.7:
        return f"{wt} bid — upside squeeze risk on sold calls"
    return f"{wt} in play"


def _quote_from_kite(raw: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    last = raw.get("last_price")
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}
    prev = ohlc.get("close") or raw.get("average_price")
    try:
        last_f = float(last) if last is not None else None
    except (TypeError, ValueError):
        last_f = None
    try:
        prev_f = float(prev) if prev is not None else None
    except (TypeError, ValueError):
        prev_f = None
    return last_f, prev_f


async def _yahoo_quotes(symbols: List[str]) -> Dict[str, Tuple[Optional[float], Optional[float]]]:
    if not symbols:
        return {}
    joined = ",".join(yahoo_symbol(s) for s in symbols)
    url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={joined}"
    out: Dict[str, Tuple[Optional[float], Optional[float]]] = {}
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": UA}) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return {}
            data = r.json()
    except Exception as e:
        logger.warning("yahoo quotes failed: %s", e)
        return {}
    for row in ((data.get("quoteResponse") or {}).get("result") or []):
        sym = str(row.get("symbol") or "").replace(".NS", "").replace(".BO", "")
        last = row.get("regularMarketPrice")
        prev = row.get("regularMarketPreviousClose")
        try:
            last_f = float(last) if last is not None else None
            prev_f = float(prev) if prev is not None else None
        except (TypeError, ValueError):
            continue
        out[sym] = (last_f, prev_f)
    return out


def _kite_batch(tracker, keys: List[str]) -> Dict[str, Dict[str, Any]]:
    svc = getattr(tracker, "kite_service", None) if tracker else None
    kite = getattr(svc, "kite", None) if svc else None
    if not kite or getattr(tracker, "mode", None) != "kite":
        return {}
    try:
        return kite.quote(keys) or {}
    except Exception as e:
        logger.warning("desk_outside kite.quote failed: %s", e)
        return {}


async def _load_heavies(db) -> List[Dict[str, Any]]:
    if db is None:
        return []
    heavies: List[Dict[str, Any]] = []
    seen = set()
    for idx, n in TOP_N.items():
        try:
            docs = await db.index_constituents.find(
                {"index": idx},
                {"_id": 0, "symbol": 1, "company_name": 1, "weightage": 1, "index": 1},
            ).sort("weightage", -1).to_list(length=n)
        except Exception as e:
            logger.warning("constituents read %s: %s", idx, e)
            docs = []
        for d in docs:
            sym = str(d.get("symbol") or "").strip().upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            heavies.append({
                "symbol": sym,
                "name": _clip(d.get("company_name"), 40),
                "weightage": d.get("weightage"),
                "index": idx,
            })
    return heavies


async def _fetch_news() -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen = set()
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        for url in NEWS_FEEDS:
            try:
                r = await client.get(url)
                if r.status_code != 200:
                    continue
                for it in parse_rss_items(r.text, limit=8):
                    key = re.sub(r"\W+", "", it["title"].lower())[:80]
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(it)
            except Exception as e:
                logger.warning("news feed failed %s: %s", url, e)
    return items[:8]


async def snapshot(db, tracker=None, *, force: bool = False) -> Dict[str, Any]:
    now = time.monotonic()
    if not force and _cache["pack"] is not None and (now - float(_cache["at"] or 0)) < CACHE_S:
        return _cache["pack"]

    heavies = await _load_heavies(db)
    keys = [kite_key(h["symbol"]) for h in heavies]
    kite_map = {}
    if keys:
        kite_map = await asyncio.to_thread(_kite_batch, tracker, keys)

    quotes: Dict[str, Tuple[Optional[float], Optional[float]]] = {}
    for h in heavies:
        raw = kite_map.get(kite_key(h["symbol"])) or kite_map.get(h["symbol"])
        if isinstance(raw, dict):
            quotes[h["symbol"]] = _quote_from_kite(raw)

    missing = [h["symbol"] for h in heavies if h["symbol"] not in quotes or quotes[h["symbol"]][0] is None]
    if missing:
        y = await _yahoo_quotes(missing[:24])
        for sym, pair in y.items():
            quotes[sym] = pair

    movers: List[Dict[str, Any]] = []
    source = "kite" if kite_map else ("yahoo" if quotes else "none")
    for h in heavies:
        last, prev = quotes.get(h["symbol"], (None, None))
        pct = None
        if last is not None and prev:
            pct = round((last - prev) / prev * 100, 2)
        if not is_material_move(h.get("weightage"), pct):
            continue
        movers.append({
            "symbol": h["symbol"],
            "name": h["name"],
            "index": h["index"],
            "weightage": h.get("weightage"),
            "last": last,
            "pct": pct,
            "note": seller_note(pct, h.get("weightage")),
        })
    movers.sort(key=lambda m: score_mover(m.get("weightage"), m.get("pct")), reverse=True)
    movers = movers[:8]

    news = await _fetch_news()
    pack = {
        "movers": movers,
        "news": news,
        "heavy_count": len(heavies),
        "quote_source": source,
        "at": int(time.time()),
        "note": (
            None if heavies
            else "Upload Nifty 50 / Bank / Sensex constituents in Admin → Upload to enable heavyweight tape."
        ),
    }
    _cache["at"] = now
    _cache["pack"] = pack
    return pack


def reset_cache() -> None:
    _cache["at"] = 0.0
    _cache["pack"] = None
