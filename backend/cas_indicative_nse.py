"""NSE Indicative NIFTY 50 — structured JSON, not HTML scrape.

The CAS page widget is fed by GET /api/marketStatus → indicativenifty50.
Same cookie warmup pattern as FII/DII (Akamai).
"""

from __future__ import annotations

import logging
from datetime import datetime, time as dtime
from typing import Any, Dict, Optional, Tuple

import httpx

from cas_rule_expiry_automation.time_utils import IST, get_ist_now

logger = logging.getLogger(__name__)

NSE_HOME = "https://www.nseindia.com/"
NSE_CAS_PAGE = "https://www.nseindia.com/market-data/closing-auction-session"
NSE_MARKET_STATUS = "https://www.nseindia.com/api/marketStatus"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

API_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_CAS_PAGE,
    "X-Requested-With": "XMLHttpRequest",
}


def extract_indicative(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Pull a candidate NIFTY indicative print from marketStatus JSON."""
    if not isinstance(payload, dict):
        return None
    block = payload.get("indicativenifty50")
    if not isinstance(block, dict):
        return None
    value = None
    field = None
    for key in ("indexLast", "closingValue"):
        raw = block.get(key)
        try:
            n = float(raw)
        except (TypeError, ValueError):
            continue
        if n > 0:
            value = n
            field = key
            break
    if value is None:
        return None
    return {
        "value": value,
        "field": field,
        "status": str(block.get("status") or ""),
        "index_name": str(block.get("indexName") or ""),
        "indicative_time": block.get("indicativeTime") or block.get("dateTime"),
        "raw": block,
    }


def indicative_is_sane(hit: Dict[str, Any], *, now: Optional[datetime] = None) -> Tuple[bool, str]:
    """Reject leftover CLOSE prints and garbage numbers."""
    now = now or get_ist_now()
    value = float(hit.get("value") or 0)
    if value <= 0:
        return False, "non_positive"
    if value < 15000 or value > 40000:
        return False, "out_of_range"
    name = str(hit.get("index_name") or "").upper()
    if name and "NIFTY" not in name:
        return False, "wrong_index"
    status = str(hit.get("status") or "").upper()
    t = now.timetz().replace(tzinfo=None) if now.tzinfo else now.time()
    # Official CLOSE leftover (overnight / after 15:30) is not a live 15:20 print.
    if status == "CLOSE":
        return False, "stale_close"
    if t < dtime(15, 20):
        return False, "before_cas_window"
    stamp = hit.get("indicative_time")
    if stamp:
        today = now.date().isoformat()
        text = str(stamp)
        # '01-Sep-2026 15:20' or ISO
        parsed_day = None
        for fmt in ("%d-%b-%Y %H:%M", "%d-%b-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                parsed_day = datetime.strptime(text[:19] if len(text) >= 19 else text, fmt).date()
                break
            except ValueError:
                continue
        if parsed_day is not None and parsed_day.isoformat() != today:
            return False, "wrong_day"
    return True, "ok"


class NseIndicativeProvider:
    def __init__(self) -> None:
        self._client: Optional[httpx.Client] = None
        self._warmed = False
        self._last_error: Optional[str] = None
        self.last_fetch_at: Optional[str] = None
        self.last_hit: Optional[Dict[str, Any]] = None

    def warmup(self) -> bool:
        try:
            client = self._ensure_client()
            home = client.get(NSE_HOME, headers=BROWSER_HEADERS, timeout=20.0)
            logger.debug("NSE auto-trade home status=%s", home.status_code)
            page = client.get(
                NSE_CAS_PAGE,
                headers={**BROWSER_HEADERS, "Referer": NSE_HOME},
                timeout=20.0,
            )
            if page.status_code >= 400:
                logger.warning("NSE CAS page warmup status=%s", page.status_code)
            self._warmed = True
            self._last_error = None
            return True
        except Exception as exc:
            self._last_error = str(exc)[:240]
            logger.warning("NSE indicative warmup failed: %s", exc)
            return False

    def fetch(self) -> Optional[Dict[str, Any]]:
        received = get_ist_now().isoformat(timespec="milliseconds")
        try:
            client = self._ensure_client()
            if not self._warmed:
                self.warmup()
            resp = client.get(NSE_MARKET_STATUS, headers=API_HEADERS, timeout=8.0)
            if resp.status_code in (401, 403):
                self._warmed = False
                self.warmup()
                resp = client.get(NSE_MARKET_STATUS, headers=API_HEADERS, timeout=8.0)
            resp.raise_for_status()
            payload = resp.json()
            hit = extract_indicative(payload if isinstance(payload, dict) else {})
            self.last_fetch_at = received
            if not hit:
                return None
            hit["received_at"] = received
            self.last_hit = hit
            self._last_error = None
            return hit
        except Exception as exc:
            self._last_error = str(exc)[:240]
            self.last_fetch_at = received
            logger.warning("NSE indicative fetch failed: %s", exc)
            return None

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
            self._warmed = False

    def _ensure_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=20.0,
                headers=BROWSER_HEADERS,
                follow_redirects=True,
            )
        return self._client
