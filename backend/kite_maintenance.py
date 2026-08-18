"""Detect Zerodha / Kite maintenance windows for desk banners.

Zerodha does not publish a stable public JSON status feed for Kite Connect.
We combine:
  1) Kite API error text (NetworkException / 503 / explicit "maintenance")
  2) Zerodha marketintel bulletin headlines (HTML scrape, best-effort)
"""

from __future__ import annotations

import logging
import re
import time
from html import unescape
from typing import Any, Optional
from urllib.request import Request, urlopen

logger = logging.getLogger("kite_maintenance")

BULLETIN_URL = "https://zerodha.com/marketintel/bulletin"
_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
_CACHE_TTL_SEC = 180.0

_MAINT_RE = re.compile(
    r"(under\s+maintenance|scheduled\s+maintenance|maintenance\s+window|"
    r"kite\s+is\s+under\s+maintenance|service\s+unavailable|"
    r"503\s+service\s+unavailable|504\s+gateway|"
    r"no server is available|temporarily unavailable|"
    r"due to maintenance|system\s+maintenance)",
    re.I,
)

_TITLE_RE = re.compile(
    r"<h4[^>]*>\s*<a[^>]*>(.*?)</a>\s*</h4>",
    re.I | re.S,
)
_TAG_RE = re.compile(r"<[^>]+>")


def looks_like_maintenance(message: Any) -> bool:
    text = str(message or "")
    if not text:
        return False
    return bool(_MAINT_RE.search(text))


def notice_from_error(message: Any, *, source: str = "kite_api") -> Optional[dict]:
    text = str(message or "").strip()
    if not text or not looks_like_maintenance(text):
        return None
    # Prefer a short human line.
    clean = re.sub(r"\s+", " ", text)[:220]
    return {
        "active": True,
        "message": clean,
        "source": source,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _strip_html(s: str) -> str:
    return unescape(_TAG_RE.sub("", s or "")).strip()


def fetch_bulletin_notice(timeout_sec: float = 6.0) -> Optional[dict]:
    """Best-effort scrape of Zerodha bulletin for open maintenance headlines."""
    now = time.time()
    if _CACHE["payload"] is not None and (now - float(_CACHE["at"])) < _CACHE_TTL_SEC:
        return _CACHE["payload"]

    payload = None
    try:
        req = Request(
            BULLETIN_URL,
            headers={
                "User-Agent": "OI-Pulse/1.0 (+maintenance-check)",
                "Accept": "text/html",
            },
        )
        with urlopen(req, timeout=timeout_sec) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        titles = [_strip_html(m.group(1)) for m in _TITLE_RE.finditer(html)]
        hit = next((t for t in titles if looks_like_maintenance(t)), None)
        if hit:
            payload = {
                "active": True,
                "message": hit[:220],
                "source": "zerodha_bulletin",
                "url": BULLETIN_URL,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        else:
            payload = {
                "active": False,
                "message": None,
                "source": "zerodha_bulletin",
                "url": BULLETIN_URL,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
    except Exception as e:
        logger.debug("bulletin maintenance check failed: %s", e)
        payload = {
            "active": False,
            "message": None,
            "source": "zerodha_bulletin",
            "error": f"{type(e).__name__}: {e}",
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    _CACHE["at"] = now
    _CACHE["payload"] = payload
    return payload


def overnight_book_notice() -> Optional[dict]:
    """Kite Portfolio is dark ~00:00–07:00 IST even when quote APIs still answer."""
    from datetime import datetime, timezone, timedelta
    ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    if ist.hour >= 7:
        return None
    return {
        "active": True,
        "message": "Kite is undergoing scheduled maintenance. You can see margins, positions, and holdings from 7:00 AM IST.",
        "source": "overnight_ist",
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def stale_overnight_notice(notice: Optional[dict]) -> bool:
    """True after 07:00 IST so the overnight book banner cannot stick into cash open."""
    if not notice or not notice.get("active"):
        return False
    from datetime import datetime, timezone, timedelta
    ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    if ist.hour < 7:
        return False
    src = str(notice.get("source") or "")
    msg = str(notice.get("message") or "")
    return src == "overnight_ist" or "7:00 AM" in msg


def merge_maintenance(
    current: Optional[dict],
    *,
    api_error: Any = None,
    bulletin: Optional[dict] = None,
) -> Optional[dict]:
    """Prefer live API maintenance signals; fall back to bulletin headlines.

    Never clear a sticky kite_api notice just because the bulletin scrape failed
    or returned inactive — only a successful kite call should clear API notices.
    """
    if stale_overnight_notice(current):
        current = None
    from_api = notice_from_error(api_error, source="kite_api") if api_error else None
    if from_api:
        if stale_overnight_notice(from_api):
            from_api = None
        else:
            return from_api
    if bulletin and bulletin.get("active") and bulletin.get("message"):
        return bulletin
    # Keep sticky API / bulletin notices; do not clear on scrape error / inactive.
    if current and current.get("active"):
        return current
    return None
