"""
NSE market hours helper (IST timezone).

Defaults aligned with Index F&O / CAS rules (effective 2026-08-03):
  • Display open  : 09:15 IST
  • Poll open     : 09:14 IST (1 min pre-open so 15-min compare works at 09:15)
  • Poll close    : 15:41 IST (1 min after Index F&O close at 15:40)

Admin Settings can override open/close via configure_hours().

Holiday list must stay in sync with frontend/src/lib/holidays.js
(official NSE circular dates).
"""
from datetime import datetime, timedelta, time as dtime, timezone, date
from typing import Optional, Tuple, Set

IST = timezone(timedelta(hours=5, minutes=30))

# Module defaults — mutated by configure_hours() when admin saves settings.
_DISPLAY_OPEN = dtime(9, 15)
_POLL_OPEN = dtime(9, 14)
_POLL_CLOSE = dtime(15, 41)  # Index F&O closes 15:40; keep one tick after

# Back-compat aliases used across the codebase
MARKET_OPEN = _POLL_OPEN
MARKET_CLOSE = _POLL_CLOSE

# NSE trading holidays — keep aligned with frontend/src/lib/holidays.js
# Sources: NSE circulars for 2025 & 2026 (CMTR71775 etc.).
NSE_HOLIDAYS_2025 = {
    "2025-02-26",  # Mahashivratri
    "2025-03-14",  # Holi
    "2025-03-31",  # Id-Ul-Fitr
    "2025-04-10",  # Mahavir Jayanti
    "2025-04-14",  # Ambedkar Jayanti
    "2025-04-18",  # Good Friday
    "2025-05-01",  # Maharashtra Day
    "2025-08-15",  # Independence Day
    "2025-08-27",  # Ganesh Chaturthi
    "2025-10-02",  # Gandhi Jayanti / Dussehra
    "2025-10-21",  # Diwali Laxmi Pujan (Muhurat only — treat as holiday for OI poll)
    "2025-10-22",  # Balipratipada
    "2025-11-05",  # Guru Nanak Jayanti
    "2025-12-25",  # Christmas
}

NSE_HOLIDAYS_2026 = {
    "2026-01-26",  # Republic Day
    "2026-03-03",  # Holi
    "2026-03-26",  # Ram Navami
    "2026-03-31",  # Mahavir Jayanti
    "2026-04-03",  # Good Friday
    "2026-04-14",  # Ambedkar Jayanti
    "2026-05-01",  # Maharashtra Day
    "2026-05-28",  # Bakri Id
    "2026-06-26",  # Muharram
    "2026-09-14",  # Ganesh Chaturthi
    "2026-10-02",  # Gandhi Jayanti
    "2026-10-20",  # Dussehra
    "2026-11-08",  # Diwali Laxmi Pujan (Muhurat only)
    "2026-11-10",  # Balipratipada
    "2026-11-24",  # Guru Nanak Jayanti
    "2026-12-25",  # Christmas
}

NSE_HOLIDAYS: Set[str] = NSE_HOLIDAYS_2025 | NSE_HOLIDAYS_2026


def _parse_hm(value: str, fallback: dtime) -> dtime:
    try:
        parts = str(value).strip().split(":")
        h, m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        if 0 <= h <= 23 and 0 <= m <= 59:
            return dtime(h, m)
    except Exception:
        pass
    return fallback


def configure_hours(open_ist: Optional[str] = None, close_ist: Optional[str] = None) -> Tuple[dtime, dtime]:
    """Apply admin-configured display open/close. Poll window = open−1m … close+1m."""
    global _DISPLAY_OPEN, _POLL_OPEN, _POLL_CLOSE, MARKET_OPEN, MARKET_CLOSE
    if open_ist:
        disp_open = _parse_hm(open_ist, _DISPLAY_OPEN)
        _DISPLAY_OPEN = disp_open
        # Poll 1 minute early so history windows are warm at display-open.
        total = disp_open.hour * 60 + disp_open.minute
        early = max(0, total - 1)
        _POLL_OPEN = dtime(early // 60, early % 60)
    if close_ist:
        disp_close = _parse_hm(close_ist, dtime(15, 40))
        # Poll 1 minute past close for a final snapshot.
        total = disp_close.hour * 60 + disp_close.minute + 1
        if total >= 24 * 60:
            total = 24 * 60 - 1
        _POLL_CLOSE = dtime(total // 60, total % 60)
    MARKET_OPEN = _POLL_OPEN
    MARKET_CLOSE = _POLL_CLOSE
    return _DISPLAY_OPEN, dtime(
        (_POLL_CLOSE.hour * 60 + _POLL_CLOSE.minute - 1) // 60,
        (_POLL_CLOSE.hour * 60 + _POLL_CLOSE.minute - 1) % 60,
    )


def display_hours() -> Tuple[str, str]:
    """Return (open_hhmm, close_hhmm) as shown in Admin Settings / banners."""
    close_min = _POLL_CLOSE.hour * 60 + _POLL_CLOSE.minute - 1
    if close_min < 0:
        close_min = 0
    close = dtime(close_min // 60, close_min % 60)
    return (
        f"{_DISPLAY_OPEN.hour:02d}:{_DISPLAY_OPEN.minute:02d}",
        f"{close.hour:02d}:{close.minute:02d}",
    )


def now_ist() -> datetime:
    return datetime.now(IST)


def is_holiday(d: datetime) -> bool:
    return d.strftime("%Y-%m-%d") in NSE_HOLIDAYS


def is_weekend(d: datetime) -> bool:
    return d.weekday() >= 5  # 5=Sat, 6=Sun


def is_trading_day(d: datetime) -> bool:
    return not is_weekend(d) and not is_holiday(d)


def is_market_open(dt: datetime = None) -> bool:
    dt = dt or now_ist()
    if not is_trading_day(dt):
        return False
    t = dt.time()
    return _POLL_OPEN <= t <= _POLL_CLOSE


def previous_trading_day(dt: datetime = None) -> date:
    """Most recent NSE trading day strictly before `dt` (IST date)."""
    dt = dt or now_ist()
    candidate = (dt - timedelta(days=1)).date()
    for _ in range(15):
        probe = datetime.combine(candidate, dtime(12, 0), IST)
        if is_trading_day(probe):
            return candidate
        candidate = (datetime.combine(candidate, dtime(0, 0), IST) - timedelta(days=1)).date()
    return candidate


def session_anchor_date(dt: datetime = None) -> date:
    """Trading date whose OI session should be shown right now.

    • Open / post-close on a trading day → that day
    • Pre-open / weekend / holiday → previous trading day
    """
    dt = dt or now_ist()
    if is_weekend(dt) or is_holiday(dt):
        return previous_trading_day(dt)
    if dt.time() < _POLL_OPEN:
        return previous_trading_day(dt)
    return dt.date()


def session_window_utc(anchor: date = None, dt: datetime = None) -> Tuple[datetime, datetime]:
    """Return (start_utc, end_utc) ISO-ready datetimes for an NSE session day."""
    dt = dt or now_ist()
    anchor = anchor or session_anchor_date(dt)
    start_ist = datetime.combine(anchor, _DISPLAY_OPEN, IST)
    close_min = _POLL_CLOSE.hour * 60 + _POLL_CLOSE.minute - 1
    close_t = dtime(max(0, close_min) // 60, max(0, close_min) % 60)
    end_ist = datetime.combine(anchor, close_t, IST)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def next_market_open(dt: datetime = None) -> datetime:
    """Return the next datetime (IST) at which the market will be open."""
    dt = dt or now_ist()
    candidate = dt.replace(hour=_POLL_OPEN.hour, minute=_POLL_OPEN.minute,
                           second=0, microsecond=0)
    if dt < candidate and is_trading_day(dt):
        return candidate
    d = dt + timedelta(days=1)
    for _ in range(15):
        d = d.replace(hour=_POLL_OPEN.hour, minute=_POLL_OPEN.minute,
                      second=0, microsecond=0)
        if is_trading_day(d):
            return d
        d = d + timedelta(days=1)
    return d


def seconds_until_next_open(dt: datetime = None) -> int:
    dt = dt or now_ist()
    return max(0, int((next_market_open(dt) - dt).total_seconds()))


def market_status() -> dict:
    dt = now_ist()
    open_ = is_market_open(dt)
    t = dt.time()
    disp_open, disp_close = display_hours()
    anchor = session_anchor_date(dt)

    if is_weekend(dt):
        phase = "weekend"
        banner_title = "Markets closed for the weekend"
        banner_detail = (
            f"NSE trading resumes on the next business day at {disp_open} IST. "
            f"Displaying the last session ({anchor.isoformat()}) from our database."
        )
    elif is_holiday(dt):
        phase = "holiday"
        banner_title = "Markets closed — NSE holiday"
        banner_detail = (
            f"Trading is suspended today. Displaying the last session "
            f"({anchor.isoformat()}) from our database."
        )
    elif open_:
        phase = "open"
        banner_title = None
        banner_detail = None
    elif t < _POLL_OPEN:
        phase = "pre_open"
        banner_title = "Markets have not opened yet"
        banner_detail = (
            f"NSE opens at {disp_open} IST. Live Open Interest polling will begin shortly. "
            f"Displaying the last session ({anchor.isoformat()}) from our database."
        )
    else:
        phase = "post_close"
        banner_title = "Markets closed for the day"
        banner_detail = (
            f"NSE closed for the day (configured close {disp_close} IST). "
            f"Displaying today's final snapshot — OI polling paused; GIFT Nifty continues. "
            f"Data resumes at {disp_open} IST next trading day."
        )

    # CAS reference (informational — not the poll window)
    fno_continuous_close_ist = "15:15"
    equity_close_ist = "15:30"
    index_fno_close_ist = "15:40"

    auto_square_off_times = {
        "equity_cas": "15:10",
        "equity_non_cas": "15:25",
        "index_and_stock_fno": "15:25",
    }

    closing_auction_note = (
        "From 2026-08-03: Stocks in the F&O segment stop continuous trading at 15:15 IST followed by a Closing Auction Session; "
        "other stocks close at 15:30 IST; index and stock F&O contracts close at 15:40 IST. "
        f"This app polls OI until the configured close ({disp_close} IST). After close, only GIFT Nifty is polled."
    )

    return {
        "is_market_open": open_,
        "phase": phase,
        "banner_title": banner_title,
        "banner_detail": banner_detail,
        "now_ist": dt.isoformat(),
        "market_open_ist": f"{_POLL_OPEN.hour:02d}:{_POLL_OPEN.minute:02d}",
        "market_close_ist": f"{_POLL_CLOSE.hour:02d}:{_POLL_CLOSE.minute:02d}",
        "display_open_ist": disp_open,
        "display_close_ist": disp_close,
        "session_anchor_date": anchor.isoformat(),
        "fno_continuous_close_ist": fno_continuous_close_ist,
        "equity_close_ist": equity_close_ist,
        "index_fno_close_ist": index_fno_close_ist,
        "closing_auction_note": closing_auction_note,
        "auto_square_off_times": auto_square_off_times,
        "is_weekend": is_weekend(dt),
        "is_holiday": is_holiday(dt),
        "holidays": sorted(NSE_HOLIDAYS),
        "next_market_open_ist": next_market_open(dt).isoformat() if not open_ else None,
        "seconds_until_next_open": seconds_until_next_open(dt) if not open_ else 0,
    }


# Weekday → default alert indices (Mon=0 … Fri=4)
# Mon/Tue/Fri → NIFTY weekly expiry focus; Wed/Thu → SENSEX weekly expiry focus.
WEEKDAY_ALERT_DEFAULTS = {
    0: ["NIFTY"],       # Monday
    1: ["NIFTY"],       # Tuesday
    2: ["SENSEX"],      # Wednesday
    3: ["SENSEX"],      # Thursday
    4: ["NIFTY"],       # Friday
}


def default_alert_indices_for_today(dt: datetime = None) -> list:
    dt = dt or now_ist()
    return list(WEEKDAY_ALERT_DEFAULTS.get(dt.weekday(), ["NIFTY", "SENSEX"]))
