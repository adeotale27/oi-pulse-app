"""
NSE FII/FPI & DII cash-market activity.

Source: https://www.nseindia.com/api/fiidiiTradeReact
  (warmed via https://www.nseindia.com/reports/fii-dii cookies)

NSE publishes provisional figures after close, typically 16:00–19:30 IST.
We pull at 19:31 IST on trading days, with a short retry window if the
feed is still on the previous session date.

Values are ₹ crores for the combined NSE+BSE+MSEI capital-market segment
(what the React API returns).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from market_hours import IST, is_holiday, is_weekend, now_ist, previous_trading_day

logger = logging.getLogger(__name__)

NSE_HOME = "https://www.nseindia.com"
NSE_PAGE = "https://www.nseindia.com/reports/fii-dii"
NSE_API = "https://www.nseindia.com/api/fiidiiTradeReact"

# Pull window: primary 19:31, then retry every 5 min until 21:00 if still stale.
PULL_HOUR, PULL_MINUTE = 19, 31
RETRY_UNTIL = dtime(21, 0)
RETRY_SECONDS = 5 * 60

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _parse_num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None


def _parse_nse_date(s: str) -> Optional[str]:
    """'07-Aug-2026' → '2026-08-07'."""
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            continue
    return None


def _expected_as_of(now: Optional[datetime] = None) -> str:
    """Trading day whose FII/DII print we expect after the 19:31 pull."""
    now = now or now_ist()
    if is_weekend(now) or is_holiday(now):
        return previous_trading_day(now).isoformat()
    # Before pull time on a trading day → still expect previous session
    if now.time() < dtime(PULL_HOUR, PULL_MINUTE):
        return previous_trading_day(now).isoformat()
    return now.date().isoformat()


async def _fetch_from_nse() -> List[Dict[str, Any]]:
    headers = {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(
        timeout=25.0,
        headers=headers,
        follow_redirects=True,
    ) as client:
        # Cookie warm-up — NSE API 401/403 without a prior page hit.
        r = await client.get(NSE_PAGE)
        r.raise_for_status()
        api = await client.get(
            NSE_API,
            headers={**headers, "Referer": NSE_PAGE},
        )
        api.raise_for_status()
        data = api.json()
        if not isinstance(data, list):
            raise ValueError(f"Unexpected FII/DII payload type: {type(data)}")
        return data


def _normalize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    out_rows = []
    date_display = None
    date_iso = None
    for raw in rows:
        cat = str(raw.get("category") or "").strip()
        if not cat:
            continue
        d_disp = str(raw.get("date") or "").strip()
        d_iso = _parse_nse_date(d_disp)
        if d_disp and not date_display:
            date_display = d_disp
            date_iso = d_iso
        out_rows.append({
            "category": cat,
            "buy": _parse_num(raw.get("buyValue")),
            "sell": _parse_num(raw.get("sellValue")),
            "net": _parse_num(raw.get("netValue")),
            "date": d_disp,
            "date_iso": d_iso,
        })
    fii = next((r for r in out_rows if "FII" in r["category"].upper()), None)
    dii = next((r for r in out_rows if r["category"].upper().startswith("DII")), None)
    return {
        "as_of_date": date_iso,
        "as_of_date_display": date_display,
        "scope": "NSE + BSE + MSEI",
        "source": "nse_fiidiiTradeReact",
        "source_url": NSE_PAGE,
        "rows": out_rows,
        "fii": fii,
        "dii": dii,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


class FiiDiiService:
    def __init__(self):
        self._db = None
        self._latest: Optional[Dict[str, Any]] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_attempt_date: Optional[str] = None  # IST date of last scheduled attempt
        self._last_error: Optional[str] = None

    def attach_db(self, db):
        self._db = db

    def snapshot(self) -> Dict[str, Any]:
        expected = _expected_as_of()
        latest = self._latest
        stale = False
        if latest and latest.get("as_of_date") and expected:
            stale = latest["as_of_date"] < expected
        return {
            "ok": bool(latest and latest.get("rows")),
            "expected_as_of": expected,
            "stale": stale,
            "last_error": self._last_error,
            "pull_ist": f"{PULL_HOUR:02d}:{PULL_MINUTE:02d}",
            "data": latest,
        }

    async def _persist(self, doc: Dict[str, Any]):
        if self._db is None or not doc:
            return
        try:
            payload = {**doc, "updated_at": datetime.now(timezone.utc).isoformat()}
            await self._db.fii_dii.update_one(
                {"_id": "latest"},
                {"$set": payload},
                upsert=True,
            )
            if doc.get("as_of_date"):
                await self._db.fii_dii.update_one(
                    {"_id": doc["as_of_date"]},
                    {"$set": payload},
                    upsert=True,
                )
        except Exception as e:
            logger.warning("persist fii_dii failed: %s", e)

    async def _load_persisted(self):
        if self._db is None:
            return
        try:
            doc = await self._db.fii_dii.find_one({"_id": "latest"})
            if doc:
                doc.pop("_id", None)
                self._latest = doc
        except Exception as e:
            logger.warning("load fii_dii failed: %s", e)

    async def refresh(self, *, reason: str = "manual") -> Dict[str, Any]:
        try:
            raw = await _fetch_from_nse()
            doc = _normalize(raw)
            if not doc.get("rows"):
                raise ValueError("Empty FII/DII rows")
            self._latest = doc
            self._last_error = None
            await self._persist(doc)
            logger.info(
                "FII/DII refreshed (%s): as_of=%s FII net=%s DII net=%s",
                reason,
                doc.get("as_of_date_display"),
                (doc.get("fii") or {}).get("net"),
                (doc.get("dii") or {}).get("net"),
            )
            return self.snapshot()
        except Exception as e:
            self._last_error = str(e)[:240]
            logger.warning("FII/DII refresh failed (%s): %s", reason, e)
            return self.snapshot()

    def _needs_scheduled_pull(self, now: datetime) -> bool:
        if is_weekend(now) or is_holiday(now):
            return False
        t = now.time()
        if t < dtime(PULL_HOUR, PULL_MINUTE):
            return False
        if t > RETRY_UNTIL:
            return False
        expected = now.date().isoformat()
        # Already have today's print
        if self._latest and self._latest.get("as_of_date") == expected:
            return False
        return True

    async def _loop(self):
        # Boot: if after pull time and missing today's data, try once.
        try:
            now = now_ist()
            if self._needs_scheduled_pull(now):
                await self.refresh(reason="boot-catchup")
            elif not self._latest:
                await self.refresh(reason="boot-baseline")
        except Exception as e:
            logger.warning("FII/DII boot pull: %s", e)

        while self._running:
            try:
                now = now_ist()
                if self._needs_scheduled_pull(now):
                    # Align first shot near :31, then retry cadence
                    target = now.replace(
                        hour=PULL_HOUR, minute=PULL_MINUTE, second=0, microsecond=0
                    )
                    if now < target:
                        await asyncio.sleep(max(1, (target - now).total_seconds()))
                        continue
                    await self.refresh(reason="scheduled-1931")
                    # If still not today's date, wait and retry
                    if self._needs_scheduled_pull(now_ist()):
                        await asyncio.sleep(RETRY_SECONDS)
                        continue
                # Sleep until next interesting moment
                now = now_ist()
                if is_weekend(now) or is_holiday(now) or now.time() > RETRY_UNTIL:
                    # Wake next trading day ~6 min before pull
                    nxt = now + timedelta(days=1)
                    nxt = nxt.replace(hour=PULL_HOUR, minute=PULL_MINUTE, second=0, microsecond=0) - timedelta(minutes=6)
                    while is_weekend(nxt) or is_holiday(nxt):
                        nxt = nxt + timedelta(days=1)
                    delay = max(30, (nxt - now_ist()).total_seconds())
                    await asyncio.sleep(min(delay, 3600))
                elif now.time() < dtime(PULL_HOUR, PULL_MINUTE):
                    target = now.replace(
                        hour=PULL_HOUR, minute=PULL_MINUTE, second=0, microsecond=0
                    )
                    await asyncio.sleep(max(5, min((target - now).total_seconds(), 900)))
                else:
                    await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("FII/DII loop error: %s", e)
                await asyncio.sleep(60)

    async def start(self):
        if self._running:
            return
        self._running = True
        await self._load_persisted()
        self._task = asyncio.create_task(self._loop())
        logger.info("FiiDiiService started — daily pull %02d:%02d IST", PULL_HOUR, PULL_MINUTE)

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except Exception:
                pass
            self._task = None


fii_dii = FiiDiiService()
