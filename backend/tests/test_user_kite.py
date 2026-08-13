from datetime import datetime, timedelta

from user_kite import IST, kite_token_valid_until, public_status, token_is_expired


def test_token_issued_after_six_dies_next_morning():
    issued = datetime(2026, 8, 13, 9, 15, tzinfo=IST)
    until = kite_token_valid_until(issued)
    assert until == datetime(2026, 8, 14, 6, 0, tzinfo=IST)
    assert not token_is_expired(until.isoformat(), issued)
    assert token_is_expired(until.isoformat(), datetime(2026, 8, 14, 6, 0, tzinfo=IST))


def test_token_issued_before_six_dies_same_morning():
    issued = datetime(2026, 8, 13, 5, 30, tzinfo=IST)
    until = kite_token_valid_until(issued)
    assert until == datetime(2026, 8, 13, 6, 0, tzinfo=IST)


def test_public_status_empty():
    s = public_status(None)
    assert s["connected"] is False
    assert s["kite_user_id"] is None


def test_public_status_live():
    until = datetime(2026, 8, 14, 6, 0, tzinfo=IST)
    s = public_status(
        {"access_token_enc": "x", "kite_user_id": "AB123", "valid_until": until.isoformat()},
        datetime(2026, 8, 13, 14, 0, tzinfo=IST),
    )
    assert s["connected"] is True
    assert s["expired"] is False
    assert s["kite_user_id"] == "AB123"


def test_public_status_expired():
    until = datetime(2026, 8, 13, 6, 0, tzinfo=IST)
    s = public_status(
        {"access_token_enc": "x", "kite_user_id": "AB123", "valid_until": until.isoformat()},
        datetime(2026, 8, 13, 9, 0, tzinfo=IST),
    )
    assert s["connected"] is False
    assert s["expired"] is True
