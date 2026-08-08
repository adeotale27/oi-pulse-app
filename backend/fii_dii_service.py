"""
NSE FII/FPI & DII — Capital Market segment (cash equities).

Official APIs (same page as https://www.nseindia.com/reports/fii-dii):
  • /api/fiidiiTradeNse     → NSE-only Capital Market
  • /api/fiidiiTradeReact   → NSE + BSE + MSEI Capital Market

NSE Akamai protection requires:
  1) GET https://www.nseindia.com/  (sets ak_bmsc / bot cookies)
  2) GET /reports/fii-dii           (sets nsit)
  3) GET APIs with browser User-Agent + Referer

Both scheduled 19:31 IST pull and admin Refresh use this same path.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from market_hours import IST, is_holiday, is_weekend, now_ist, previous_trading_day

logger = logging.getLogger(__name__)

NSE_HOME = "https://www.nseindia.com/"
NSE_PAGE = "https://www.nseindia.com/reports/fii-dii"
NSE_API_COMBINED = "https://www.nseindia.com/api/fiidiiTradeReact"
NSE_API_NSE_ONLY = "https://www.nseindia.com/api/fiidiiTradeNse"

PULL_HOUR, PULL_MINUTE = 19, 31
RETRY_UNTIL = dtime(21, 0)
RETRY_SECONDS = 5 * 60

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

API_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_PAGE,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


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
    now = now or now_ist()
    if is_weekend(now) or is_holiday(now):
        return previous_trading_day(now).isoformat()
    if now.time() < dtime(PULL_HOUR, PULL_MINUTE):
        return previous_trading_day(now).isoformat()
    return now.date().isoformat()


def _normalize_rows(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
    out_rows = []
    date_display = None
    date_iso = None
    for raw in rows or []:
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
    return out_rows, date_display, date_iso


def _segment_block(
    rows: List[Dict[str, Any]],
    *,
    key: str,
    label: str,
    date_display: Optional[str],
    date_iso: Optional[str],
) -> Dict[str, Any]:
    fii = next((r for r in rows if "FII" in r["category"].upper()), None)
    dii = next((r for r in rows if r["category"].upper().startswith("DII")), None)
    return {
        "key": key,
        "label": label,
        "as_of_date": date_iso,
        "as_of_date_display": date_display,
        "rows": rows,
        "fii": fii,
        "dii": dii,
    }


async def _warm_session(client: httpx.AsyncClient) -> None:
    """Visit NSE home then the FII/DII report page to obtain session cookies."""
    home = await client.get(NSE_HOME, headers=BROWSER_HEADERS)
    # Home may 403 on some edges; still continue — report page often sets nsit.
    logger.debug("NSE home warm status=%s cookies=%s", home.status_code, list(client.cookies.keys()))
    page_headers = {
        **BROWSER_HEADERS,
        "Referer": NSE_HOME,
        "Sec-Fetch-Site": "same-origin",
    }
    page = await client.get(NSE_PAGE, headers=page_headers)
    page.raise_for_status()
    cookies = set(client.cookies.keys())
    logger.debug("NSE report warm status=%s cookies=%s", page.status_code, sorted(cookies))
    # Soft check — nsit / ak_bmsc are ideal but not always both present.
    if not cookies:
        raise RuntimeError("NSE session warm-up returned no cookies")


async def _get_json(client: httpx.AsyncClient, url: str) -> List[Dict[str, Any]]:
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=API_HEADERS)
            if resp.status_code in (401, 403):
                await _warm_session(client)
                resp = await client.get(url, headers=API_HEADERS)
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, list):
                raise ValueError(f"Unexpected payload from {url}: {type(data)}")
            return data
        except Exception as e:
            last_err = e
            await asyncio.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"Failed GET {url}: {last_err}")


async def _fetch_from_nse() -> Dict[str, Any]:
    async with httpx.AsyncClient(
        timeout=30.0,
        headers=BROWSER_HEADERS,
        follow_redirects=True,
    ) as client:
        await _warm_session(client)
        # Sequential — concurrent NSE API hits after warm-up can flaky-fail.
        nse_raw = await _get_json(client, NSE_API_NSE_ONLY)
        combined_raw = await _get_json(client, NSE_API_COMBINED)

    nse_rows, nse_disp, nse_iso = _normalize_rows(nse_raw)
    comb_rows, comb_disp, comb_iso = _normalize_rows(combined_raw)

    if not nse_rows and not comb_rows:
        raise ValueError("Empty FII/DII rows from both NSE APIs")

    nse_seg = _segment_block(
        nse_rows,
        key="nse",
        label="NSE Capital Market",
        date_display=nse_disp,
        date_iso=nse_iso,
    )
    comb_seg = _segment_block(
        comb_rows,
        key="combined",
        label="NSE + BSE + MSEI Capital Market",
        date_display=comb_disp,
        date_iso=comb_iso,
    )

    # Prefer combined date for the tile face; fall back to NSE-only.
    as_of_display = comb_disp or nse_disp
    as_of_iso = comb_iso or nse_iso
    # Primary nets on the tile = combined (market-wide), else NSE-only.
    primary = comb_seg if comb_rows else nse_seg

    return {
        "as_of_date": as_of_iso,
        "as_of_date_display": as_of_display,
        "segment": "Capital Market",
        "note": (
            "Provisional Capital Market (cash equity) activity from NSE. "
            "Not F&O / derivatives."
        ),
        "source": "nse_fiidiiTradeNse+fiidiiTradeReact",
        "source_url": NSE_PAGE,
        "segments": {
            "nse": nse_seg,
            "combined": comb_seg,
        },
        # Back-compat fields used by the tile face
        "scope": primary["label"],
        "rows": primary["rows"],
        "fii": primary["fii"],
        "dii": primary["dii"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


class FiiDiiService:
    def __init__(self):
        self._db = None
        self._latest: Optional[Dict[str, Any]] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
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
            "ok": bool(latest and (latest.get("rows") or latest.get("segments"))),
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
            doc = await _fetch_from_nse()
            self._latest = doc
            self._last_error = None
            await self._persist(doc)
            logger.info(
                "FII/DII refreshed (%s): as_of=%s combined FII net=%s DII net=%s",
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
        if self._latest and self._latest.get("as_of_date") == expected:
            return False
        return True

    async def _loop(self):
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
                    target = now.replace(
                        hour=PULL_HOUR, minute=PULL_MINUTE, second=0, microsecond=0
                    )
                    if now < target:
                        await asyncio.sleep(max(1, (target - now).total_seconds()))
                        continue
                    await self.refresh(reason="scheduled-1931")
                    if self._needs_scheduled_pull(now_ist()):
                        await asyncio.sleep(RETRY_SECONDS)
                        continue
                now = now_ist()
                if is_weekend(now) or is_holiday(now) or now.time() > RETRY_UNTIL:
                    nxt = now + timedelta(days=1)
                    nxt = nxt.replace(
                        hour=PULL_HOUR, minute=PULL_MINUTE, second=0, microsecond=0
                    ) - timedelta(minutes=6)
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
