from datetime import date

from expiry_kind import annotate_expiries, expiry_tag, is_monthly_expiry, last_weekday_of_month


def test_nifty_aug_2026_monthly_is_last_tuesday():
    assert last_weekday_of_month(2026, 8, 1) == date(2026, 8, 25)
    assert is_monthly_expiry("2026-08-25", "NIFTY")
    assert expiry_tag("2026-08-25", "NIFTY") == "M"
    assert expiry_tag("2026-09-01", "NIFTY") == "W"
    assert expiry_tag("2026-08-27", "NIFTY") == "W"


def test_sensex_aug_2026_monthly_is_last_thursday():
    assert is_monthly_expiry("2026-08-27", "SENSEX")
    assert expiry_tag("2026-08-27", "SENSEX") == "M"
    assert expiry_tag("2026-08-25", "SENSEX") == "W"


def test_banknifty_follows_last_tuesday():
    assert expiry_tag("2026-08-25", "BANKNIFTY") == "M"
    assert expiry_tag("2026-09-01", "BANKNIFTY") == "W"


def test_annotate_mixed_list():
    meta = annotate_expiries(
        ["2026-08-25", "2026-09-01", "2026-09-08"],
        "NIFTY",
        today=date(2026, 8, 25),
    )
    assert [m["tag"] for m in meta] == ["M", "W", "W"]
    sensex = annotate_expiries(["2026-08-25", "2026-08-27"], "SENSEX", today=date(2026, 8, 25))
    assert [m["tag"] for m in sensex] == ["W", "M"]
