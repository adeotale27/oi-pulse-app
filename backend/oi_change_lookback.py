"""OI Change lookback: now−N sliding window, not 'minutes since restart'."""
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional


def lookback_floor(anchor: datetime, minutes: int, session_open: datetime) -> datetime:
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    if session_open.tzinfo is None:
        session_open = session_open.replace(tzinfo=timezone.utc)
    target = anchor - timedelta(minutes=max(1, int(minutes)))
    return target if target >= session_open else session_open


def pick_baseline_ts(
    timestamps: Iterable[datetime],
    current: datetime,
    minutes: int,
    session_open: datetime,
) -> Optional[datetime]:
    """Snapshot at or before now−N (session-open floor); else first tick after the floor."""
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    floor = lookback_floor(current, minutes, session_open)
    aware = []
    for t in timestamps:
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        aware.append(t)
    before = [t for t in aware if session_open <= t <= floor]
    if before:
        return max(before)
    after = [t for t in aware if floor < t < current]
    return min(after) if after else None
