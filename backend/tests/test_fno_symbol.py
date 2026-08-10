from fno_symbol import parse_fno_option_symbol


def test_weekly_mmm_dd():
    p = parse_fno_option_symbol("NIFTY26AUG1123050PE")
    assert p is not None
    assert p["index"] == "NIFTY"
    assert p["strike"] == 23050
    assert p["side"] == "PE"
    assert p["expiry_iso"] == "2026-08-11"


def test_monthly():
    p = parse_fno_option_symbol("NIFTY26AUG23050CE")
    assert p is not None
    assert p["strike"] == 23050
    assert p["side"] == "CE"
    assert p["expiry_iso"].startswith("2026-08-")


def test_compact_weekly():
    p = parse_fno_option_symbol("NIFTY2681123050PE")
    assert p is not None
    assert p["strike"] == 23050
    assert p["expiry_iso"] == "2026-08-11"


def test_sensex():
    p = parse_fno_option_symbol("SENSEX26AUG1481000CE")
    assert p is not None
    assert p["index"] == "SENSEX"
    assert p["strike"] == 81000


def test_non_option():
    assert parse_fno_option_symbol("NIFTY25AUGFUT") is None
