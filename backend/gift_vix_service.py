"""
GIFT NIFTY + India VIX external ticker service.

Uses the `yfinance` library (which handles Yahoo cookies + crumb auth) so we
don't get blocked by the raw `query1.finance.yahoo.com` rate-limiting that
plagues cloud IPs.

Polling windows (IST, fixed by user):
  • India VIX     : 09:15 – 15:30  (Mon–Fri, non-holiday)
  • GIFT NIFTY    : 06:30 – 23:30  (Mon–Fri, non-holiday)

Persistence:
  Values are persisted to MongoDB (`extra_tickers` collection) so a backend
  restart doesn't lose the last-known VIX close from the previous session.
  On startup we fetch VIX and GIFT NIFTY ONCE regardless of window so the UI
  always has a baseline number to display.
"""
import asyncio
import logging
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, Optional

import yfinance as yf

from market_hours import IST, is_holiday, is_weekend

logger = logging.getLogger(__name__)

# Fixed default polling windows (IST) — kept intentionally NON-configurable.
VIX_WINDOW  = (dtime(9, 15),  dtime(15, 30))
GIFT_WINDOW = (dtime(6, 30),  dtime(23, 30))

# Poll cadence (seconds). Yahoo rate-limits ~1 req/sec; two symbols → 60s cycle.
POLL_SECONDS = 60

# Yahoo symbols
SYM_VIX  = "^INDIAVIX"
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
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        last = float(info.get("lastPrice") or 0)
        prev = float(info.get("previousClose") or info.get("regularMarketPreviousClose") or 0)
        if last <= 0:
            hist = ticker.history(period="1d", interval="1m")
            if len(hist) > 0:
                last = float(hist["Close"].iloc[-1])
            if prev <= 0 and len(hist) > 0:
                prev = float(hist["Open"].iloc[0])
        change = last - prev if prev else 0.0
        pct = (change / prev * 100) if prev else 0.0
        if last <= 0:
            return None
        return {
            "symbol": symbol,
            "last": round(last, 2),
            "prev_close": round(prev, 2),
            "change": round(change, 2),
            "change_pct": round(pct, 3),
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"yfinance fetch failed for {symbol}: {type(e).__name__}: {e}")
        return None


class ExtraTickers:
    """Holds last-known VIX + GIFT NIFTY values, persisted to Mongo."""

    def __init__(self):
        self.vix: Optional[Dict[str, Any]] = None
        self.gift: Optional[Dict[str, Any]] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._consecutive_failures = 0
        self._db = None  # set via attach_db()

    def attach_db(self, db):
        """Wire in the Mongo db handle so we can persist/read last-known values."""
        self._db = db

    async def _persist(self, key: str, value: Dict[str, Any]):
        if self._db is None or value is None:
            return
        try:
            await self._db.extra_tickers.update_one(
                {"_id": key}, {"$set": {"value": value, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True,
            )
        except Exception as e:
            logger.warning(f"persist extra ticker {key} failed: {e}")

    async def _load_persisted(self):
        if self._db is None:
            return
        try:
            v = await self._db.extra_tickers.find_one({"_id": "vix"})
            g = await self._db.extra_tickers.find_one({"_id": "gift_nifty"})
            if v and v.get("value"):
                self.vix = v["value"]
            if g and g.get("value"):
                self.gift = g["value"]
                self.gift["label"] = "GIFT NIFTY"
        except Exception as e:
            logger.warning(f"load persisted extra tickers failed: {e}")

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

    async def _fetch_vix_and_persist(self):
        v = await asyncio.to_thread(_yf_last_price, SYM_VIX)
        if v:
            self.vix = v
            await self._persist("vix", v)
            return True
        return False

    async def _fetch_gift_and_persist(self):
        g = await asyncio.to_thread(_yf_last_price, SYM_GIFT_PRIMARY)
        if g:
            g["label"] = "GIFT NIFTY"
            self.gift = g
            await self._persist("gift_nifty", g)
            return True
        return False

    async def force_refresh(self) -> Dict[str, Any]:
        """One-shot fetch triggered by API (e.g. admin action)."""
        await self._fetch_vix_and_persist()
        await self._fetch_gift_and_persist()
        return self.snapshot()

    async def start(self):
        if self._running:
            return
        self._running = True
        # Warm cache from Mongo BEFORE first live fetch so UI has data instantly.
        await self._load_persisted()
        # Boot-time fetch of BOTH symbols regardless of window, so the header
        # always has a value to show even when the app boots after 15:30 IST.
        try:
            await self._fetch_vix_and_persist()
        except Exception as e:
            logger.warning(f"boot VIX fetch failed: {e}")
        try:
            await self._fetch_gift_and_persist()
        except Exception as e:
            logger.warning(f"boot GIFT fetch failed: {e}")
        self._task = asyncio.create_task(self._loop())
        logger.info("ExtraTickers loop started (VIX + GIFT NIFTY via yfinance)")

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
                ok = True
                if _in_window(now_ist, VIX_WINDOW):
                    got_v = await self._fetch_vix_and_persist()
                    if not got_v:
                        ok = False
                if _in_window(now_ist, GIFT_WINDOW):
                    got_g = await self._fetch_gift_and_persist()
                    if not got_g:
                        ok = False
                if ok:
                    self._consecutive_failures = 0
                else:
                    self._consecutive_failures += 1
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"ExtraTickers loop error: {e}")
                self._consecutive_failures += 1

            sleep_s = min(POLL_SECONDS * (2 ** min(self._consecutive_failures, 3)), 300)
            await asyncio.sleep(sleep_s)


extra_tickers = ExtraTickers()
