import pandas as pd

from holiday_calendar import parse_holidays
from market_hours import (
    apply_uploaded_holidays,
    clear_uploaded_holidays,
    holiday_dates,
    is_full_holiday,
    is_holiday,
    is_special_session_day,
    special_sessions,
)
from test_market_hours import _d


def setup_function():
    clear_uploaded_holidays()


def teardown_function():
    clear_uploaded_holidays()


def test_parse_holidays_full_and_muhurat():
    df = pd.DataFrame([
        {"DATE": "2027-01-26", "NAME": "Republic Day", "SESSION": "", "OPEN": "", "CLOSE": ""},
        {"DATE": "2027-11-08", "NAME": "Diwali Laxmi Pujan", "SESSION": "muhurat", "OPEN": "13:30", "CLOSE": "19:15"},
    ])
    rows, errors = parse_holidays(df)
    assert errors == []
    assert len(rows) == 2
    assert rows[0]["date"] == "2027-01-26"
    assert rows[0]["session"] is None
    assert rows[1]["session"] == "muhurat"
    assert rows[1]["open"] == "13:30"
    assert rows[1]["close"] == "19:15"


def test_parse_holidays_rejects_bad_session_and_duplicate():
    df = pd.DataFrame([
        {"DATE": "2027-01-26", "NAME": "Republic Day", "SESSION": "half-day"},
        {"DATE": "2027-01-26", "NAME": "Again"},
    ])
    rows, errors = parse_holidays(df)
    assert rows == []
    assert any("SESSION" in e for e in errors)


def test_uploaded_year_replaces_builtin_year_only():
    assert "2026-01-26" in holiday_dates()
    apply_uploaded_holidays([
        {"date": "2026-01-26", "name": "Republic Day", "session": None},
        {"date": "2026-11-09", "name": "Diwali Laxmi Pujan", "session": "muhurat", "open": "13:30", "close": "19:15"},
    ])
    dates = holiday_dates()
    assert "2026-01-26" in dates
    assert "2026-11-08" not in dates  # old 2026 muhurat date gone
    assert "2026-11-09" in dates
    assert "2025-10-21" in dates  # other year kept
    assert is_holiday(_d(2026, 11, 9)) is True
    assert is_special_session_day(_d(2026, 11, 9)) is True
    assert is_full_holiday(_d(2026, 11, 9)) is False
    assert special_sessions()["2026-11-09"]["close"] == "19:15"
    assert "2025-10-21" in special_sessions()
