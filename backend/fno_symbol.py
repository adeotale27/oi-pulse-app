"""Parse NSE/BSE F&O option tradingsymbols (weekly + monthly)."""
from __future__ import annotations

import calendar
import re
from typing import Any, Optional

from kite_positions import booked_pnl_from_kite_row  # noqa: F401 — canonical impl
from universe import fno_name_alternation

INDEXES = fno_name_alternation()
_MCX_OPT_NAMES = "|".join(
    sorted(
        (
            "CRUDEOILM", "CRUDEOIL", "NATURALGASM", "NATURALGAS", "NATGASMINI",
            "SILVERMIC", "SILVERM", "GOLDPETAL", "GOLDM", "GOLD", "SILVER",
        ),
        key=len,
        reverse=True,
    )
)
MON = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
MON_NAME = {v: k for k, v in MON.items()}

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
# MCX options often use 2–3 digit strikes (NATURALGAS25AUG250CE).
_MCX_MONTHLY = re.compile(
    rf"^(?P<idx>{_MCX_OPT_NAMES})(?P<yy>\d{{2}})(?P<mon>[A-Z]{{3}})"
    rf"(?P<strike>\d{{2,6}})(?P<side>CE|PE)$"
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


def _ordinal(day: int) -> str:
    if 11 <= (day % 100) <= 13:
        suf = "TH"
    else:
        suf = {1: "ST", 2: "ND", 3: "RD"}.get(day % 10, "TH")
    return f"{day}{suf}"


def format_fno_option_label(
    ts: str = "",
    *,
    parsed: Optional[dict[str, Any]] = None,
) -> str:
    """Professional desk label: ``NIFTY 11TH AUG 24800 CE``.

    Falls back to the raw tradingsymbol when parsing fails.
    """
    info = parsed if parsed is not None else parse_fno_option_symbol(ts or "")
    if not info:
        return (ts or "").strip() or "—"
    idx = info.get("index") or ""
    strike = info.get("strike")
    side = info.get("side") or ""
    day = info.get("expiry_day")
    iso = str(info.get("expiry_iso") or "")
    mon = None
    if iso and len(iso) >= 7:
        try:
            mon = MON_NAME.get(int(iso[5:7]))
        except Exception:
            mon = None
    if not mon:
        code = str(info.get("expiry_code") or "")
        if len(code) >= 3 and code[:3] in MON:
            mon = code[:3]
        elif code[:1].isdigit():
            try:
                mon = MON_NAME.get(int(code[0]))
            except Exception:
                mon = None
    parts = [idx]
    if day:
        parts.append(_ordinal(int(day)))
    if mon:
        parts.append(mon)
    if strike is not None:
        parts.append(str(int(strike)))
    if side:
        parts.append(side)
    return " ".join(parts) if len(parts) > 1 else (ts or "—")


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
            "expiry_kind": "weekly",
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
            "expiry_kind": "monthly",
        }

    m = _MCX_MONTHLY.match(ts)
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
            "expiry_kind": "monthly",
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
            "expiry_kind": "weekly",
        }

    return None
