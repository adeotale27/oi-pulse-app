"""Pick the newest OI snapshot between in-memory cache and Mongo."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def snapshot_ts(doc: Optional[Dict[str, Any]]) -> str:
    return str((doc or {}).get("timestamp") or "")


def _strike_val(row: Any) -> float:
    if isinstance(row, dict):
        return float(row.get("strike") or 0)
    return float(row or 0)


def nearest_strike_index(strikes: List[Any], atm: Any) -> int:
    if not strikes:
        return -1
    try:
        target = float(atm)
    except (TypeError, ValueError):
        return 0
    best = 0
    best_abs = abs(_strike_val(strikes[0]) - target)
    for i in range(1, len(strikes)):
        d = abs(_strike_val(strikes[i]) - target)
        if d < best_abs:
            best = i
            best_abs = d
    return best


def trim_snapshot_around(snap: Optional[Dict[str, Any]], n: Any) -> Optional[Dict[str, Any]]:
    """Copy of a snapshot with ATM ± n strikes (inclusive). Does not mutate cache."""
    if not snap or n is None or n == "" or n == "all":
        return snap
    try:
        count = int(n)
    except (TypeError, ValueError):
        return snap
    if count < 0:
        return snap
    strikes = list(snap.get("strikes") or [])
    if not strikes:
        return snap
    strikes.sort(key=_strike_val)
    atm = snap.get("atm")
    idx = next((i for i, s in enumerate(strikes) if _strike_val(s) == float(atm or 0)), -1)
    if idx < 0:
        idx = nearest_strike_index(strikes, atm)
    if idx < 0:
        return snap
    lo = max(0, idx - count)
    hi = min(len(strikes) - 1, idx + count)
    out = dict(snap)
    out["strikes"] = strikes[lo : hi + 1]
    return out


def prefer_newer_snapshot(
    memory: Optional[Dict[str, Any]],
    db_doc: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Serve whichever document has the later timestamp (ISO strings compare)."""
    if not db_doc:
        return memory
    if not memory:
        return db_doc
    return db_doc if snapshot_ts(db_doc) > snapshot_ts(memory) else memory
