"""Resolve the SPA origin for Kite Connect redirects.

Legacy host aaisnamkeen.com is no longer the desk. Always send the
one-time request_token to striklenz.com (or the live request host).
"""
from __future__ import annotations

import os
from typing import Any, Callable, Optional

CANONICAL_APP_ORIGIN = "https://striklenz.com"
LEGACY_HOST_MARK = "aaisnamkeen"


def _host_from_request(request: Any) -> str:
    if request is None:
        return ""
    headers = getattr(request, "headers", None) or {}
    xf = ""
    host = ""
    try:
        xf = str(headers.get("x-forwarded-host") or "")
        host = str(headers.get("host") or "")
    except Exception:
        xf = str(getattr(headers, "get", lambda *_: "")("x-forwarded-host") or "")
        host = str(getattr(headers, "get", lambda *_: "")("host") or "")
    raw = (xf.split(",")[0] if xf else host).strip()
    return raw.split("/")[0].split(":")[0].lower()


def _proto_from_request(request: Any) -> str:
    if request is None:
        return "https"
    headers = getattr(request, "headers", None) or {}
    try:
        xf = str(headers.get("x-forwarded-proto") or "")
    except Exception:
        xf = ""
    if xf:
        return xf.split(",")[0].strip() or "https"
    url = getattr(request, "url", None)
    scheme = getattr(url, "scheme", None)
    return str(scheme or "https")


def is_legacy_app_host(host: str) -> bool:
    return LEGACY_HOST_MARK in str(host or "").lower()


def kite_spa_origin(
    request: Any = None,
    *,
    env_get: Optional[Callable[[str], Optional[str]]] = None,
) -> str:
    """SPA origin that should complete /kite-callback (never aaisnamkeen.com)."""
    get = env_get or os.environ.get
    host = _host_from_request(request)
    proto = _proto_from_request(request)
    if host and not is_legacy_app_host(host):
        return f"{proto}://{host}".rstrip("/")
    for key in ("FRONTEND_URL", "APP_ORIGIN", "PUBLIC_APP_URL"):
        raw = (get(key) or "").strip().rstrip("/")
        if raw and not is_legacy_app_host(raw):
            return raw
    return CANONICAL_APP_ORIGIN
