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
    "2025-10-21",  # Diwali Laxmi Pujan (Muhurat session — still on NSE holiday list)
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

# Special live cash/F&O sessions on dates NSE still lists as holidays.
# Hours from NSE circulars (2025: NSE/CMTR/70319 afternoon session).
# 2026 timings TBA — poll the listed window; Kite last_trade_time also gates live.
# Keep aligned with frontend/src/lib/holidays.js session: "muhurat".
NSE_SPECIAL_SESSIONS: dict[str, dict] = {
    "2025-10-21": {
        "name": "Diwali Laxmi Pujan (Muhurat)",
        "open": "13:30",
        "close": "14:45",
    },
    "2026-11-08": {
        "name": "Diwali Laxmi Pujan (Muhurat)",
        "open": "13:30",
        "close": "19:15",
    },
}

# Set from OI tracker when Kite quotes have a fresh last_trade_time (no session API).
_QUOTE_SESSION_LIVE = False


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
    """True if the date is on the NSE holiday circular (includes Muhurat dates)."""
    return d.strftime("%Y-%m-%d") in NSE_HOLIDAYS


def is_weekend(d: datetime) -> bool:
    return d.weekday() >= 5  # 5=Sat, 6=Sun


def is_special_session_day(d: datetime) -> bool:
    return d.strftime("%Y-%m-%d") in NSE_SPECIAL_SESSIONS


def is_full_holiday(d: datetime) -> bool:
    """Closed all day — not Muhurat / other listed special sessions."""
    return is_holiday(d) and not is_special_session_day(d)


def is_trading_day(d: datetime) -> bool:
    """Calendar day with a cash/F&O session (regular hours or Muhurat).

    Kite Connect has no holidays/session-open API (Zerodha: keep NSE's list).
    """
    if is_weekend(d):
        return False
    if is_special_session_day(d):
        return True
    return not is_holiday(d)


def is_journal_session_day(d: datetime) -> bool:
    """Same calendar as OI: weekdays with a session, including Muhurat."""
    return is_trading_day(d)


def mark_quote_session_live(active: bool) -> None:
    """OI tracker: Kite last_trade_time is fresh → treat the tape as open."""
    global _QUOTE_SESSION_LIVE
    _QUOTE_SESSION_LIVE = bool(active)


def quote_session_is_live() -> bool:
    return bool(_QUOTE_SESSION_LIVE)


def special_session_info(d: datetime) -> Optional[dict]:
    return NSE_SPECIAL_SESSIONS.get(d.strftime("%Y-%m-%d"))


def _shift_dtime(t: dtime, minutes: int) -> dtime:
    total = t.hour * 60 + t.minute + minutes
    total = max(0, min(24 * 60 - 1, total))
    return dtime(total // 60, total % 60)


def session_display_bounds(dt: datetime) -> Tuple[dtime, dtime]:
    """Public open/close for this calendar day (special session or admin hours)."""
    info = special_session_info(dt)
    if info:
        return (
            _parse_hm(info.get("open"), dtime(13, 30)),
            _parse_hm(info.get("close"), dtime(14, 45)),
        )
    close_min = _POLL_CLOSE.hour * 60 + _POLL_CLOSE.minute - 1
    close = dtime(max(0, close_min) // 60, max(0, close_min) % 60)
    return _DISPLAY_OPEN, close


def session_poll_bounds(dt: datetime) -> Tuple[dtime, dtime]:
    """Poller window: 1 minute before display open through 1 minute after close."""
    if is_special_session_day(dt):
        disp_open, disp_close = session_display_bounds(dt)
        return _shift_dtime(disp_open, -1), _shift_dtime(disp_close, 1)
    return _POLL_OPEN, _POLL_CLOSE


def eod_lock_time(dt: datetime) -> dtime:
    """When Positions/journal should freeze booked P&L (close + 5 min)."""
    _open, close = session_display_bounds(dt)
    return _shift_dtime(close, 5)


def is_market_open(dt: datetime = None) -> bool:
    """True while NSE cash/F&O should be printing.

    Kite has no exchange-open endpoint. Calendar hours first; a fresh quote
    last_trade_time (set by the OI tracker) covers unlisted / shifted Muhurat.
    """
    dt = dt or now_ist()
    if quote_session_is_live():
        return True
    t = dt.time()
    if is_special_session_day(dt) and is_trading_day(dt):
        start, end = session_poll_bounds(dt)
        return start <= t <= end
    if not is_trading_day(dt):
        return False
    start, end = session_poll_bounds(dt)
    return start <= t <= end


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

    • Open / post-close on a trading day (including Muhurat) → that day
    • Pre-open / weekend / full holiday → previous trading day
    """
    dt = dt or now_ist()
    if is_weekend(dt) or is_full_holiday(dt):
        return previous_trading_day(dt)
    if not is_trading_day(dt):
        return previous_trading_day(dt)
    start, _end = session_poll_bounds(dt)
    if dt.time() < start:
        return previous_trading_day(dt)
    return dt.date()


def session_window_utc(anchor: date = None, dt: datetime = None) -> Tuple[datetime, datetime]:
    """Return (start_utc, end_utc) ISO-ready datetimes for an NSE session day."""
    dt = dt or now_ist()
    anchor = anchor or session_anchor_date(dt)
    probe = datetime.combine(anchor, dtime(12, 0), IST)
    disp_open, disp_close = session_display_bounds(probe)
    start_ist = datetime.combine(anchor, disp_open, IST)
    end_ist = datetime.combine(anchor, disp_close, IST)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def next_market_open(dt: datetime = None) -> datetime:
    """Return the next datetime (IST) at which the market will be open."""
    dt = dt or now_ist()
    if is_trading_day(dt):
        start, _end = session_poll_bounds(dt)
        candidate = dt.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
        if dt < candidate:
            return candidate
    d = dt + timedelta(days=1)
    for _ in range(15):
        d = d.replace(second=0, microsecond=0)
        if is_trading_day(d):
            start, _end = session_poll_bounds(d)
            return d.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
        d = d + timedelta(days=1)
    return d


def seconds_until_next_open(dt: datetime = None) -> int:
    dt = dt or now_ist()
    return max(0, int((next_market_open(dt) - dt).total_seconds()))


def market_status() -> dict:
    dt = now_ist()
    open_ = is_market_open(dt)
    t = dt.time()
    poll_open, poll_close = session_poll_bounds(dt)
    disp_open, disp_close = session_display_bounds(dt)
    disp_open_s = f"{disp_open.hour:02d}:{disp_open.minute:02d}"
    disp_close_s = f"{disp_close.hour:02d}:{disp_close.minute:02d}"
    admin_open, admin_close = display_hours()
    anchor = session_anchor_date(dt)
    special = special_session_info(dt)
    special_name = (special or {}).get("name") or "Muhurat"

    if is_weekend(dt) and not (is_special_session_day(dt) and quote_session_is_live()):
        phase = "weekend"
        banner_title = "Markets closed for the weekend"
        banner_detail = (
            f"NSE trading resumes on the next business day at {admin_open} IST. "
            f"Displaying the last session ({anchor.isoformat()}) from our database."
        )
    elif is_full_holiday(dt) and not quote_session_is_live():
        phase = "holiday"
        banner_title = "Markets closed — NSE holiday"
        banner_detail = (
            f"Trading is suspended today. Displaying the last session "
            f"({anchor.isoformat()}) from our database."
        )
    elif is_special_session_day(dt) and is_trading_day(dt):
        if open_:
            phase = "open"
            banner_title = f"{special_name} session"
            banner_detail = (
                f"Special live trading {disp_open_s}–{disp_close_s} IST. "
                f"Open Interest is polling this session."
            )
        elif t < poll_open:
            phase = "pre_open"
            banner_title = f"{special_name} has not opened yet"
            banner_detail = (
                f"Muhurat / special session opens at {disp_open_s} IST. "
                f"OI polling starts then. Showing the last session ({anchor.isoformat()})."
            )
        else:
            phase = "post_close"
            banner_title = f"{special_name} closed"
            banner_detail = (
                f"Special session ended {disp_close_s} IST. "
                f"Displaying this session's snapshots. Regular hours resume next trading day."
            )
    elif open_:
        phase = "open"
        banner_title = None
        banner_detail = None
    elif t < poll_open:
        phase = "pre_open"
        banner_title = "Markets have not opened yet"
        banner_detail = (
            f"NSE opens at {disp_open_s} IST. Live Open Interest polling will begin shortly. "
            f"Displaying the last session ({anchor.isoformat()}) from our database."
        )
    else:
        phase = "post_close"
        banner_title = "Markets closed for the day"
        banner_detail = (
            f"NSE closed for the day (configured close {disp_close_s} IST). "
            f"Displaying today's final snapshot — OI polling paused; GIFT Nifty continues. "
            f"Data resumes at {admin_open} IST next trading day."
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
        f"This app polls OI until the session close ({disp_close_s} IST). After close, only GIFT Nifty is polled."
    )

    return {
        "is_market_open": open_,
        "phase": phase,
        "banner_title": banner_title,
        "banner_detail": banner_detail,
        "now_ist": dt.isoformat(),
        "market_open_ist": f"{poll_open.hour:02d}:{poll_open.minute:02d}",
        "market_close_ist": f"{poll_close.hour:02d}:{poll_close.minute:02d}",
        "display_open_ist": disp_open_s,
        "display_close_ist": disp_close_s,
        "session_anchor_date": anchor.isoformat(),
        "fno_continuous_close_ist": fno_continuous_close_ist,
        "equity_close_ist": equity_close_ist,
        "index_fno_close_ist": index_fno_close_ist,
        "closing_auction_note": closing_auction_note,
        "auto_square_off_times": auto_square_off_times,
        "is_weekend": is_weekend(dt),
        "is_holiday": is_full_holiday(dt),
        "is_special_session": is_special_session_day(dt),
        "special_session_name": special_name if is_special_session_day(dt) else None,
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
