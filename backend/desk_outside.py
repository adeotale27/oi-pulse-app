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

TOP_N = {"NIFTY": 50, "BANKNIFTY": 14, "SENSEX": 30}
NEWS_FEEDS = (
    "https://news.google.com/rss/search?q=Nifty+OR+Sensex+OR+%22Bank+Nifty%22+OR+RBI+OR+FOMC+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
)
UA = "Mozilla/5.0 (compatible; OIPulseDesk/6.00; +https://github.com/adeotale27/oi-pulse-app)"
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


def _quote_from_kite(raw: Dict[str, Any]) -> Dict[str, Optional[float]]:
    last = raw.get("last_price")
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}
    prev = ohlc.get("close")
    high = ohlc.get("high")
    low = ohlc.get("low")
    opn = ohlc.get("open")
    vol = raw.get("volume")
    vwap = raw.get("average_price")
    def f(v):
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    last_f, prev_f = f(last), f(prev)
    pct = None
    if last_f is not None and prev_f:
        pct = round((last_f - prev_f) / prev_f * 100, 2)
    return {
        "last": last_f,
        "prev": prev_f,
        "pct": pct,
        "high": f(high),
        "low": f(low),
        "open": f(opn),
        "volume": f(vol),
        "vwap": f(vwap),
    }


def _flags(q: Dict[str, Optional[float]]) -> List[str]:
    flags = []
    last, high, low, vwap, opn, prev, pct = (
        q.get("last"), q.get("high"), q.get("low"), q.get("vwap"),
        q.get("open"), q.get("prev"), q.get("pct"),
    )
    if last is None:
        return flags
    if high and last >= high * 0.998 and (pct or 0) > 0.3:
        flags.append("day high")
    if low and last <= low * 1.002 and (pct or 0) < -0.3:
        flags.append("day low")
    if vwap:
        flags.append("above VWAP" if last >= vwap else "below VWAP")
    if opn and prev and abs((opn - prev) / prev) * 100 >= 0.8:
        flags.append("gap up" if opn > prev else "gap down")
    return flags


def _priority(impact: float, flags: List[str], pct: Optional[float]) -> str:
    hot = any(f in flags for f in ("day high", "day low", "gap up", "gap down"))
    if impact >= 8 or (hot and impact >= 4):
        return "CRITICAL"
    if impact >= 3.5 or hot:
        return "HIGH"
    if impact >= 1.5 or abs(pct or 0) >= 1.2:
        return "MEDIUM"
    return "LOW"


def _sector_key(industry: str) -> str:
    t = (industry or "").upper()
    mapping = [
        ("BANK", "Banking"),
        ("FINANC", "Financials"),
        ("IT", "IT"),
        ("SOFTWARE", "IT"),
        ("OIL", "Energy"),
        ("GAS", "Energy"),
        ("PETROLEUM", "Energy"),
        ("AUTO", "Auto"),
        ("PHARMA", "Pharma"),
        ("FMCG", "FMCG"),
        ("CONSUMER", "FMCG"),
        ("METAL", "Metal"),
        ("STEEL", "Metal"),
        ("REAL", "Realty"),
        ("TELECOM", "Telecom"),
        ("POWER", "Power"),
    ]
    for needle, name in mapping:
        if needle in t:
            return name
    return (industry or "Other")[:24] or "Other"


async def _corporate_near(db, heavies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if db is None or not heavies:
        return []
    by_sym = {h["symbol"]: h for h in heavies}
    by_name = {str(h.get("name") or "").strip().upper(): h for h in heavies if h.get("name")}
    try:
        docs = await db.nse_events.find({}, {"_id": 0}).to_list(length=4000)
    except Exception:
        return []
    from datetime import date as date_cls
    today = date_cls.today().isoformat()
    out = []
    for ev in docs:
        sym = str(ev.get("symbol") or "").strip().upper()
        h = by_sym.get(sym)
        if not h:
            cname = str(ev.get("company_name") or "").strip().upper()
            h = by_name.get(cname)
        if not h:
            continue
        ed = str(ev.get("event_date") or "")[:10]
        if not ed or ed < today:
            continue
        try:
            y, m, d = [int(x) for x in ed.split("-")]
            from datetime import date as D
            days = (D(y, m, d) - D.fromisoformat(today)).days
        except Exception:
            continue
        if days > 7:
            continue
        w = float(h.get("weightage") or 0)
        if w < 0.8 and days > 2:
            continue
        out.append({
            "symbol": h["symbol"],
            "index": h["index"],
            "weightage": w,
            "days": days,
            "event_type": _clip(ev.get("event_type") or ev.get("purpose_raw"), 40),
            "name": h["name"],
        })
    out.sort(key=lambda x: (x["days"], -x["weightage"]))
    return out[:8]


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _quote_dict(last: Any, prev: Any, high=None, low=None, opn=None, vol=None, vwap=None) -> Dict[str, Optional[float]]:
    last_f, prev_f = _num(last), _num(prev)
    pct = None
    if last_f is not None and prev_f:
        pct = round((last_f - prev_f) / prev_f * 100, 2)
    return {
        "last": last_f,
        "prev": prev_f,
        "pct": pct,
        "high": _num(high),
        "low": _num(low),
        "open": _num(opn),
        "volume": _num(vol),
        "vwap": _num(vwap),
    }


def _as_quote(raw: Any) -> Optional[Dict[str, Optional[float]]]:
    if isinstance(raw, dict) and "last" in raw:
        return raw
    if isinstance(raw, (tuple, list)) and raw:
        last = raw[0] if len(raw) > 0 else None
        prev = raw[1] if len(raw) > 1 else None
        return _quote_dict(last, prev)
    return None


async def _yahoo_quotes(symbols: List[str]) -> Dict[str, Dict[str, Optional[float]]]:
    if not symbols:
        return {}
    joined = ",".join(yahoo_symbol(s) for s in symbols)
    url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={joined}"
    out: Dict[str, Dict[str, Optional[float]]] = {}
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
        q = _quote_dict(
            row.get("regularMarketPrice"),
            row.get("regularMarketPreviousClose"),
            row.get("regularMarketDayHigh"),
            row.get("regularMarketDayLow"),
            row.get("regularMarketOpen"),
            row.get("regularMarketVolume"),
        )
        if q.get("last") is not None:
            out[sym] = q
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
                {"_id": 0, "symbol": 1, "company_name": 1, "weightage": 1, "index": 1, "industry": 1},
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
                "industry": _clip(d.get("industry"), 32),
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

    quotes: Dict[str, Dict[str, Optional[float]]] = {}
    for h in heavies:
        raw = kite_map.get(kite_key(h["symbol"])) or kite_map.get(h["symbol"])
        if isinstance(raw, dict):
            q = _quote_from_kite(raw)
            if q.get("last") is not None:
                quotes[h["symbol"]] = q

    missing = [h["symbol"] for h in heavies if h["symbol"] not in quotes]
    if missing:
        y = await _yahoo_quotes(missing)
        for sym, q in y.items():
            got = _as_quote(q)
            if got and got.get("last") is not None:
                quotes[sym] = got

    source = "kite" if kite_map else ("yahoo" if quotes else "none")
    rows: List[Dict[str, Any]] = []
    events: List[Dict[str, Any]] = []
    sector_map: Dict[str, Dict[str, Any]] = {}
    for h in heavies:
        q = quotes.get(h["symbol"])
        if not q or q.get("last") is None:
            continue
        last = q["last"]
        pct = q.get("pct")
        flags = _flags(q)
        try:
            w = float(h.get("weightage") or 0)
        except (TypeError, ValueError):
            w = 0.0
        impact = round(abs(pct or 0) * w / 100.0, 4)
        pri = _priority(abs(pct or 0) * w, flags, pct)
        idx = h.get("index") or ""
        row = {
            "symbol": h["symbol"],
            "name": h["name"],
            "index": idx,
            "weightage": h.get("weightage"),
            "industry": h.get("industry"),
            "last": last,
            "ltp": last,
            "pct": pct,
            "high": q.get("high"),
            "low": q.get("low"),
            "open": q.get("open"),
            "volume": q.get("volume"),
            "vwap": q.get("vwap"),
            "impact": impact,
            "flags": flags,
            "note": seller_note(pct, h.get("weightage")),
        }
        rows.append(row)
        sk = _sector_key(h.get("industry") or "")
        sm = sector_map.setdefault(sk, {"sector": sk, "n": 0, "up": 0, "down": 0, "impact": 0.0, "names": []})
        sm["n"] += 1
        if (pct or 0) > 0.15:
            sm["up"] += 1
        elif (pct or 0) < -0.15:
            sm["down"] += 1
        sm["impact"] += impact
        if abs(pct or 0) >= 0.6:
            sm["names"].append(f"{h['symbol']} {pct:+.1f}%")
        if impact >= 0.08 or is_material_move(w, pct) or any(f in flags for f in ("day high", "day low", "gap up", "gap down")):
            kind = "breakout" if any(f in flags for f in ("day high", "day low")) else "constituent"
            events.append({
                "id": f"move:{h['symbol']}",
                "priority": pri,
                "kind": kind,
                "symbol": h["symbol"],
                "index": idx,
                "impact": impact,
                "event": f"{h['symbol']} {pct:+.2f}%" if pct is not None else h["symbol"],
                "why": (
                    f"Weight {w:.2f}% · estimated index impact {impact:.3f}. "
                    + (", ".join(flags) if flags else "cash move vs previous close.")
                ),
                "buyer": (
                    "Directional / gamma if the move holds."
                    if (pct or 0) > 0 else
                    "Puts / breakdown continuation if sellers keep control."
                ),
                "seller": seller_note(pct, w),
            })

    rows.sort(key=lambda m: score_mover(m.get("weightage"), m.get("pct")), reverse=True)
    movers = [r for r in rows if is_material_move(r.get("weightage"), r.get("pct"))][:12]
    if not movers:
        movers = rows[:8]

    by_idx: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_idx.setdefault(r.get("index") or "?", []).append(r)
    breadth: Dict[str, Any] = {}
    for ix, ix_rows in by_idx.items():
        n = len(ix_rows)
        adv = sum(1 for r in ix_rows if (r.get("pct") or 0) > 0.05)
        dec = sum(1 for r in ix_rows if (r.get("pct") or 0) < -0.05)
        above_vwap = sum(1 for r in ix_rows if r.get("vwap") and r.get("ltp") and r["ltp"] > r["vwap"])
        near_high = sum(1 for r in ix_rows if "day high" in (r.get("flags") or []))
        near_low = sum(1 for r in ix_rows if "day low" in (r.get("flags") or []))
        breadth[ix] = {
            "n": n, "adv": adv, "dec": dec,
            "above_vwap": above_vwap, "near_high": near_high, "near_low": near_low,
            "ad_ratio": round(adv / dec, 2) if dec else (adv if adv else None),
        }
        if n >= 8 and adv >= n * 0.7:
            events.append({
                "id": f"breadth:{ix}:up",
                "priority": "HIGH" if adv >= n * 0.8 else "MEDIUM",
                "kind": "breadth",
                "symbol": ix,
                "index": ix,
                "event": f"{ix} breadth {adv}/{n} advancing",
                "why": "Broad participation — the index move is not a single-name artifact.",
                "buyer": "Trend-following longs have breadth confirmation.",
                "seller": "Short vol / short straddle: directional risk if this persists.",
            })
        elif n >= 8 and dec >= n * 0.7:
            events.append({
                "id": f"breadth:{ix}:dn",
                "priority": "HIGH" if dec >= n * 0.8 else "MEDIUM",
                "kind": "breadth",
                "symbol": ix,
                "index": ix,
                "event": f"{ix} breadth {dec}/{n} declining",
                "why": "Selling is broad across constituents — hidden if you only watch the index print.",
                "buyer": "Put / breakdown setups have participation.",
                "seller": "Elevated tail risk on short-premium index trades.",
            })

    sectors = sorted(sector_map.values(), key=lambda s: -s["impact"])[:8]
    for s in sectors:
        if s["n"] >= 3 and (s["up"] >= 3 or s["down"] >= 3) and s["impact"] >= 0.04:
            side = "bid" if s["up"] >= s["down"] else "offer"
            events.append({
                "id": f"sector:{s['sector']}",
                "priority": "HIGH" if s["impact"] >= 0.12 else "MEDIUM",
                "kind": "sector",
                "symbol": s["sector"],
                "event": f"{s['sector']} {side} — {s['up']} up / {s['down']} down of {s['n']}",
                "why": "; ".join(s["names"][:5]) or "Multiple names in the same industry moving together.",
                "buyer": "Sector momentum can pull the parent index (BANKNIFTY / NIFTY).",
                "seller": "Correlation risk: one-name hedge may not cover a sector bid/offer.",
            })

    news = await _fetch_news()
    for item in news[:6]:
        events.append({
            "id": f"news:{(item.get('title') or '')[:40]}",
            "priority": "MEDIUM",
            "kind": "news",
            "symbol": "",
            "event": (item.get("title") or "")[:160],
            "why": "Wire headline — check whether a heavyweight or macro print is already in the cash tape.",
            "buyer": "News can expand IV and create directional bursts.",
            "seller": "Event / gap risk if the story is index-relevant.",
        })

    corp = await _corporate_near(db, heavies)
    for c in corp[:8]:
        events.append({
            "id": f"corp:{c.get('symbol')}:{c.get('days')}",
            "priority": "HIGH" if (c.get("days") or 9) <= 1 else "MEDIUM",
            "kind": "corporate",
            "symbol": c.get("symbol"),
            "index": c.get("index"),
            "event": f"{c.get('symbol')} {c.get('event_type')} in {c.get('days')}d",
            "why": "Listed on the NSE corporate calendar — event risk is not visible on the OI ladder.",
            "buyer": "IV often expands into the print; directional after the number.",
            "seller": "Short-premium into results / board meetings is classic gap risk.",
        })

    vix = None
    try:
        snaps = getattr(tracker, "last_snapshot", None) or {}
        for snap in (snaps.values() if isinstance(snaps, dict) else []):
            raw_v = snap.get("vix") if isinstance(snap, dict) else getattr(snap, "vix", None)
            if raw_v:
                vix = float(raw_v)
                break
    except Exception:
        vix = None
    if vix is not None and vix >= 16:
        events.append({
            "id": "global:vix",
            "priority": "HIGH" if vix >= 18 else "MEDIUM",
            "kind": "global",
            "symbol": "INDIA VIX",
            "event": f"India VIX {vix:.1f}",
            "why": "Volatility is elevated vs a quiet premium-selling tape.",
            "buyer": "Longer premium / directional bursts more likely.",
            "seller": "Vega and gap risk on short straddles / strangles.",
        })

    rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    events.sort(key=lambda e: rank.get(str(e.get("priority") or "").upper(), 9))
    events = events[:28]

    lines = []
    hi = [e for e in events if str(e.get("priority") or "").upper() in ("CRITICAL", "HIGH")]
    if hi:
        lines.append("HIGH IMPACT — " + "; ".join(e.get("event", "") for e in hi[:4]))
    if breadth.get("NIFTY"):
        b = breadth["NIFTY"]
        lines.append(f"NIFTY breadth {b.get('adv')}/{b.get('n')} advancing, {b.get('above_vwap')} above VWAP.")
    if breadth.get("BANKNIFTY"):
        b = breadth["BANKNIFTY"]
        lines.append(f"BANKNIFTY breadth {b.get('adv')}/{b.get('n')} advancing.")
    if movers:
        lines.append("Heavyweights: " + ", ".join(
            f"{m['symbol']} {m['pct']:+.1f}%" if m.get("pct") is not None else m["symbol"] for m in movers[:5]
        ))
    briefing = " ".join(lines) if lines else (
        "No material outside-the-OI events scored yet (need live quotes + uploaded constituents)."
        if heavies else
        "Upload Nifty 50 / Bank / Sensex constituents in Admin → Upload (Impact Risk) to enable the heavyweight tape."
    )

    pack = {
        "ok": True,
        "movers": movers,
        "news": news,
        "breadth": breadth,
        "sectors": sectors,
        "corporate": corp,
        "events": events,
        "briefing": briefing,
        "vix": vix,
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
