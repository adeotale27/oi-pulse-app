"""Persist desk errors (API / UI / logs) without secrets."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

COLLECTION = "error_logs"
MAX_MSG = 2000
MAX_TB = 8000
DEDUP_SECONDS = 300

_SECRET_RE = re.compile(
    r"(?i)(authorization|x-admin-token|x-guest-token|api[_-]?secret|api[_-]?key|"
    r"password|access_token|request_token|enc_token|fernet[_-]?key)[=:\s]+([^\s,;&]+)"
)
_BEARER_RE = re.compile(r"(?i)\bbearer\s+\S+")

_db = None
_handler_installed = False
logger = logging.getLogger(__name__)


def bind(db) -> None:
    global _db
    _db = db


def redact(text: Any) -> str:
    s = str(text or "")
    s = _BEARER_RE.sub("Bearer <redacted>", s)
    s = _SECRET_RE.sub(r"\1=<redacted>", s)
    return s


def fingerprint(source: str, path: str, kind: str, message: str) -> str:
    raw = f"{source}|{path}|{kind}|{(message or '')[:180]}"
    return hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:16]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def build_doc(
    *,
    source: str,
    message: str,
    traceback_text: str = "",
    path: str = "",
    kind: str = "",
    extra: Optional[dict] = None,
) -> dict:
    from app_version import APP_VERSION

    msg = redact(message)[:MAX_MSG]
    tb = redact(traceback_text)[:MAX_TB]
    src = (source or "api")[:32]
    pth = redact(path)[:300]
    knd = (kind or "Error")[:80]
    fp = fingerprint(src, pth, knd, msg)
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "fingerprint": fp,
        "ts": now.isoformat(),
        "created_at": now.isoformat(),
        "source": src,
        "level": "error",
        "path": pth,
        "kind": knd,
        "message": msg or knd,
        "traceback": tb,
        "count": 1,
        "app_version": APP_VERSION,
    }
    if extra and isinstance(extra, dict):
        safe = {str(k)[:40]: redact(v)[:200] for k, v in list(extra.items())[:8]}
        doc["extra"] = safe
    return doc


async def record_error(
    *,
    source: str,
    message: str,
    traceback_text: str = "",
    path: str = "",
    kind: str = "",
    extra: Optional[dict] = None,
) -> None:
    if _db is None:
        return
    kind_l = (kind or "").lower()
    msg_l = (message or "").lower()
    if "cancellederror" in kind_l or "websocketdisconnect" in kind_l:
        return
    if "cancellederror" in msg_l and "websocket" in (path or "").lower():
        return
    doc = build_doc(
        source=source,
        message=message,
        traceback_text=traceback_text,
        path=path,
        kind=kind,
        extra=extra,
    )
    try:
        coll = _db[COLLECTION]
        since = (_now() - timedelta(seconds=DEDUP_SECONDS)).isoformat()
        existing = await coll.find_one(
            {"fingerprint": doc["fingerprint"], "created_at": {"$gte": since}},
            {"id": 1},
        )
        if existing:
            await coll.update_one(
                {"id": existing["id"]},
                {"$inc": {"count": 1}, "$set": {"ts": doc["ts"]}},
            )
            return
        await coll.insert_one(doc)
    except Exception:
        logger.debug("error_log persist skipped", exc_info=True)


def schedule_record_error(**kwargs) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    try:
        loop.create_task(record_error(**kwargs))
    except Exception:
        pass


class MongoErrorHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno < logging.ERROR:
            return
        if record.name in ("error_log", "uvicorn.access") or record.name.startswith("uvicorn"):
            return
        tb = ""
        kind = ""
        if record.exc_info and record.exc_info[0]:
            kind = getattr(record.exc_info[0], "__name__", "") or ""
            tb = "".join(traceback.format_exception(*record.exc_info))
        try:
            schedule_record_error(
                source="log",
                message=record.getMessage(),
                traceback_text=tb,
                path=record.name,
                kind=kind or record.levelname,
            )
        except Exception:
            pass


def install_logging_handler() -> None:
    global _handler_installed
    if _handler_installed:
        return
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, MongoErrorHandler):
            _handler_installed = True
            return
    handler = MongoErrorHandler()
    handler.setLevel(logging.ERROR)
    root.addHandler(handler)
    _handler_installed = True
