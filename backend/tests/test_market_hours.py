from datetime import datetime, timezone, timedelta, time as dtime

from market_hours import (
    is_trading_day,
    is_journal_session_day,
    is_special_session_day,
    is_holiday,
    is_full_holiday,
    is_market_open,
    mark_quote_session_live,
    session_poll_bounds,
    eod_lock_time,
    session_anchor_date,
)


IST = timezone(timedelta(hours=5, minutes=30))


def _d(y, m, d, hh=12, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


def setup_function():
    mark_quote_session_live(False)


def test_muhurat_is_a_trading_day_for_oi():
    muhurat = _d(2025, 10, 21)
    assert is_holiday(muhurat) is True
    assert is_full_holiday(muhurat) is False
    assert is_special_session_day(muhurat) is True
    assert is_trading_day(muhurat) is True
    assert is_journal_session_day(muhurat) is True
    start, end = session_poll_bounds(muhurat)
    assert start == dtime(13, 29)
    assert end == dtime(14, 46)
    assert is_market_open(_d(2025, 10, 21, 10, 0)) is False
    assert is_market_open(_d(2025, 10, 21, 13, 30)) is True
    assert is_market_open(_d(2025, 10, 21, 14, 20)) is True
    assert is_market_open(_d(2025, 10, 21, 15, 0)) is False
    assert eod_lock_time(muhurat) == dtime(14, 50)
    assert session_anchor_date(_d(2025, 10, 21, 14, 0)).isoformat() == "2025-10-21"
    assert session_anchor_date(_d(2025, 10, 21, 10, 0)).isoformat() == "2025-10-20"


def test_fresh_kite_print_opens_a_closed_calendar_day():
    republic = _d(2026, 1, 26, 11, 0)
    assert is_market_open(republic) is False
    mark_quote_session_live(True)
    assert is_market_open(republic) is True
    mark_quote_session_live(False)


def test_full_holidays_are_closed_for_journal_and_oi():
    republic = _d(2026, 1, 26)
    bali = _d(2026, 11, 10)
    assert is_trading_day(republic) is False
    assert is_journal_session_day(republic) is False
    assert is_special_session_day(republic) is False
    assert is_journal_session_day(bali) is False


def test_weekend_never_journal_session():
    assert is_journal_session_day(_d(2026, 8, 15)) is False
    assert is_journal_session_day(_d(2026, 8, 16)) is False


def test_regular_weekday_is_both():
    fri = _d(2026, 8, 14)
    assert is_trading_day(fri) is True
    assert is_journal_session_day(fri) is True


def test_mcx_evening_hours_not_nse_cash():
    from market_hours import is_mcx_hours, is_oi_session_open
    eve = _d(2026, 8, 14, 20, 0)
    assert is_market_open(eve) is False
    assert is_mcx_hours(eve) is True
    assert is_oi_session_open(eve, mcx=False) is False
    assert is_oi_session_open(eve, mcx=True) is True
    assert is_mcx_hours(_d(2026, 8, 15, 20, 0)) is False  # Saturday
    assert is_oi_session_open(_d(2026, 8, 14, 10, 0), mcx=True) is True
