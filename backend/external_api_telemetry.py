"""Safe, aggregate-only telemetry for outbound HTTP calls.

Only provider, endpoint path, method, status, duration and a redacted error
class are stored. Credentials, headers, bodies and responses never enter Mongo.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Optional

COLLECTION = "external_api_telemetry"
_db = None
_installed = False


def bind(db) -> None:
    global _db
    _db = db


def _classify(url: Any):
    from external_api_registry import classify_external_url
    return classify_external_url(str(url or ""))


async def record_request(*, url: Any, method: str, status_code: Optional[int], latency_ms: float, error: str = "") -> None:
    if _db is None:
        return
    hit = _classify(url)
    if not hit:
        return
    now = datetime.now(timezone.utc)
    doc = {
        "provider_id": hit["provider_id"],
        "provider": hit["provider"],
        "endpoint": hit["endpoint"],
        "method": str(method or "GET").upper()[:8],
        "status_code": int(status_code) if status_code else None,
        "latency_ms": round(max(0.0, float(latency_ms)), 1),
        "ok": bool(status_code and int(status_code) < 400 and not error),
        "error_kind": str(error or "")[:80],
        "ts": now.isoformat(),
    }
    try:
        await _db[COLLECTION].insert_one(doc)
    except Exception:
        pass


def _schedule(**kwargs) -> None:
    try:
        asyncio.get_running_loop().create_task(record_request(**kwargs))
    except RuntimeError:
        # Sync SDK work may run outside an event loop. It remains untracked
        # rather than delaying or changing the broker request.
        pass


def install_http_telemetry() -> None:
    """Instrument the two HTTP clients already used by the backend once."""
    global _installed
    if _installed:
        return
    _installed = True
    try:
        import httpx
        original_async_request = httpx.AsyncClient.request

        async def tracked_async_request(self, method, url, *args, **kwargs):
            started = time.perf_counter()
            response = None
            error = ""
            try:
                response = await original_async_request(self, method, url, *args, **kwargs)
                return response
            except Exception as exc:
                error = type(exc).__name__
                raise
            finally:
                _schedule(
                    url=url,
                    method=method,
                    status_code=getattr(response, "status_code", None),
                    latency_ms=(time.perf_counter() - started) * 1000,
                    error=error,
                )

        httpx.AsyncClient.request = tracked_async_request
    except Exception:
        pass
    try:
        import requests
        original_sync_request = requests.Session.request

        def tracked_sync_request(self, method, url, *args, **kwargs):
            started = time.perf_counter()
            response = None
            error = ""
            try:
                response = original_sync_request(self, method, url, *args, **kwargs)
                return response
            except Exception as exc:
                error = type(exc).__name__
                raise
            finally:
                _schedule(
                    url=url,
                    method=method,
                    status_code=getattr(response, "status_code", None),
                    latency_ms=(time.perf_counter() - started) * 1000,
                    error=error,
                )

        requests.Session.request = tracked_sync_request
    except Exception:
        pass
