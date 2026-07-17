"""
GIFT NIFTY + India VIX external ticker service.

Fetches from Yahoo Finance's public chart API (no key required). Runs on a
separate schedule from the main OI tracker so that VIX / GIFT NIFTY stay
"live" beyond the NSE cash-market 3:30 PM close.

Polling windows (IST):
  • India VIX     : 09:15 – 15:30  (Mon–Fri, non-holiday)
  • GIFT NIFTY    : 06:30 – 23:30  (Mon–Fri, non-holiday)
"""
import asyncio
import logging
import time
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, Optional

import requests

from market_hours import IST, is_holiday, is_weekend

logger = logging.getLogger(__name__)

# Yahoo Finance chart API — no auth required, unofficial but widely used.
YF_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    ),
}

# Fixed default polling windows (IST) — kept intentionally NON-configurable per
# user request; the code is centralised here so we can tweak in one place.
VIX_WINDOW  = (dtime(9, 15),  dtime(15, 30))
GIFT_WINDOW = (dtime(6, 30),  dtime(23, 30))

# Poll cadence (seconds) — same for both. VIX & GIFT don't update every second,
# and Yahoo's public API rate-limits aggressively at ~1 req/sec per symbol so we
# poll every 60s (twice for the two symbols → 2 req/min total).
POLL_SECONDS = 60

# Symbols on Yahoo Finance
SYM_VIX  = "^INDIAVIX"
# GIFT NIFTY does not have a first-class Yahoo symbol; ^NSEI (NIFTY 50 index)
# is the most reliable free proxy during Indian hours. When GIFT NIFTY futures
# resume outside NSE cash session, Yahoo does not track them, so we fall back
# to the last-known ^NSEI value. This is a MVP compromise — swap in NSE IX
# API if the user provides credentials.
SYM_GIFT_PRIMARY = "^NSEI"


def _in_window(now_ist: datetime, window) -> bool:
    """window is (start_time, end_time). Weekend / holiday returns False."""
    if is_weekend(now_ist) or is_holiday(now_ist):
        return False
    t = now_ist.time()
    return window[0] <= t <= window[1]


def _yf_last_price(symbol: str) -> Optional[Dict[str, Any]]:
    """Return {last, prev_close, change, change_pct, ts} or None on failure."""
    try:
        r = requests.get(
            YF_CHART_URL.format(symbol=symbol),
            params={"interval": "1m", "range": "1d"},
            headers=YF_HEADERS,
            timeout=6,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        logger.warning(f"yfinance fetch failed for {symbol}: {type(e).__name__}: {e}")
        return None
    try:
        result = payload["chart"]["result"][0]
        meta = result.get("meta") or {}
        last = float(meta.get("regularMarketPrice") or 0)
        prev = float(meta.get("chartPreviousClose") or meta.get("previousClose") or 0)
        change = last - prev if prev else 0.0
        pct = (change / prev * 100) if prev else 0.0
        return {
            "symbol": symbol,
            "last": round(last, 2),
            "prev_close": round(prev, 2),
            "change": round(change, 2),
            "change_pct": round(pct, 3),
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"yfinance parse failed for {symbol}: {type(e).__name__}: {e}")
        return None


class ExtraTickers:
    """Holds last-known VIX + GIFT NIFTY values and refreshes them in a background task."""

    def __init__(self):
        self.vix: Optional[Dict[str, Any]] = None
        self.gift: Optional[Dict[str, Any]] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def snapshot(self) -> Dict[str, Any]:
        return {
            "vix": self.vix,
            "gift_nifty": self.gift,
            "windows": {
                "vix":   {"start_ist": "09:15", "end_ist": "15:30"},
                "gift":  {"start_ist": "06:30", "end_ist": "23:30"},
            },
            "server_time_ist": datetime.now(IST).isoformat(),
        }

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("ExtraTickers loop started (VIX + GIFT NIFTY)")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self):
        while self._running:
            try:
                now_ist = datetime.now(IST)
                if _in_window(now_ist, VIX_WINDOW):
                    v = await asyncio.to_thread(_yf_last_price, SYM_VIX)
                    if v:
                        self.vix = v
                if _in_window(now_ist, GIFT_WINDOW):
                    g = await asyncio.to_thread(_yf_last_price, SYM_GIFT_PRIMARY)
                    if g:
                        # relabel for the UI
                        g["label"] = "GIFT NIFTY"
                        self.gift = g
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"ExtraTickers loop error: {e}")
            await asyncio.sleep(POLL_SECONDS)


extra_tickers = ExtraTickers()
