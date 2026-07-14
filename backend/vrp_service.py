"""
Volatility Risk Premium (VRP) service.

Given an index name and a live KiteService, computes:
  * HV_10  — 10-session close-to-close annualised realised vol
  * HV_20  — 20-session close-to-close annualised realised vol
  * Parkinson_10 — 10-session Parkinson high-low range vol
  * VRP_10 = IV − HV_10
  * VRP_20 = IV − HV_20
where IV is India VIX (or the caller's mean-IV proxy).

Also returns a rolling series of daily VRP values for the last N days so the
frontend can render a sparkline.

Kite historical_data is called with the day interval and cached in-memory for
6 hours (EOD data doesn't change intraday, so this bounds API usage).
"""

from __future__ import annotations
import math
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Trading days in a year (India). Used for annualisation.
TRADING_DAYS = 252

# In-memory cache. Keyed by (index, days). Values expire after CACHE_TTL secs.
_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 6 * 3600  # 6 hours

# Which tradingsymbol / exchange to look up for each index. The KiteService
# stores instruments in `instruments_df` — we scan it for these.
INDEX_LOOKUPS = {
    "NIFTY":     {"tradingsymbol": "NIFTY 50",   "exchange": "NSE"},
    "SENSEX":    {"tradingsymbol": "SENSEX",     "exchange": "BSE"},
    "BANKNIFTY": {"tradingsymbol": "NIFTY BANK", "exchange": "NSE"},
}


def _index_token(kite_service, index_name: str) -> Optional[int]:
    """Locate the index instrument_token in the KiteService instruments_df."""
    if not kite_service:
        return None
    try:
        kite_service._load_instruments()
    except Exception as e:
        logger.error(f"[vrp] load_instruments failed: {e}")
        return None
    look = INDEX_LOOKUPS.get(index_name)
    if not look:
        return None
    df = kite_service.instruments_df
    if df is None or df.empty:
        return None
    hit = df[(df["tradingsymbol"] == look["tradingsymbol"]) & (df["exchange"] == look["exchange"])]
    if hit.empty:
        # Fallback: match just by tradingsymbol (older instrument dumps may not
        # have a clean `exchange` column value).
        hit = df[df["tradingsymbol"] == look["tradingsymbol"]]
    if hit.empty:
        return None
    try:
        return int(hit.iloc[0]["instrument_token"])
    except Exception:
        return None


def _annualised_std_of_log_returns(closes: List[float]) -> Optional[float]:
    """Standard close-to-close realised vol in % (annualised)."""
    if not closes or len(closes) < 3:
        return None
    rets: List[float] = []
    for i in range(1, len(closes)):
        c0 = closes[i - 1]
        c1 = closes[i]
        if c0 and c0 > 0 and c1 and c1 > 0:
            rets.append(math.log(c1 / c0))
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)  # sample std
    std = math.sqrt(var)
    return std * math.sqrt(TRADING_DAYS) * 100


def _parkinson_vol(highs: List[float], lows: List[float]) -> Optional[float]:
    """Parkinson high-low volatility in % (annualised)."""
    if not highs or not lows or len(highs) != len(lows) or len(highs) < 3:
        return None
    ln2 = math.log(2)
    terms = []
    for h, l in zip(highs, lows):
        if h and l and h > 0 and l > 0 and h >= l:
            terms.append(math.log(h / l) ** 2)
    if not terms:
        return None
    val = math.sqrt((1.0 / (4 * ln2)) * (sum(terms) / len(terms)))
    return val * math.sqrt(TRADING_DAYS) * 100


def _classify_vrp(vrp: Optional[float]) -> Dict[str, str]:
    """Zone classification per the trader's spec:
       VRP > +2      → rich premium, sell size
       +0.5 to +2    → fair premium
       -0.5 to +0.5  → thin edge, reduce size
       < -0.5        → negative edge, skip / defensive-only
    """
    if vrp is None:
        return {"regime": "unknown", "label": "—", "tone": "slate", "zone": "unknown"}
    if vrp >= 2:
        return {"regime": "rich", "label": "Rich premium — sell size", "tone": "emerald", "zone": "rich"}
    if vrp >= 0.5:
        return {"regime": "fair", "label": "Fair premium", "tone": "emerald", "zone": "fair"}
    if vrp >= -0.5:
        return {"regime": "thin", "label": "Thin edge — reduce size", "tone": "amber", "zone": "thin"}
    return {"regime": "poor", "label": "HV outrunning IV — SKIP", "tone": "rose", "zone": "poor"}


def _classify_trend(series: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Look at the last 5 VRP points and label the trend.

    Returns { direction, slope_per_day, label } where direction is one of
    'rising' / 'falling' / 'flat' and label is a short human-readable summary
    the UI can render as a chip.
    """
    if not series or len(series) < 3:
        return {"direction": "unknown", "slope": None, "label": "—"}
    tail = series[-5:] if len(series) >= 5 else series
    xs = list(range(len(tail)))
    ys = [p.get("vrp_10") for p in tail if p.get("vrp_10") is not None]
    if len(ys) < 3:
        return {"direction": "unknown", "slope": None, "label": "—"}
    # Simple OLS slope over the last N points
    n = len(ys)
    mean_x = sum(xs[:n]) / n
    mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n)) or 1
    slope = num / den
    latest = ys[-1]
    if slope <= -0.15:
        direction = "falling"
        if latest <= 0:
            label = "Grinding into negative — reduce"
        else:
            label = "Compressing toward zero"
    elif slope >= 0.15:
        direction = "rising"
        if latest >= 1:
            label = "Expanding — sell opportunity"
        else:
            label = "Recovering off lows"
    else:
        direction = "flat"
        label = "Flat"
    return {"direction": direction, "slope": round(slope, 3), "label": label}


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


async def compute_vrp(
    kite_service,
    db,
    index_name: str,
    iv_pct: Optional[float],
    days: int = 30,
) -> Dict[str, Any]:
    """Main entry point. Returns full VRP dictionary suitable for JSON response."""
    idx = index_name.upper()

    # ------ Cache check ------
    cache_key = f"{idx}:{days}"
    cached = _CACHE.get(cache_key)
    now = _now_ts()
    hist: Optional[List[Dict[str, Any]]] = None
    if cached and (now - cached["cached_at"]) < CACHE_TTL_SECONDS:
        hist = cached["hist"]

    # ------ Fetch from Kite if cache miss ------
    if hist is None:
        token = _index_token(kite_service, idx)
        if not token:
            return _empty_response(idx, iv_pct, reason="no_kite_token")
        to_dt   = datetime.now()
        from_dt = to_dt - timedelta(days=max(45, days + 15))  # buffer for weekends/holidays
        try:
            import asyncio
            hist = await asyncio.wait_for(
                asyncio.to_thread(
                    kite_service.kite.historical_data,
                    token, from_dt, to_dt, "day",
                ),
                timeout=15.0,
            )
        except asyncio.TimeoutError:
            logger.error(f"[vrp] Kite historical_data timeout for {idx}")
            return _empty_response(idx, iv_pct, reason="kite_timeout")
        except Exception as e:
            logger.error(f"[vrp] Kite historical_data failed for {idx}: {type(e).__name__}: {e}")
            return _empty_response(idx, iv_pct, reason=f"{type(e).__name__}: {e}")

        if not hist or len(hist) < 12:
            return _empty_response(idx, iv_pct, reason="insufficient_history")

        _CACHE[cache_key] = {"hist": hist, "cached_at": now}

    # Sort ascending by date just in case.
    hist_sorted = sorted(hist, key=lambda r: r.get("date"))

    # ------ Compute HVs over the full history so we can build a rolling series ------
    closes = [float(r.get("close") or 0) for r in hist_sorted]
    highs  = [float(r.get("high")  or 0) for r in hist_sorted]
    lows   = [float(r.get("low")   or 0) for r in hist_sorted]
    dates  = [str(r.get("date"))[:10] for r in hist_sorted]

    hv_10 = _annualised_std_of_log_returns(closes[-11:]) if len(closes) >= 11 else None
    hv_20 = _annualised_std_of_log_returns(closes[-21:]) if len(closes) >= 21 else None
    park_10 = _parkinson_vol(highs[-10:], lows[-10:]) if len(highs) >= 10 else None

    # Best single-number HV: prefer HV_20 (more stable), fall back to HV_10, then Parkinson.
    hv_reference = hv_20 if hv_20 is not None else (hv_10 if hv_10 is not None else park_10)

    vrp_10 = (iv_pct - hv_10) if (iv_pct is not None and hv_10 is not None) else None
    vrp_20 = (iv_pct - hv_20) if (iv_pct is not None and hv_20 is not None) else None
    # Use VRP_10 as the PRIMARY trading signal — it responds faster to recent
    # HV regime changes, which is what determines whether short-DTE writers
    # are actually being over-paid or under-paid right this week.
    vrp_main = vrp_10 if vrp_10 is not None else vrp_20

    # ------ Build the rolling series (last N points of VRP_10) ------
    #   For each date i (starting at index 10), compute HV_10 for the 10 sessions
    #   ending at i, and diff against IV. Since we don't have historical IV per
    #   day (India VIX archive) we use TODAY's IV throughout — this makes the
    #   sparkline a "VRP would have been X on this day if IV was the same as
    #   now" chart, which is still useful for showing HV compression / expansion.
    series: List[Dict[str, Any]] = []
    if iv_pct is not None:
        window = 10
        for i in range(window, len(closes)):
            hv_i = _annualised_std_of_log_returns(closes[i - window:i + 1])
            if hv_i is None:
                continue
            series.append({
                "date": dates[i],
                "hv_10": round(hv_i, 3),
                "vrp_10": round(iv_pct - hv_i, 3),
            })
        # keep last `days` points
        series = series[-days:]

    # ------ Persist EOD snapshot in Mongo (one row per index per trading day) ------
    try:
        today_date = dates[-1] if dates else datetime.now(timezone.utc).date().isoformat()
        await db.vrp_snapshots.update_one(
            {"index": idx, "date": today_date},
            {"$set": {
                "index": idx,
                "date": today_date,
                "iv": iv_pct,
                "hv_10": hv_10,
                "hv_20": hv_20,
                "parkinson_10": park_10,
                "vrp_10": vrp_10,
                "vrp_20": vrp_20,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"[vrp] persist failed for {idx}: {e}")

    classification = _classify_vrp(vrp_main)
    trend = _classify_trend(series)

    return {
        "index": idx,
        "iv": iv_pct,
        "hv_10": hv_10,
        "hv_20": hv_20,
        "parkinson_10": park_10,
        "vrp_10": vrp_10,
        "vrp_20": vrp_20,
        "vrp": vrp_main,
        "regime": classification["regime"],
        "zone": classification["zone"],
        "label": classification["label"],
        "tone": classification["tone"],
        "trend": trend,
        "series": series,
        "as_of": dates[-1] if dates else None,
        "source": "kite_historical",
    }


def _empty_response(index_name: str, iv_pct: Optional[float], reason: str) -> Dict[str, Any]:
    return {
        "index": index_name,
        "iv": iv_pct,
        "hv_10": None,
        "hv_20": None,
        "parkinson_10": None,
        "vrp_10": None,
        "vrp_20": None,
        "vrp": None,
        "regime": "unknown",
        "label": "—",
        "tone": "slate",
        "series": [],
        "as_of": None,
        "source": None,
        "error": reason,
    }
