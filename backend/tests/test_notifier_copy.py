from datetime import datetime, timedelta, timezone

from notifier import format_eod_html, format_huge_shift_html, next_session_notes

IST = timezone(timedelta(hours=5, minutes=30))


def test_huge_shift_copy_is_desk_not_buy_sell_spam():
    html = format_huge_shift_html(
        {
            "index": "NIFTY",
            "side": "PE",
            "direction": "build",
            "value": 21_000_000,
            "window": 15,
            "price": 24800,
            "atm": 24800,
            "contributing": [{"strike": 24800, "ce_delta": 0, "pe_delta": 5_000_000}],
        },
        is_major=True,
    )
    assert "BUY BUY" not in html
    assert "NIFTY" in html
    assert "never send your book" in html.lower()
    assert "quantity" not in html


def test_eod_html_has_next_session_and_no_positions():
    html = format_eod_html(
        {
            "date": "2026-08-14",
            "alerts_total": 2,
            "indices": [{"index": "NIFTY", "closing_price": 24800, "atm": 24800, "total_alerts": 2}],
        },
        next_notes=["Next session: Mon 17 Aug 2026"],
    )
    assert "15:15" in html
    assert "never send positions" in html.lower()
    assert "Next session" in html
    assert "quantity" not in html
    assert "booked_pnl" not in html


def test_next_session_notes_weekend():
    sat = datetime(2026, 8, 15, 16, 0, tzinfo=IST)
    notes = next_session_notes(sat)
    assert any("Next session" in n for n in notes)
