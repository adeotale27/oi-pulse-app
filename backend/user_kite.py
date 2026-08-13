"""Per-user Kite positions tokens (guests). Publisher vault stays on OI."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist(now: Optional[datetime] = None) -> datetime:
    dt = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def kite_token_valid_until(issued_at: Optional[datetime] = None) -> datetime:
    """Zerodha access tokens die around 06:00 IST the next session morning."""
    n = now_ist(issued_at)
    six = n.replace(hour=6, minute=0, second=0, microsecond=0)
    if n < six:
        return six
    return six + timedelta(days=1)


def token_is_expired(valid_until_iso: Optional[str], now: Optional[datetime] = None) -> bool:
    if not valid_until_iso:
        return True
    try:
        until = datetime.fromisoformat(str(valid_until_iso).replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=IST)
    except Exception:
        return True
    return now_ist(now) >= until.astimezone(IST)


def public_status(doc: Optional[dict], now: Optional[datetime] = None) -> dict[str, Any]:
    if not doc or not doc.get("access_token_enc"):
        return {
            "connected": False,
            "expired": False,
            "kite_user_id": None,
            "valid_until": None,
        }
    expired = token_is_expired(doc.get("valid_until"), now)
    return {
        "connected": not expired,
        "expired": expired,
        "kite_user_id": doc.get("kite_user_id"),
        "valid_until": doc.get("valid_until"),
    }
