"""Monthly vs weekly F&O expiry (NSE last Tuesday, BSE last Thursday)."""
from __future__ import annotations

import calendar
from datetime import date, datetime
from typing import Any, Iterable, List, Optional, Union

TUESDAY = 1
THURSDAY = 3

DateLike = Union[str, date, datetime]


def _as_date(raw: DateLike) -> Optional[date]:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw or "")[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    last = calendar.monthrange(year, month)[1]
    d = date(year, month, last)
    return date(year, month, last - ((d.weekday() - int(weekday)) % 7))


def monthly_expiry_weekday(index: Any) -> int:
    u = str(index or "").upper().replace(" ", "")
    if "SENSEX" in u or u == "BANKEX":
        return THURSDAY
    # NSE index options: last Tuesday. Other F&O (MCX, leftover BSE) keep Thursday.
    if "NIFTY" in u:
        return TUESDAY
    return THURSDAY


def is_monthly_expiry(raw: DateLike, index: Any = "NIFTY") -> bool:
    d = _as_date(raw)
    if d is None:
        return False
    wd = monthly_expiry_weekday(index)
    return d.weekday() == wd and d == last_weekday_of_month(d.year, d.month, wd)


def expiry_tag(raw: DateLike, index: Any = "NIFTY") -> str:
    return "M" if is_monthly_expiry(raw, index) else "W"


def annotate_expiries(dates: Iterable[DateLike], index: Any = "NIFTY", *, today: Optional[date] = None) -> List[dict]:
    today = today or date.today()
    out = []
    for raw in dates or []:
        d = _as_date(raw)
        if d is None:
            continue
        monthly = is_monthly_expiry(d, index)
        out.append({
            "date": d.isoformat(),
            "tag": "M" if monthly else "W",
            "type": "monthly" if monthly else "weekly",
            "days_to_expiry": (d - today).days,
            "label": d.strftime("%d %b").lstrip("0"),
        })
    return out
