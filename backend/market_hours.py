"""
NSE market hours helper (IST timezone).
Polling window: 9:00 AM – 3:30 PM IST, Mon–Fri (excluding NSE holidays).

We start at 9:00 (not 9:15) so pre-open snapshots are in the DB and a 15-min
comparison already works by 9:15. Retention is handled separately (24h).
"""
from datetime import datetime, timedelta, time as dtime, timezone

IST = timezone(timedelta(hours=5, minutes=30))

MARKET_OPEN = dtime(9, 14)    # start polling 1 min pre-open so 15-min compare works from 9:15
MARKET_CLOSE = dtime(15, 31)  # keep one snapshot after 3:30 close for the last-bar view

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
    t = dt.time()

    # Phase classification for a professional status banner in the UI.
    if is_weekend(dt):
        phase = "weekend"
        banner_title = "Markets closed for the weekend"
        banner_detail = "NSE trading resumes on the next business day at 9:15 AM IST. Displaying the most recent snapshot from our database."
    elif is_holiday(dt):
        phase = "holiday"
        banner_title = "Markets closed — NSE holiday"
        banner_detail = "Trading is suspended today. Displaying the most recent snapshot from our database."
    elif open_:
        phase = "open"
        banner_title = None
        banner_detail = None
    elif t < MARKET_OPEN:
        phase = "pre_open"
        banner_title = "Markets have not opened yet"
        banner_detail = "NSE opens at 9:15 AM IST. Live Open Interest polling will begin shortly. Displaying the most recent snapshot from our database."
    else:
        phase = "post_close"
        banner_title = "Markets closed for the day"
        banner_detail = "NSE closed for the day. Displaying today's final snapshot from our database — data will resume at 9:15 AM IST on the next trading day."

    # New closing rules effective 2026-08-03 (Closing Auction Session / CAS):
    # - Stocks trading in the F&O segment: continuous trading stops at 15:15 (3:15 PM), followed by a Closing Auction Session (CAS)
    # - All other stocks: trading closes at 15:30 (3:30 PM)
    # - Index and stock F&O contracts: trading closes at 15:40 (3:40 PM)
    # Auto square-off times (effective 2026-08-03):
    # - Equity (stocks under CAS): 15:10
    # - Equity (stocks not under CAS): 15:25
    # - Index and stock F&O contracts: 15:25

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
        "other stocks close at 15:30 IST; index and stock F&O contracts close at 15:40 IST."
    )

    return {
        "is_market_open": open_,
        "phase": phase,
        "banner_title": banner_title,
        "banner_detail": banner_detail,
        "now_ist": dt.isoformat(),
        "market_open_ist": "09:14",
        "market_close_ist": "15:31",  # legacy: one snapshot after the canonical 15:30 close
        "display_open_ist": "09:15",
        "display_close_ist": equity_close_ist,  # legacy field kept for compatibility
        # New fields to show precise closing / CAS / auto-squareoff times below the big clock
        "fno_continuous_close_ist": fno_continuous_close_ist,
        "index_fno_close_ist": index_fno_close_ist,
        "closing_auction_note": closing_auction_note,
        "auto_square_off_times": auto_square_off_times,
        "is_weekend": is_weekend(dt),
        "is_holiday": is_holiday(dt),
        "next_market_open_ist": next_market_open(dt).isoformat() if not open_ else None,
        "seconds_until_next_open": seconds_until_next_open(dt) if not open_ else 0,
    }
