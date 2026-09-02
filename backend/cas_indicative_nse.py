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
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

# Live NIFTY often sits on indexLast until the 15:20 indicative actually prints.
# Treat that leftover as "not yet" — do not consume it as the day's first CAS print.
FREEZE_EPS = 0.51


def extract_indicative_hits(payload: Dict[str, Any]) -> list:
    """All numeric NIFTY prints on the widget (indexLast, then closingValue)."""
    if not isinstance(payload, dict):
        return []
    block = payload.get("indicativenifty50")
    if not isinstance(block, dict):
        return []
    hits = []
    seen = set()
    for key in ("indexLast", "closingValue"):
        raw = block.get(key)
        try:
            n = float(raw)
        except (TypeError, ValueError):
            continue
        if n <= 0 or n in seen:
            continue
        seen.add(n)
        hits.append({
            "value": n,
            "field": key,
            "status": str(block.get("status") or ""),
            "index_name": str(block.get("indexName") or ""),
            "indicative_time": block.get("indicativeTime") or block.get("dateTime"),
            "raw": block,
        })
    return hits


def extract_indicative(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Pull a candidate NIFTY indicative print from marketStatus JSON."""
    hits = extract_indicative_hits(payload)
    return hits[0] if hits else None


def parse_nse_stamp(stamp: Any) -> Optional[datetime]:
    """Parse NSE widget clocks like '01-Sep-2026 15:20:01' (do not slice seconds off)."""
    if stamp is None:
        return None
    text = str(stamp).strip()
    if not text:
        return None
    text = text.replace("Z", "")
    if "T" in text:
        text = text.split("+")[0].split(".")[0]
        text = text.replace("T", " ", 1)
    for fmt in (
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
        except Exception:
            return None
    return None


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
    parsed = parse_nse_stamp(hit.get("indicative_time"))
    # closingValue without a clock can be yesterday's settlement, not the 15:20 print.
    if str(hit.get("field") or "") == "closingValue" and parsed is None:
        return False, "closing_without_stamp"
    if parsed is not None:
        if parsed.date() != now.date():
            return False, "wrong_day"
        if parsed.time() < dtime(15, 20):
            return False, "stamp_before_signal"
    return True, "ok"


def accept_first_indicative(
    hit: Dict[str, Any],
    *,
    freeze: Optional[float],
    now: Optional[datetime] = None,
) -> Tuple[bool, str]:
    """Stay ARMED until the print is a new CAS indicative, not the frozen live LTP."""
    ok, why = indicative_is_sane(hit, now=now)
    if not ok:
        return False, why
    if freeze is not None:
        try:
            if abs(float(hit.get("value") or 0) - float(freeze)) < FREEZE_EPS:
                return False, "same_as_freeze"
        except (TypeError, ValueError):
            return False, "bad_value"
    return True, "ok"


class NseIndicativeProvider:
    def __init__(self) -> None:
        self._client: Optional[httpx.Client] = None
        self._warmed = False
        self._last_error: Optional[str] = None
        self.last_fetch_at: Optional[str] = None
        self.last_hit: Optional[Dict[str, Any]] = None
        self.last_cookie_names: list = []

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
            names = sorted({str(c) for c in client.cookies.keys()})
            self._warmed = True
            self._last_error = None
            self.last_cookie_names = names
            if not names:
                logger.warning("NSE indicative warmup returned no cookies")
            return True
        except Exception as exc:
            self._last_error = str(exc)[:240]
            self.last_cookie_names = []
            logger.warning("NSE indicative warmup failed: %s", exc)
            return False

    def fetch(self) -> list:
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
            hits = extract_indicative_hits(payload if isinstance(payload, dict) else {})
            self.last_fetch_at = received
            if not hits:
                return []
            for hit in hits:
                hit["received_at"] = received
            self.last_hit = hits[0]
            self._last_error = None
            return hits
        except Exception as exc:
            self._last_error = str(exc)[:240]
            self.last_fetch_at = received
            logger.warning("NSE indicative fetch failed: %s", exc)
            return []

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
