from datetime import date, datetime, timezone, timedelta

from event_risk_service import (
    build_index_event_dataset,
    classify_event_type,
    event_days_remaining,
    normalize_company_name,
    normalize_symbol,
)


def _c(symbol, name, weight=1.0, **extra):
    return {
        "symbol": normalize_symbol(symbol),
        "company_name": name,
        "normalized_name": normalize_company_name(name),
        "weightage": weight,
        "industry": extra.get("industry", "Bank"),
        "isin": extra.get("isin", "INE000"),
    }


def _e(eid, symbol, name, event_type, event_date, purpose=""):
    return {
        "id": eid,
        "symbol": normalize_symbol(symbol),
        "company_name": name,
        "normalized_name": normalize_company_name(name),
        "event_type": event_type,
        "purpose_raw": purpose or event_type,
        "details": "",
        "event_date": event_date,
    }


def test_classify_financial_results_and_agm():
    assert classify_event_type("Financial Results/Other business matters") == "Quarterly Results"
    assert classify_event_type("Board Meeting") == "Board Meeting"
    assert classify_event_type("Interim Dividend") == "Dividend"
    assert classify_event_type("Annual General Meeting") == "AGM"
    assert classify_event_type("AGM") == "AGM"
    assert classify_event_type("AGM / Financial Results") == "Quarterly Results"
    assert classify_event_type("Buy-back of shares") == "Buyback"
    assert classify_event_type("Stock Split / Sub-division") == "Split"
    assert classify_event_type("Investor Meet") == "Investor Meeting"
    assert classify_event_type("Scheme of Amalgamation") == "Merger"
    assert classify_event_type("Allotment of warrants") == "Other"


def test_normalize_company_name_collapses_ltd():
    assert normalize_company_name("HDFC Bank Limited") == normalize_company_name("HDFC BANK LTD.")
    assert normalize_company_name("HDFC Bank Limited") == "HDFCBANK"


def test_event_days_remaining_uses_explicit_today():
    assert event_days_remaining(date(2026, 8, 15), today=date(2026, 8, 15)) == 0
    assert event_days_remaining(date(2026, 8, 22), today=date(2026, 8, 15)) == 7
    assert event_days_remaining(date(2026, 8, 14), today=date(2026, 8, 15)) == -1


def test_join_by_symbol_skips_non_constituents():
    constituents = [
        _c("HDFCBANK", "HDFC Bank Limited", 12.5),
        _c("RELIANCE", "Reliance Industries Limited", 9.1),
    ]
    events = [
        _e("1", "HDFCBANK", "HDFC Bank Limited", "Quarterly Results", "2026-08-20"),
        _e("2", "ACE", "Action Construction Equipment Limited", "Quarterly Results", "2026-08-20"),
        _e("3", "RELIANCE", "Reliance Industries Limited", "Board Meeting", "2026-08-16"),
    ]
    rows = build_index_event_dataset(constituents, events, "NIFTY")
    assert {r["symbol"] for r in rows} == {"HDFCBANK", "RELIANCE"}
    hdfc = next(r for r in rows if r["symbol"] == "HDFCBANK")
    assert hdfc["company_name"] == "HDFC Bank Limited"
    assert hdfc["constituents"] == hdfc["company_name"]
    assert hdfc["weightage"] == 12.5
    assert hdfc["event_type"] == "Quarterly Results"
    assert hdfc["index"] == "NIFTY"


def test_join_falls_back_to_normalized_company_name():
    constituents = [_c("INFY", "Infosys Limited", 6.0)]
    events = [
        _e("1", "", "Infosys Ltd.", "Dividend", "2026-09-01"),
    ]
    rows = build_index_event_dataset(constituents, events, "NIFTY")
    assert len(rows) == 1
    assert rows[0]["symbol"] == "INFY"
    assert rows[0]["event_type"] == "Dividend"


def test_join_sorts_results_ahead_of_other_types():
    constituents = [_c("TCS", "Tata Consultancy Services Limited", 4.0)]
    events = [
        _e("d", "TCS", "Tata Consultancy Services Limited", "Dividend", "2026-08-16"),
        _e("q", "TCS", "Tata Consultancy Services Limited", "Quarterly Results", "2026-08-28"),
    ]
    rows = build_index_event_dataset(constituents, events, "NIFTY")
    assert [r["event_type"] for r in rows] == ["Quarterly Results", "Dividend"]


def test_past_events_stay_in_payload_with_negative_days(monkeypatch):
    import event_risk_service as ers

    ist = timezone(timedelta(hours=5, minutes=30))
    monkeypatch.setattr(
        ers, "now_ist", lambda: datetime(2026, 8, 15, 10, 0, tzinfo=ist)
    )
    constituents = [_c("SBIN", "State Bank of India", 3.0)]
    events = [
        _e("old", "SBIN", "State Bank of India", "Quarterly Results", "2026-08-10"),
        _e("soon", "SBIN", "State Bank of India", "Quarterly Results", "2026-08-18"),
        _e("bm", "SBIN", "State Bank of India", "Board Meeting", "2026-08-16"),
    ]
    rows = build_index_event_dataset(constituents, events, "BANKNIFTY")
    by_id = {r["id"]: r for r in rows}
    assert by_id["old"]["days_remaining"] == -5
    assert by_id["soon"]["days_remaining"] == 3
    assert by_id["bm"]["days_remaining"] == 1
    # Type priority first; within a type, past dates sort after upcoming.
    assert [r["id"] for r in rows] == ["soon", "old", "bm"]
