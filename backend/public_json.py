"""Strip secret-shaped keys from JSON we might return on public/admin reads."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

_SECRET_KEY = re.compile(
    r"(password|secret|token|fernet|api_key|apikey|webhook|private_key|access_token)",
    re.I,
)


def strip_secret_settings(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Drop keys whose names look like credentials. Values are never returned."""
    if not isinstance(data, dict):
        return {}, []
    out: Dict[str, Any] = {}
    dropped: List[str] = []
    for key, value in data.items():
        if _SECRET_KEY.search(str(key)):
            dropped.append(str(key))
            continue
        out[key] = value
    return out, dropped
