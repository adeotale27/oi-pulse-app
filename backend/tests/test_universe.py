from universe import (
    DESK_IDS,
    desk_index_config,
    is_pollable,
    normalize_id,
    order_desk,
    fno_name_alternation,
    catalog_public,
)


def test_desk_unchanged():
    assert DESK_IDS == ("NIFTY", "SENSEX", "BANKNIFTY")
    cfg = desk_index_config()
    assert set(cfg) == set(DESK_IDS)
    assert cfg["NIFTY"]["quote_symbol"] == "NSE:NIFTY 50"
    assert cfg["NIFTY"]["step"] == 50
    assert cfg["SENSEX"]["segment"] == "BFO-OPT"
    assert cfg["BANKNIFTY"]["quote_symbol"] == "NSE:NIFTY BANK"


def test_mcx_catalog_not_pollable():
    for uid in ("CRUDEOIL", "GOLD", "SILVER", "NATURALGAS"):
        assert is_pollable(uid) is False
    assert is_pollable("NIFTY") is True
    ids = {row["id"] for row in catalog_public()}
    assert {"CRUDEOIL", "GOLD", "SILVER", "NATURALGAS"}.issubset(ids)


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
