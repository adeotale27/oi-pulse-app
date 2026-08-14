from datetime import datetime, timezone, timedelta

from market_hours import is_trading_day, is_journal_session_day, is_special_session_day, is_holiday


IST = timezone(timedelta(hours=5, minutes=30))


def _d(y, m, d):
    return datetime(y, m, d, 12, 0, tzinfo=IST)


def test_oi_poll_still_treats_muhurat_as_holiday():
    muhurat = _d(2025, 10, 21)
    assert is_holiday(muhurat) is True
    assert is_special_session_day(muhurat) is True
    assert is_trading_day(muhurat) is False
    assert is_journal_session_day(muhurat) is True


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
