"""Parse NSE/BSE F&O option tradingsymbols (weekly + monthly)."""
from __future__ import annotations

import calendar
import re
from typing import Any, Optional

INDEXES = "NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX"
MON = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# Weekly with month name: NIFTY26AUG1123050CE  (needs day + 4–6 digit strike)
_WEEKLY_MMM = re.compile(
    rf"^(?P<idx>{INDEXES})(?P<yy>\d{{2}})(?P<mon>[A-Z]{{3}})(?P<dd>\d{{2}})"
    rf"(?P<strike>\d{{4,6}})(?P<side>CE|PE)$"
)
# Monthly: NIFTY26AUG23050CE
_MONTHLY = re.compile(
    rf"^(?P<idx>{INDEXES})(?P<yy>\d{{2}})(?P<mon>[A-Z]{{3}})"
    rf"(?P<strike>\d{{4,6}})(?P<side>CE|PE)$"
)
# Compact weekly: NIFTY2681123050CE (yy + month digit + dd + strike)
_COMPACT = re.compile(
    rf"^(?P<idx>{INDEXES})(?P<yy>\d{{2}})(?P<m>\d)(?P<dd>\d{{2}})"
    rf"(?P<strike>\d{{4,6}})(?P<side>CE|PE)$"
)


def _last_thursday(yyyy: int, month: int) -> str:
    last = calendar.monthrange(yyyy, month)[1]
    d = calendar.weekday(yyyy, month, last)  # Mon=0 … Thu=3
    offset = (d - 3) % 7
    day = last - offset
    return f"{yyyy:04d}-{month:02d}-{day:02d}"


def parse_fno_option_symbol(ts: str) -> Optional[dict[str, Any]]:
    """Return parsed option fields or None if not an option symbol."""
    if not ts:
        return None

    m = _WEEKLY_MMM.match(ts)
    if m:
        mon = m.group("mon")
        if mon not in MON:
            return None
        yyyy = 2000 + int(m.group("yy"))
        month = MON[mon]
        day = int(m.group("dd"))
        if day < 1 or day > 31:
            return None
        return {
            "index": m.group("idx"),
            "strike": int(m.group("strike")),
            "side": m.group("side"),
            "expiry_code": f"{mon}{m.group('dd')}",
            "expiry_yy": m.group("yy"),
            "expiry_day": day,
            "expiry_iso": f"{yyyy:04d}-{month:02d}-{day:02d}",
        }

    m = _MONTHLY.match(ts)
    if m:
        mon = m.group("mon")
        if mon not in MON:
            return None
        yyyy = 2000 + int(m.group("yy"))
        month = MON[mon]
        return {
            "index": m.group("idx"),
            "strike": int(m.group("strike")),
            "side": m.group("side"),
            "expiry_code": mon,
            "expiry_yy": m.group("yy"),
            "expiry_day": None,
            "expiry_iso": _last_thursday(yyyy, month),
        }

    m = _COMPACT.match(ts)
    if m:
        yyyy = 2000 + int(m.group("yy"))
        month = int(m.group("m"))
        day = int(m.group("dd"))
        if month < 1 or month > 9 or day < 1 or day > 31:
            return None
        return {
            "index": m.group("idx"),
            "strike": int(m.group("strike")),
            "side": m.group("side"),
            "expiry_code": f"{month}{m.group('dd')}",
            "expiry_yy": m.group("yy"),
            "expiry_day": day,
            "expiry_iso": f"{yyyy:04d}-{month:02d}-{day:02d}",
        }

    return None
