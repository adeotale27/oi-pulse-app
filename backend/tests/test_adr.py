from datetime import datetime, timezone

from adr import (
    DEFAULT_LARGE_MOVE,
    SEED_ADRS,
    et_date_iso,
    is_banking_sector,
    is_de_equity_session,
    is_indian_adr_listing,
    is_listing_session_open,
    is_nyse_holiday,
    is_us_equity_session,
    large_move,
    listing_flag,
    listing_country_code,
    meaningful_new_move,
    normalize_quote,
    now_et,
    public_prefs,
    should_poll_now,
    universe_doc,
    validate_universe_row,
)


INFY_QUOTE = {
    "symbol": "INFY",
    "name": "Infosys Limited",
    "exchange": "NYSE",
    "mic_code": "XNYS",
    "currency": "USD",
    "datetime": "2026-09-16 15:59:00",
    "timestamp": 1758052740,
    "open": "11.30",
    "high": "11.22",
    "low": "11.01",
    "close": "11.08",
    "volume": "11500000",
    "previous_close": "11.32",
    "change": "-0.24",
    "percent_change": "-2.12",
    "average_volume": "9800000",
    "rolling_1d_change": "-2.12",
    "rolling_7d_change": "-1.40",
    "is_market_open": False,
    "fifty_two_week": {
        "low": "9.50",
        "high": "23.10",
        "low_change": "1.58",
        "high_change": "-12.02",
        "low_change_percent": "16.63",
        "high_change_percent": "-52.03",
        "range": "9.50 - 23.10",
    },
}


def test_normalize_infy_quote():
    q = normalize_quote(INFY_QUOTE)
    assert q["symbol"] == "INFY"
    assert q["last_price"] == 11.08
    assert q["change"] == -0.24
    assert q["change_percent"] == -2.12
    assert q["volume"] == 11500000
    assert q["week52_low"] == 9.50
    assert q["currency"] == "USD"
    assert "percent_change" not in q


def test_public_prefs_never_leaks_key():
    pub = public_prefs({"api_key_enc": "gAAAA_secretblob", "api_key": "td_live_key_should_never_leak", "poll_interval_seconds": 300})
    blob = str(pub)
    assert "api_key" not in pub
    assert "api_key_enc" not in pub
    assert "td_live_key_should_never_leak" not in blob
    assert "secretblob" not in blob
    assert pub["poll_interval_seconds"] == 300


def test_indian_adr_filter_excludes_generic_listings():
    assert is_indian_adr_listing({"symbol": "INFY", "exchange": "NYSE", "type": "American Depositary Receipt", "name": "Infosys Limited ADR"})
    assert is_indian_adr_listing({"symbol": "HDB", "exchange": "NYSE", "name": "HDFC Bank"})
    assert is_indian_adr_listing({"symbol": "RIL", "exchange": "XETRA", "name": "Reliance Industries Ltd", "country": "Germany"})
    assert not is_indian_adr_listing({"symbol": "SAP", "exchange": "XETRA", "name": "SAP SE", "country": "Germany"})
    assert not is_indian_adr_listing({"symbol": "AAPL", "exchange": "NASDAQ", "type": "Common Stock", "country": "United States", "name": "Apple Inc"})


def test_seed_covers_required_names():
    ticks = {r["adr_symbol"] for r in SEED_ADRS}
    assert {"INFY", "HDB", "IBN", "WIT", "RDY", "SIFY", "WNS"} <= ticks


def test_large_move_and_dedupe():
    assert large_move({"change_percent": -6.2}, DEFAULT_LARGE_MOVE)
    assert not large_move({"change_percent": -4.9}, 5)
    assert meaningful_new_move(None, -5.1, 5)
    assert not meaningful_new_move(-5.1, -5.3, 5)
    assert meaningful_new_move(-5.1, -7.2, 5)
    assert is_banking_sector("BANKING")
    assert not is_banking_sector("IT")


def test_us_session_dst_holidays_and_close():
    # 09:30 EDT = 13:30 UTC (2026-07-10 Friday)
    assert is_us_equity_session(datetime(2026, 7, 10, 13, 30, tzinfo=timezone.utc))
    # 09:30 EST = 14:30 UTC (2026-01-09 Friday)
    assert is_us_equity_session(datetime(2026, 1, 9, 14, 30, tzinfo=timezone.utc))
    # 16:00 EDT = 20:00 UTC — closed
    assert is_us_equity_session(datetime(2026, 7, 10, 19, 59, tzinfo=timezone.utc))
    assert not is_us_equity_session(datetime(2026, 7, 10, 20, 0, tzinfo=timezone.utc))
    assert is_nyse_holiday("2026-04-03")
    assert not is_us_equity_session(datetime(2026, 4, 3, 15, 0, tzinfo=timezone.utc))
    assert now_et(datetime(2026, 7, 10, 13, 30, tzinfo=timezone.utc)).hour == 9
    assert listing_country_code("XETRA") == "DE"
    assert listing_flag("NYSE") == "🇺🇸"
    assert listing_flag("XETRA") == "🇩🇪"
    assert is_de_equity_session(datetime(2026, 7, 10, 11, 0, tzinfo=timezone.utc))
    assert is_listing_session_open("XETRA", datetime(2026, 7, 10, 11, 0, tzinfo=timezone.utc))
    assert not is_listing_session_open("NYSE", datetime(2026, 7, 10, 11, 0, tzinfo=timezone.utc))


def test_should_poll_us_open_interval_and_close():
    prefs = {"poll_interval_seconds": 300, "indian_open_refresh": True, "enabled": True}
    open_dt = datetime(2026, 7, 10, 13, 30, tzinfo=timezone.utc)
    go, reason = should_poll_now({}, prefs, open_dt)
    assert go and reason == "us_open"
    state = {"last_us_open_day": et_date_iso(open_dt), "last_ok_at": open_dt.isoformat()}
    go, reason = should_poll_now(state, prefs, open_dt)
    assert not go
    later = datetime(2026, 7, 10, 13, 36, tzinfo=timezone.utc)
    go, reason = should_poll_now(state, prefs, later)
    assert go and reason == "interval"
    closed = datetime(2026, 7, 10, 20, 5, tzinfo=timezone.utc)
    go, reason = should_poll_now({**state, "last_ok_at": later.isoformat(), "last_us_open_day": et_date_iso(open_dt)}, prefs, closed)
    assert not go and reason == "us_closed"
    de_hours = datetime(2026, 7, 10, 11, 0, tzinfo=timezone.utc)
    go, reason = should_poll_now({"last_us_open_day": "x"}, prefs, de_hours)
    assert go and reason == "de_open"


def test_ist_open_refresh_once():
    prefs = {"poll_interval_seconds": 300, "indian_open_refresh": True}
    # 2026-08-14 Friday 09:15 IST = 03:45 UTC
    ist_open = datetime(2026, 8, 14, 3, 45, tzinfo=timezone.utc)
    go, reason = should_poll_now({"last_us_open_day": "x"}, prefs, ist_open)
    assert go and reason == "ist_open"
    go, reason = should_poll_now({"last_ist_refresh_day": "2026-08-14", "last_us_open_day": "x"}, prefs, ist_open)
    assert not go


def test_universe_validation():
    assert validate_universe_row({"company_name": "X"}) == "Indian symbol required"
    assert validate_universe_row(universe_doc(SEED_ADRS[0])) == ""
    assert validate_universe_row({**SEED_ADRS[0], "adr_ratio": "nope"}) == "ADR ratio must look like 1:1"
