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
    assert p["expiry_iso"] == "2026-08-25"
    assert p["expiry_kind"] == "monthly"


def test_sensex_monthly():
    p = parse_fno_option_symbol("SENSEX26AUG81000CE")
    assert p is not None
    assert p["index"] == "SENSEX"
    assert p["expiry_iso"] == "2026-08-27"
    assert p["expiry_kind"] == "monthly"


def test_compact_weekly():
    p = parse_fno_option_symbol("NIFTY2681123050PE")
    assert p is not None
    assert p["strike"] == 23050
    assert p["expiry_iso"] == "2026-08-11"


def test_compact_bse_weekly_month_codes():
    call = parse_fno_option_symbol("SENSEX2600174000CE")
    put = parse_fno_option_symbol("SENSEX2600171500PE")
    october_letter = parse_fno_option_symbol("SENSEX26O0174000CE")
    november = parse_fno_option_symbol("SENSEX26N0174000CE")
    december = parse_fno_option_symbol("SENSEX26D0174000PE")

    assert call is not None and put is not None and october_letter is not None
    assert call["index"] == "SENSEX"
    assert call["strike"] == 74000
    assert call["side"] == "CE"
    assert call["expiry_iso"] == "2026-10-01"
    assert put["strike"] == 71500
    assert put["side"] == "PE"
    assert put["expiry_iso"] == "2026-10-01"
    assert october_letter["expiry_iso"] == "2026-10-01"
    assert november is not None and november["expiry_iso"] == "2026-11-01"
    assert december is not None and december["expiry_iso"] == "2026-12-01"


def test_sensex():
    p = parse_fno_option_symbol("SENSEX26AUG1481000CE")
    assert p is not None
    assert p["index"] == "SENSEX"
    assert p["strike"] == 81000


def test_non_option():
    assert parse_fno_option_symbol("NIFTY25AUGFUT") is None


def test_mcx_naturalgas_three_digit_strike():
    p = parse_fno_option_symbol("NATURALGAS26AUG250CE")
    assert p is not None
    assert p["index"] == "NATURALGAS"
    assert p["strike"] == 250
    assert p["side"] == "CE"


def test_mcx_crude_monthly():
    p = parse_fno_option_symbol("CRUDEOIL26AUG5400PE")
    assert p is not None
    assert p["index"] == "CRUDEOIL"
    assert p["strike"] == 5400
