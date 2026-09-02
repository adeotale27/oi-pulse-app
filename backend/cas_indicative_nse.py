"""NSE Indicative NIFTY 50 — structured JSON, not HTML scrape.

The nseindia.com homepage **Indicative Close** is not the leftover
``/api/marketStatus`` CLOSE print. At 15:20 it lives on:

- ``/api/NextApi/apiClient?functionName=getIndexData&&type=ALL`` → NIFTY 50 ``indicativeClose`` + ``timeVal``
- ``/api/allIndices`` → NIFTY 50 ``indicativeClose``

``/api/marketStatus`` → ``indicativenifty50`` is a fallback only. Overnight CLOSE
leftovers are still ignored. Same cookie warmup pattern as FII/DII (Akamai).
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
NSE_INDEX_DATA = (
    "https://www.nseindia.com/api/NextApi/apiClient"
    "?functionName=getIndexData&&type=ALL"
)
NSE_ALL_INDICES = "https://www.nseindia.com/api/allIndices"

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

HOME_API_HEADERS = {**API_HEADERS, "Referer": NSE_HOME}

# Live NIFTY often sits on indexLast until the 15:20 indicative actually prints.
# Treat that leftover as "not yet" — do not consume it as the day's first CAS print.
FREEZE_EPS = 0.51
NIFTY_50_NAMES = frozenset({"NIFTY 50", "NIFTY50"})


def _norm_index_name(name: Any) -> str:
    return " ".join(str(name or "").upper().split())


def _is_nifty_50(name: Any) -> bool:
    return _norm_index_name(name) in NIFTY_50_NAMES


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
    index_name: Any = "NIFTY 50",
    indicative_time: Any = None,
    raw: Optional[Dict[str, Any]] = None,
    source: str = "",
) -> Dict[str, Any]:
    return {
        "value": value,
        "field": field,
        "status": str(status or ""),
        "index_name": str(index_name or "NIFTY 50"),
        "indicative_time": indicative_time,
        "raw": raw or {},
        "source": source,
    }


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
        hits.append(_hit(
            n,
            key,
            status=block.get("status"),
            index_name=block.get("indexName") or "NIFTY 50",
            indicative_time=block.get("indicativeTime") or block.get("dateTime"),
            raw=block,
            source="marketStatus",
        ))
    return hits


def extract_indicative(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Pull a candidate NIFTY indicative print from marketStatus JSON."""
    hits = extract_indicative_hits(payload)
    return hits[0] if hits else None


def _rows_from_payload(payload: Any) -> list:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "indexData", "indices", "index"):
            inner = data.get(key)
            if isinstance(inner, list):
                return inner
    for key in ("indexData", "indices"):
        inner = payload.get(key)
        if isinstance(inner, list):
            return inner
    return []


def extract_index_data_hits(payload: Any) -> list:
    """Homepage Indicative Close: NextApi getIndexData NIFTY 50 indicativeClose."""
    hits = []
    for row in _rows_from_payload(payload):
        if not isinstance(row, dict):
            continue
        name = row.get("indexName") or row.get("index") or row.get("name")
        if not _is_nifty_50(name):
            continue
        stamp = row.get("timeVal") or row.get("timeStamp") or row.get("timestamp")
        for key in ("indicativeClose", "last"):
            n = _pos_float(row.get(key))
            if n is None:
                continue
            hits.append(_hit(
                n,
                key,
                status=row.get("status") or "",
                index_name=name,
                indicative_time=stamp,
                raw=row,
                source="getIndexData",
            ))
        break
    return hits


def extract_all_indices_hits(payload: Any) -> list:
    """Fallback homepage number: /api/allIndices NIFTY 50 indicativeClose."""
    hits = []
    for row in _rows_from_payload(payload):
        if not isinstance(row, dict):
            continue
        name = row.get("index") or row.get("indexName") or row.get("name")
        if not _is_nifty_50(name):
            continue
        stamp = row.get("timeVal") or row.get("timeStamp") or row.get("timestamp")
        for key in ("indicativeClose", "last"):
            n = _pos_float(row.get(key))
            if n is None:
                continue
            hits.append(_hit(
                n,
                key,
                status=row.get("status") or "",
                index_name=name,
                indicative_time=stamp,
                raw=row,
                source="allIndices",
            ))
        break
    return hits


def merge_nse_indicative_hits(*groups: list) -> list:
    """Homepage indicativeClose first; de-dupe identical field+price."""
    out = []
    seen = set()
    for group in groups:
        for hit in group or []:
            try:
                dkey = (str(hit.get("field") or ""), round(float(hit["value"]), 2))
            except (TypeError, ValueError, KeyError):
                continue
            if dkey in seen:
                continue
            seen.add(dkey)
            out.append(hit)
    return out


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
            if not self._warmed:
                self.warmup()
            idx = self._get_json(NSE_INDEX_DATA, HOME_API_HEADERS)
            alli = self._get_json(NSE_ALL_INDICES, HOME_API_HEADERS)
            mkt = self._get_json(NSE_MARKET_STATUS, API_HEADERS)
            hits = merge_nse_indicative_hits(
                extract_index_data_hits(idx),
                extract_all_indices_hits(alli),
                extract_indicative_hits(mkt if isinstance(mkt, dict) else {}),
            )
            self.last_fetch_at = received
            if not hits:
                if not self._last_error:
                    self._last_error = "no_nifty_print"
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

    def _get_json(self, url: str, headers: Dict[str, str]) -> Any:
        client = self._ensure_client()
        resp = client.get(url, headers=headers, timeout=8.0)
        if resp.status_code in (401, 403):
            self._warmed = False
            self.warmup()
            resp = client.get(url, headers=headers, timeout=8.0)
        if resp.status_code >= 400:
            logger.warning("NSE GET %s status=%s", url.split("?")[0], resp.status_code)
            self._last_error = f"HTTP {resp.status_code}"
            return None
        try:
            return resp.json()
        except Exception as exc:
            logger.warning("NSE GET %s JSON failed: %s", url.split("?")[0], exc)
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
