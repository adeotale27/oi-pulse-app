"""
GIFT NIFTY + India VIX external ticker service.

Priority for GIFT NIFTY:
  1. Kite Connect quote  →  NSEIX:GIFT NIFTY  (correct Zerodha instrument)
  2. Yahoo Finance fallbacks (approximate / proxy if Kite unavailable)

India VIX:
  1. Kite  →  NSE:INDIA VIX
  2. Yahoo →  ^INDIAVIX

Polling windows (IST):
  • India VIX     : 09:15 – 15:40  (Mon–Fri, non-holiday; same as NSE cash/F&O)
  • GIFT NIFTY    : 06:30 – 15:40 and 16:35 – 02:45 next day
                    (Mon–Fri evening; Fri evening continues into Sat 02:45)

Persistence:
  Values are persisted to MongoDB (`extra_tickers` collection) so a backend
  restart doesn't lose the last-known close. On startup we fetch once
  regardless of window so the UI always has a baseline.
"""
import asyncio
import logging
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, Optional, Callable

from market_hours import IST, is_holiday, is_weekend, now_ist

logger = logging.getLogger(__name__)

VIX_WINDOW = (dtime(9, 15), dtime(15, 40))

POLL_SECONDS = 60

# Correct Kite Connect quote keys (confirmed on Zerodha forum / instruments dump)
KITE_GIFT_SYMBOL = "NSEIX:GIFT NIFTY"
KITE_VIX_SYMBOL = "NSE:INDIA VIX"

# Yahoo fallbacks — ^NSEI is Nifty 50 spot (NOT true GIFT); only used when Kite fails.
SYM_VIX_YF = "^INDIAVIX"
SYM_GIFT_YF_CANDIDATES = [
    "^NSEI",       # Nifty 50 proxy (last resort)
]


def _time_in_range(t: dtime, start: dtime, end: dtime) -> bool:
    if start <= end:
        return start <= t <= end
    return t >= start or t <= end


def is_gift_session_open(dt: datetime = None) -> bool:
    """True during GIFT NIFTY trading windows, including Fri evening → Sat 02:45."""
    dt = dt or now_ist()
    t = dt.time()

    # Morning + evening start on a regular trading day
    if not is_weekend(dt) and not is_holiday(dt):
        if dtime(6, 30) <= t <= dtime(15, 40):
            return True
        if t >= dtime(16, 35):
            return True

    # After-midnight tail (00:00–02:45) belongs to the previous calendar day's evening session.
    # Tue–Sat mornings cover Mon–Fri evenings (Fri evening → Sat 02:45).
    if t <= dtime(2, 45) and dt.weekday() in (1, 2, 3, 4, 5):
        prev = dt - timedelta(days=1)
        if prev.weekday() < 5 and not is_holiday(prev):
            return True
    return False


def is_vix_session_open(dt: datetime = None) -> bool:
    dt = dt or now_ist()
    if is_weekend(dt) or is_holiday(dt):
        return False
    return _time_in_range(dt.time(), VIX_WINDOW[0], VIX_WINDOW[1])


def _yf_last_price(symbol: str) -> Optional[Dict[str, Any]]:
    """Yahoo last price. Must never hang the API process — short timeouts only."""
    import socket
    try:
        import yfinance as yf
    except Exception as e:
        logger.warning("yfinance not available: %s", e)
        return None
    prev_to = socket.getdefaulttimeout()
    socket.setdefaulttimeout(6)
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
            "source": "yahoo",
        }
    except Exception as e:
        logger.warning(f"yfinance fetch failed for {symbol}: {type(e).__name__}: {e}")
        return None
    finally:
        socket.setdefaulttimeout(prev_to)


def _kite_quote_price(kite, quote_key: str) -> Optional[Dict[str, Any]]:
    """Fetch LTP + OHLC via Kite quote(exchange:tradingsymbol)."""
    try:
        q = kite.quote(quote_key)
        data = q.get(quote_key) if isinstance(q, dict) else None
        if not data:
            logger.warning(f"kite.quote({quote_key}) returned empty")
            return None
        last = float(data.get("last_price") or 0)
        ohlc = data.get("ohlc") or {}
        prev = float(ohlc.get("close") or 0)
        if last <= 0:
            return None
        change = last - prev if prev else 0.0
        pct = (change / prev * 100) if prev else 0.0
        return {
            "symbol": quote_key,
            "last": round(last, 2),
            "prev_close": round(prev, 2),
            "change": round(change, 2),
            "change_pct": round(pct, 3),
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": "kite",
        }
    except Exception as e:
        logger.warning(f"kite.quote({quote_key}) failed: {type(e).__name__}: {e}")
        return None


class ExtraTickers:
    """Holds last-known VIX + GIFT NIFTY values, persisted to Mongo."""

    def __init__(self):
        self.vix: Optional[Dict[str, Any]] = None
        self.gift: Optional[Dict[str, Any]] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._consecutive_failures = 0
        self._db = None
        # Optional callable → KiteConnect instance (or None). Set from server/tracker.
        self._kite_provider: Optional[Callable[[], Any]] = None

    def attach_db(self, db):
        self._db = db

    def attach_kite_provider(self, provider: Callable[[], Any]):
        """provider() should return a live kiteconnect.KiteConnect or None."""
        self._kite_provider = provider

    def _get_kite(self):
        if not self._kite_provider:
            return None
        try:
            return self._kite_provider()
        except Exception:
            return None

    async def _persist(self, key: str, value: Dict[str, Any]):
        if self._db is None or value is None:
            return
        try:
            await self._db.extra_tickers.update_one(
                {"_id": key},
                {"$set": {"value": value, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
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
                "vix": {
                    "start_ist": "09:15",
                    "end_ist": "15:40",
                    "display": "09:15–15:40",
                    "open_now": is_vix_session_open(),
                },
                "gift": {
                    "start_ist": "06:30",
                    "end_ist": "02:45",
                    "display": "06:30–15:40 & 16:35–02:45",
                    "sessions": [
                        {"start_ist": "06:30", "end_ist": "15:40"},
                        {"start_ist": "16:35", "end_ist": "02:45"},
                    ],
                    "open_now": is_gift_session_open(),
                    "kite_symbol": KITE_GIFT_SYMBOL,
                },
            },
            "server_time_ist": datetime.now(IST).isoformat(),
        }

    async def _fetch_vix_and_persist(self) -> bool:
        kite = self._get_kite()
        result = None
        if kite is not None:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(_kite_quote_price, kite, KITE_VIX_SYMBOL),
                    timeout=8,
                )
            except Exception as e:
                logger.warning("kite VIX quote timed out/failed: %s", e)
        if not result:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(_yf_last_price, SYM_VIX_YF),
                    timeout=8,
                )
            except Exception as e:
                logger.warning("yahoo VIX timed out/failed: %s", e)
        if result:
            self.vix = result
            await self._persist("vix", result)
            return True
        return False

    async def _fetch_gift_and_persist(self) -> bool:
        kite = self._get_kite()
        result = None
        if kite is not None:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(_kite_quote_price, kite, KITE_GIFT_SYMBOL),
                    timeout=8,
                )
            except Exception as e:
                logger.warning("kite GIFT quote timed out/failed: %s", e)
            if result:
                result["label"] = "GIFT NIFTY"
                result["note"] = None
        if not result:
            # Yahoo has no first-class GIFT symbol — fall back to Nifty 50 proxy and mark it.
            for sym in SYM_GIFT_YF_CANDIDATES:
                try:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(_yf_last_price, sym),
                        timeout=8,
                    )
                except Exception as e:
                    logger.warning("yahoo GIFT proxy %s timed out/failed: %s", sym, e)
                    result = None
                if result:
                    result["label"] = "GIFT NIFTY"
                    result["note"] = (
                        f"Proxy via {sym} — enable Kite LIVE for true {KITE_GIFT_SYMBOL}"
                    )
                    result["is_proxy"] = True
                    break
        if result:
            self.gift = result
            await self._persist("gift_nifty", result)
            return True
        return False

    async def force_refresh(self) -> Dict[str, Any]:
        await self._fetch_vix_and_persist()
        await self._fetch_gift_and_persist()
        return self.snapshot()

    async def start(self):
        if self._running:
            return
        self._running = True
        await self._load_persisted()
        # Do NOT await Yahoo/Kite here — that hung k8s readiness for 10 minutes.
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "ExtraTickers started — GIFT via Kite %s (Yahoo fallback), VIX via Kite/Yahoo",
            KITE_GIFT_SYMBOL,
        )

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
                now = now_ist()
                ok = True
                if is_vix_session_open(now):
                    if not await self._fetch_vix_and_persist():
                        ok = False
                if is_gift_session_open(now):
                    if not await self._fetch_gift_and_persist():
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
