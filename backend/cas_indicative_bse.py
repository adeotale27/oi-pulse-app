"""BSE Indicative SENSEX — structured JSON or HTML scrape.

The BSE SENSEX indicative close is investigated from:
- Potential JSON endpoints similar to NSE
- Fallback to HTML scrape with proper headers
"""

from __future__ import annotations

import logging
from datetime import datetime, time as dtime
from typing import Any, Dict, Optional, Tuple

import httpx

from cas_rule_expiry_automation.time_utils import IST, get_ist_now

logger = logging.getLogger(__name__)

BSE_HOME = "https://www.bseindia.com/"
BSE_SENSEX_PAGE = "https://www.bseindia.com/sensex/code/16"
BSE_MARKET_DATA = "https://api.bseindia.com/BseIndiaAPI/api/IndExistense/w"
BSE_MARKET_STATUS = "https://api.bseindia.com/BseIndiaAPI/api/IndexMasterData/w"

# Common headers for BSE requests
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
    "Referer": BSE_SENSEX_PAGE,
    "X-Requested-With": "XMLHttpRequest",
}

HOME_API_HEADERS = {**API_HEADERS, "Referer": BSE_HOME}

# Validation constants
FREEZE_EPS = 0.51
BSE_NAMES = frozenset({"SENSEX", "BSE SENSEX", "SENSEX INDEX"})


def _norm_index_name(name: Any) -> str:
    return " ".join(str(name or "").upper().split())


def _is_bse_sensex(name: Any) -> bool:
    return _norm_index_name(name) in BSE_NAMES


def _pos_float(raw: Any) -> Optional[float]:
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return n


def _hit(
    value: float,
    field: str,
    *,
    status: Any = "",
    index_name: Any = "SENSEX",
    indicative_time: Any = None,
    raw: Optional[Dict[str, Any]] = None,
    source: str = "",
) -> Dict[str, Any]:
    return {
        "value": value,
        "field": field,
        "status": str(status or ""),
        "index_name": str(index_name or "SENSEX"),
        "indicative_time": indicative_time,
        "raw": raw or {},
        "source": source,
    }


def extract_indicative_hits(payload: Dict[str, Any]) -> list:
    """Extract BSE SENSEX indicative hits from payload."""
    if not isinstance(payload, dict):
        return []

    # Try common BSE response structures
    hits = []

    # Structure 1: Direct indicative field
    for key in ["indicativeValue", "indicativeClose", "IndicativeValue"]:
        raw_val = payload.get(key)
        n = _pos_float(raw_val)
        if n is not None:
            hits.append(_hit(
                n,
                key,
                status=payload.get("status", ""),
                index_name=payload.get("indexName", "SENSEX"),
                indicative_time=payload.get("indicativeTime") or payload.get("timeStamp"),
                raw=payload,
                source="bse_direct"
            ))

    # Structure 2: Nested data object
    data_obj = payload.get("Data") or payload.get("data") or payload.get("response")
    if isinstance(data_obj, dict):
        for key in ["indicativeValue", "indicativeClose", "IndicativeValue"]:
            raw_val = data_obj.get(key)
            n = _pos_float(raw_val)
            if n is not None:
                hits.append(_hit(
                    n,
                    key,
                    status=data_obj.get("status", ""),
                    index_name=data_obj.get("indexName", "SENSEX"),
                    indicative_time=data_obj.get("indicativeTime") or data_obj.get("timeStamp"),
                    raw=data_obj,
                    source="bse_nested"
                ))

    # Structure 3: Array of indices
    indices_list = payload.get("Indices") or payload.get("indices") or payload.get("data")
    if isinstance(indices_list, list):
        for item in indices_list:
            if isinstance(item, dict):
                name = item.get("IndexName") or item.get("indexName") or item.get("name")
                if _is_bse_sensex(name):
                    for key in ["IndicativeValue", "indicativeValue", "indicativeClose"]:
                        raw_val = item.get(key)
                        n = _pos_float(raw_val)
                        if n is not None:
                            hits.append(_hit(
                                n,
                                key,
                                status=item.get("Status", item.get("status", "")),
                                index_name=name,
                                indicative_time=item.get("IndicativeTime") or item.get("indicativeTime") or item.get("timeStamp"),
                                raw=item,
                                source="bse_array"
                            ))
                            break  # Take first match per item

    return hits


def extract_bse_indicative(payload: Any) -> Optional[Dict[str, Any]]:
    """Pull a candidate BSE SENSEX indicative print from payload."""
    hits = extract_indicative_hits(payload)
    return hits[0] if hits else None


def parse_bse_stamp(stamp: Any) -> Optional[datetime]:
    """Parse BSE timestamp formats."""
    if stamp is None:
        return None
    text = str(stamp).strip()
    if not text:
        return None

    # Common BSE formats
    formats = [
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
        except Exception:
            return None
    return None


def indicative_is_sane(hit: Dict[str, Any], *, now: Optional[datetime] = None) -> Tuple[bool, str]:
    """Validate BSE indicative print."""
    now = now or get_ist_now()
    value = float(hit.get("value") or 0)

    if value <= 0:
        return False, "non_positive"
    if value < 1000 or value > 100000:  # SENSEX typical range
        return False, "out_of_range"

    name = str(hit.get("index_name") or "").upper()
    if name and "SENSEX" not in name:
        return False, "wrong_index"

    status = str(hit.get("status") or "").upper()
    t = now.timetz().replace(tzinfo=None) if now.tzinfo else now.time()

    # Check for stale data
    if status in ["CLOSE", "PRE_OPEN"]:
        return False, "stale_status"

    if t < dtime(9, 0):  # Before market open
        return False, "before_market_open"

    parsed = parse_bse_stamp(hit.get("indicative_time"))
    if parsed is None:
        # Try to use received time if no stamp
        received_str = hit.get("received_at")
        if received_str:
            try:
                parsed = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
            except Exception:
                pass

    if parsed is not None:
        if parsed.date() != now.date():
            return False, "wrong_day"
        if parsed.time() < dtime(9, 0):  # Before market open
            return False, "stamp_before_market"

    return True, "ok"


def accept_first_indicative(
    hit: Dict[str, Any],
    *,
    freeze: Optional[float],
    now: Optional[datetime] = None,
) -> Tuple[bool, str]:
    """Validate that the indicative is not frozen live data."""
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


class BseIndicativeProvider:
    def __init__(self) -> None:
        self._client: Optional[httpx.Client] = None
        self._warmed = False
        self._last_error: Optional[str] = None
        self.last_fetch_at: Optional[str] = None
        self.last_hit: Optional[Dict[str, Any]] = None
        self.last_tape: Optional[Dict[str, Any]] = None
        self.last_cookie_names: list = []

    def warmup(self) -> bool:
        """Warm up BSE session with cookies."""
        try:
            client = self._ensure_client()
            home = client.get(BSE_HOME, headers=BROWSER_HEADERS, timeout=20.0)
            logger.debug("BSE home status=%s", home.status_code)

            page = client.get(
                BSE_SENSEX_PAGE,
                headers={**BROWSER_HEADERS, "Referer": BSE_HOME},
                timeout=20.0,
            )
            if page.status_code >= 400:
                logger.warning("BSE SENSEX page warmup status=%s", page.status_code)

            names = sorted({str(c) for c in client.cookies.keys()})
            self._warmed = True
            self._last_error = None
            self.last_cookie_names = names

            if not names:
                logger.warning("BSE indicative warmup returned no cookies")
            return True
        except Exception as exc:
            self._last_error = str(exc)[:240]
            self.last_cookie_names = []
            logger.warning("BSE indicative warmup failed: %s", exc)
            return False

    def fetch(self, *, hot: bool = False) -> list:
        """Fetch BSE indicative data."""
        received = get_ist_now().isoformat(timespec="milliseconds")
        timeout = 2.0 if hot else 6.0

        try:
            if not self._warmed and not hot:
                self.warmup()

            # Try primary BSE API endpoints
            bse_indicative = self._get_json(
                BSE_MARKET_DATA, API_HEADERS, timeout=timeout, allow_warmup=not hot
            )

            hits = []
            if bse_indicative:
                hit = extract_bse_indicative(bse_indicative)
                if hit:
                    hits.append(hit)

            # Try fallback endpoints if primary fails
            if not hits:
                bse_status = self._get_json(
                    BSE_MARKET_STATUS, API_HEADERS, timeout=timeout, allow_warmup=not hot
                )
                if bse_status:
                    hit = extract_bse_indicative(bse_status)
                    if hit:
                        hits.append(hit)

            # If still no hits and not hot request, try HTML scrape fallback
            if not hits and not hot:
                hits = self._fetch_html_fallback()

            self.last_fetch_at = received

            if not hits:
                if not self._last_error:
                    self._last_error = "no_bse_sensex_print"
                return []

            for hit in hits:
                hit["received_at"] = received

            self.last_hit = hits[0]
            self._last_error = None
            return hits

        except Exception as exc:
            self._last_error = str(exc)[:240]
            self.last_fetch_at = received
            logger.warning("BSE indicative fetch failed: %s", exc)
            return []

    def _fetch_html_fallback(self) -> list:
        """Fallback to HTML scraping for BSE indicative data."""
        try:
            client = self._ensure_client()

            # Try to scrape the SENSEX page for indicative value
            response = client.get(
                BSE_SENSEX_PAGE,
                headers=BROWSER_HEADERS,
                timeout=10.0
            )

            if response.status_code >= 400:
                logger.warning("BSE HTML fetch status=%s", response.status_code)
                return []

            # Simple regex extraction for indicative value from HTML
            # This would need to be customized based on actual BSE page structure
            import re

            # Look for common patterns in BSE HTML
            indicative_patterns = [
                r'indicative.*?value.*?[\d,]+\.?\d*',
                r'Indicative.*?[\d,]+\.?\d*',
                r'sensex.*?indicative.*?[\d,]+\.?\d*',
                r'data-indicative[\s"]*[\d,]+\.?\d*',
            ]

            html_text = response.text
            indicative_value = None

            for pattern in indicative_patterns:
                match = re.search(pattern, html_text, re.IGNORECASE)
                if match:
                    # Extract number from match
                    num_match = re.search(r'[\d,]+\.?\d*', match.group())
                    if num_match:
                        try:
                            indicative_value = float(num_match.group().replace(',', ''))
                            break
                        except ValueError:
                            continue

            if indicative_value is not None:
                hit = _hit(
                    indicative_value,
                    "indicativeClose",
                    status="",
                    index_name="SENSEX",
                    indicative_time=None,
                    raw={"html_scrape": True},
                    source="bse_html_scrape"
                )
                return [hit]

            return []

        except Exception as exc:
            logger.warning("BSE HTML fallback failed: %s", exc)
            self._last_error = f"HTML scrape error: {str(exc)[:100]}"
            return []

    def _get_json(
        self,
        url: str,
        headers: Dict[str, str],
        timeout: float = 8.0,
        *,
        allow_warmup: bool = True,
    ) -> Any:
        """Get JSON from URL with retry logic."""
        client = self._ensure_client()

        try:
            resp = client.get(url, headers=headers, timeout=timeout)

            if resp.status_code in (401, 403) and allow_warmup:
                self._warmed = False
                self.warmup()
                resp = client.get(url, headers=headers, timeout=timeout)

            if resp.status_code >= 400:
                logger.warning("BSE GET %s status=%s", url.split("?")[0], resp.status_code)
                self._last_error = f"HTTP {resp.status_code}"
                return None

            return resp.json()
        except Exception as exc:
            logger.warning("BSE GET %s JSON failed: %s", url.split("?")[0], exc)
            self._last_error = str(exc)[:240]
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