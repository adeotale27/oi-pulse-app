from universe import (
    DESK_IDS,
    MCX_MAJOR_IDS,
    desk_index_config,
    is_pollable,
    normalize_id,
    order_desk,
    fno_name_alternation,
    catalog_public,
    nearest_fut_quote_symbol,
)


def test_heatmap_ids_include_mcx_majors():
    from universe import HEATMAP_IDS
    assert HEATMAP_IDS[:3] == DESK_IDS
    assert set(MCX_MAJOR_IDS).issubset(set(HEATMAP_IDS))
    assert DESK_IDS == ("NIFTY", "SENSEX", "BANKNIFTY")
    cfg = desk_index_config()
    assert set(cfg) == set(DESK_IDS)
    assert cfg["NIFTY"]["quote_symbol"] == "NSE:NIFTY 50"
    assert cfg["NIFTY"]["step"] == 50
    assert cfg["SENSEX"]["segment"] == "BFO-OPT"
    assert cfg["BANKNIFTY"]["quote_symbol"] == "NSE:NIFTY BANK"


def test_mcx_majors_pollable_not_on_desk():
    for uid in MCX_MAJOR_IDS:
        assert is_pollable(uid) is True
        assert uid not in DESK_IDS
    assert is_pollable("NIFTY") is True
    ids = {row["id"] for row in catalog_public()}
    assert set(MCX_MAJOR_IDS).issubset(ids)
    assert set(desk_index_config()) == set(DESK_IDS)


def test_nearest_fut_picks_unexpired():
    rows = [
        {"name": "CRUDEOIL", "instrument_type": "FUT", "expiry": "2026-07-20", "exchange": "MCX", "tradingsymbol": "CRUDEOIL26JULFUT"},
        {"name": "CRUDEOIL", "instrument_type": "FUT", "expiry": "2026-08-19", "exchange": "MCX", "tradingsymbol": "CRUDEOIL26AUGFUT"},
        {"name": "CRUDEOIL", "instrument_type": "FUT", "expiry": "2026-09-18", "exchange": "MCX", "tradingsymbol": "CRUDEOIL26SEPFUT"},
        {"name": "CRUDEOILM", "instrument_type": "FUT", "expiry": "2026-08-19", "exchange": "MCX", "tradingsymbol": "CRUDEOILM26AUGFUT"},
    ]
    from datetime import date
    assert nearest_fut_quote_symbol(rows, "CRUDEOIL", today=date(2026, 8, 15)) == "MCX:CRUDEOIL26AUGFUT"
    assert nearest_fut_quote_symbol(rows, "CRUDEOIL", today=date(2026, 8, 20)) == "MCX:CRUDEOIL26SEPFUT"
    assert nearest_fut_quote_symbol(rows, "CRUDE", today=date(2026, 8, 15)) == "MCX:CRUDEOIL26AUGFUT"


def test_order_desk_drops_future():
    assert order_desk(["GOLD", "BANKNIFTY", "nifty", "BANK"]) == ["NIFTY", "BANKNIFTY"]


def test_aliases_and_fno_alt():
    assert normalize_id("bnf") == "BANKNIFTY"
    assert normalize_id("CRUDE") == "CRUDEOIL"
    alt = fno_name_alternation()
    parts = alt.split("|")
    assert parts.index("BANKNIFTY") < parts.index("NIFTY")
    assert "CRUDEOIL" in parts
    assert "FINNIFTY" in parts


def test_session_group_and_symbol_prefix():
    from universe import session_group_for, match_symbol_prefix, catalog_public
    assert session_group_for("NIFTY") == "nse"
    assert session_group_for("GOLD") == "mcx_non_agri"
    assert session_group_for("CRUDEOIL") == "mcx_non_agri"
    assert session_group_for("UNKNOWNSTOCK", {"segment": "NFO-OPT"}) == "nse"
    assert session_group_for("COTTON", {"session_group": "mcx_select_agri", "segment": "MCX-OPT"}) == "mcx_select_agri"
    assert match_symbol_prefix("GOLD26AUG76000CE") == "GOLD"
    assert match_symbol_prefix("FINNIFTY26AUG25000CE") == "FINNIFTY"
    assert match_symbol_prefix("RELIANCE26AUG1400CE") is None
    rows = {r["id"]: r for r in catalog_public()}
    assert rows["GOLD"]["session_group"] == "mcx_non_agri"
