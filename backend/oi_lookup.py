"""Pick the newest OI snapshot between in-memory cache and Mongo."""
from __future__ import annotations

from typing import Any, Dict, Optional


def snapshot_ts(doc: Optional[Dict[str, Any]]) -> str:
    return str((doc or {}).get("timestamp") or "")


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
