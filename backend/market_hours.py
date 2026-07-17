"""
NSE market hours helper (IST timezone).
Polling window: 9:00 AM – 3:30 PM IST, Mon–Fri (excluding NSE holidays).

We start at 9:00 (not 9:15) so pre-open snapshots are in the DB and a 15-min
comparison already works by 9:15. Retention is handled separately (24h).
"""
from datetime import datetime, timedelta, time as dtime, timezone

IST = timezone(timedelta(hours=5, minutes=30))

MARKET_OPEN = dtime(9, 0)     # start polling early so 15-min history is ready by 9:15
MARKET_CLOSE = dtime(15, 30)

# NSE trading holidays 2026 (equity & derivatives). Update yearly.
NSE_HOLIDAYS_2026 = {
    "2026-01-26",  # Republic Day
    "2026-02-16",  # Mahashivratri (approx)
    "2026-03-04",  # Holi (approx)
    "2026-03-20",  # Good Friday (approx)
    "2026-04-01",  # Annual bank closing
    "2026-04-14",  # Dr Ambedkar Jayanti
    "2026-04-15",  # Mahavir Jayanti (approx)
    "2026-05-01",  # Maharashtra Day
    "2026-05-27",  # Buddha Purnima (approx)
    "2026-08-15",  # Independence Day
    "2026-10-02",  # Gandhi Jayanti
    "2026-10-20",  # Dussehra (approx)
    "2026-11-09",  # Diwali (approx)
    "2026-11-25",  # Guru Nanak Jayanti (approx)
    "2026-12-25",  # Christmas
}


def now_ist() -> datetime:
    return datetime.now(IST)


def is_holiday(d: datetime) -> bool:
    return d.strftime("%Y-%m-%d") in NSE_HOLIDAYS_2026


def is_weekend(d: datetime) -> bool:
    return d.weekday() >= 5  # 5=Sat, 6=Sun


def is_market_open(dt: datetime = None) -> bool:
    dt = dt or now_ist()
    if is_weekend(dt) or is_holiday(dt):
        return False
    t = dt.time()
    return MARKET_OPEN <= t <= MARKET_CLOSE


def next_market_open(dt: datetime = None) -> datetime:
    """Return the next datetime (IST) at which the market will be open."""
    dt = dt or now_ist()
    # today candidate
    candidate = dt.replace(hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute,
                           second=0, microsecond=0)
    if dt < candidate and not is_weekend(dt) and not is_holiday(dt):
        return candidate
    # otherwise walk forward day by day
    d = dt + timedelta(days=1)
    for _ in range(15):  # max ~2 weeks lookahead
        d = d.replace(hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute,
                      second=0, microsecond=0)
        if not is_weekend(d) and not is_holiday(d):
            return d
        d = d + timedelta(days=1)
    return d  # fallback


def seconds_until_next_open(dt: datetime = None) -> int:
    dt = dt or now_ist()
    return max(0, int((next_market_open(dt) - dt).total_seconds()))


def market_status() -> dict:
    dt = now_ist()
    open_ = is_market_open(dt)
    return {
        "is_market_open": open_,
        "now_ist": dt.isoformat(),
        "market_open_ist": "09:00",
        "market_close_ist": "15:30",
        "is_weekend": is_weekend(dt),
        "is_holiday": is_holiday(dt),
        "next_market_open_ist": next_market_open(dt).isoformat() if not open_ else None,
        "seconds_until_next_open": seconds_until_next_open(dt) if not open_ else 0,
    }
