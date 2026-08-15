from oi_service import INDEX_CONFIG, KiteService, merge_index_config


def test_merge_extra_without_name_field():
    try:
        merge_index_config({
            "GOLD": {
                "quote_symbol": "MCX:GOLD26AUGFUT",
                "segment": "MCX-OPT",
                "quote_kind": "mcx_fut",
                "step": 100,
            }
        })
        assert INDEX_CONFIG["GOLD"]["name"] == "GOLD"
        assert INDEX_CONFIG["GOLD"]["session_group"] == "mcx_non_agri"
        assert INDEX_CONFIG["NIFTY"]["quote_symbol"] == "NSE:NIFTY 50"
        merge_index_config({
            "SILVER": {
                "segment": "MCX-OPT",
                "quote_kind": "mcx_fut",
                "step": 250,
            }
        })
        assert INDEX_CONFIG["SILVER"]["quote_kind"] == "mcx_fut"
        assert INDEX_CONFIG["SILVER"]["name"] == "SILVER"
    finally:
        merge_index_config({})
        assert "GOLD" not in INDEX_CONFIG
        assert "SILVER" not in INDEX_CONFIG


def test_option_chain_accepts_mcx_without_opt_suffix():
    pd = __import__("pytest").importorskip("pandas")

    class Holder:
        instruments_df = pd.DataFrame([
            {"name": "GOLD", "instrument_type": "CE", "segment": "MCX", "expiry": "2026-08-20", "strike": 100000},
            {"name": "GOLD", "instrument_type": "PE", "segment": "MCX", "expiry": "2026-08-20", "strike": 100000},
            {"name": "GOLD", "instrument_type": "FUT", "segment": "MCX-FUT", "expiry": "2026-08-20", "strike": 0},
        ])

    df = KiteService._option_chain_df(Holder(), {"name": "GOLD", "segment": "MCX-OPT"})
    assert df is not None and not df.empty
    assert set(df["instrument_type"]) <= {"CE", "PE"}
