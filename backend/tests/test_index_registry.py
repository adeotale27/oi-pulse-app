from index_registry import (
    capabilities_from_flags,
    extra_poll_cfg,
    infer_step,
    inspect_underlying,
    summarize_underlyings,
)


def test_infer_step():
    assert infer_step([100, 150, 200, 250]) == 50
    assert infer_step([]) == 50


def test_capabilities_options_gate_oi():
    yes = capabilities_from_flags(live_price=True, futures=True, options=True)
    no = capabilities_from_flags(live_price=True, futures=True, options=False)
    assert yes["optionOI"] and yes["oiChange"] and yes["straddle"]
    assert not no["optionOI"] and not no["oiChange"]


def _opt(name, itype, strike, expiry, exch="NFO", seg="NFO-OPT"):
    return {
        "name": name,
        "instrument_type": itype,
        "strike": strike,
        "expiry": expiry,
        "exchange": exch,
        "segment": seg,
        "tradingsymbol": f"{name}{itype}{strike}",
    }


def test_summarize_and_inspect_finnifty():
    rows = [
        _opt("FINNIFTY", "CE", 25000, "2026-08-18"),
        _opt("FINNIFTY", "PE", 25000, "2026-08-18"),
        _opt("FINNIFTY", "CE", 25100, "2026-08-18"),
        _opt("FINNIFTY", "PE", 25100, "2026-08-18"),
        {
            "name": "FINNIFTY",
            "instrument_type": "FUT",
            "strike": 0,
            "expiry": "2026-08-25",
            "exchange": "NFO",
            "segment": "NFO-FUT",
            "tradingsymbol": "FINNIFTY25AUGFUT",
        },
        _opt("NIFTY", "CE", 24500, "2026-08-20"),
        _opt("NIFTY", "PE", 24500, "2026-08-20"),
    ]
    found = summarize_underlyings(rows, q="FINN", limit=10)
    assert any(r["id"] == "FINNIFTY" for r in found)
    fin = next(r for r in found if r["id"] == "FINNIFTY")
    assert fin["capabilities"]["options"] is True
    assert fin["capabilities"]["optionOI"] is True
    info = inspect_underlying(rows, "FINNIFTY")
    assert info["can_enable_oi"] is True
    assert info["config"]["name"] == "FINNIFTY"
    assert info["config"]["quote_symbol"] == "NSE:NIFTY FIN SERVICE"
    assert info["step"] == 100


def test_inspect_crudeoil_nearest_fut():
    rows = [
        {
            "name": "CRUDEOIL",
            "instrument_type": "FUT",
            "strike": 0,
            "expiry": "2099-01-20",
            "exchange": "MCX",
            "segment": "MCX-FUT",
            "tradingsymbol": "CRUDEOIL99JANFUT",
        },
        {
            "name": "CRUDEOIL",
            "instrument_type": "FUT",
            "strike": 0,
            "expiry": "2099-02-19",
            "exchange": "MCX",
            "segment": "MCX-FUT",
            "tradingsymbol": "CRUDEOIL99FEBFUT",
        },
        _opt("CRUDEOIL", "CE", 5400, "2026-08-17", exch="MCX", seg="MCX-OPT"),
        _opt("CRUDEOIL", "PE", 5400, "2026-08-17", exch="MCX", seg="MCX-OPT"),
        _opt("CRUDEOIL", "CE", 5450, "2026-08-17", exch="MCX", seg="MCX-OPT"),
        _opt("CRUDEOIL", "PE", 5450, "2026-08-17", exch="MCX", seg="MCX-OPT"),
    ]
    info = inspect_underlying(rows, "CRUDEOIL")
    assert info["can_enable_oi"] is True
    assert info["quote_kind"] == "mcx_fut"
    assert info["config"]["segment"] == "MCX-OPT"
    assert info["config"]["quote_symbol"] == "MCX:CRUDEOIL99JANFUT"
    assert "CRUDEOIL" in (info.get("hint") or "")
    assert info["step"] == 50


def test_inspect_fut_only_cannot_enable_oi():
    rows = [
        {
            "name": "FOOIDX",
            "instrument_type": "FUT",
            "strike": 0,
            "expiry": "2026-09-01",
            "exchange": "NFO",
            "segment": "NFO-FUT",
            "tradingsymbol": "FOOIDX25SEPFUT",
        }
    ]
    info = inspect_underlying(rows, "FOOIDX")
    assert info["can_enable_oi"] is False
    assert info["capabilities"]["options"] is False


def test_inspect_gold_mcx_segment_without_opt_suffix():
    rows = [
        {
            "name": "GOLD",
            "instrument_type": "FUT",
            "strike": 0,
            "expiry": "2026-08-20",
            "exchange": "MCX",
            "segment": "MCX",
            "tradingsymbol": "GOLD26AUGFUT",
        },
        _opt("GOLD", "CE", 100000, "2026-08-20", exch="MCX", seg="MCX"),
        _opt("GOLD", "PE", 100000, "2026-08-20", exch="MCX", seg="MCX"),
        _opt("GOLD", "CE", 100500, "2026-08-20", exch="MCX", seg="MCX"),
        _opt("GOLD", "PE", 100500, "2026-08-20", exch="MCX", seg="MCX"),
    ]
    info = inspect_underlying(rows, "GOLD")
    assert info["can_enable_oi"] is True
    assert info["config"]["name"] == "GOLD"
    assert info["config"]["segment"] == "MCX"


def test_extra_poll_cfg_fills_name():
    row = extra_poll_cfg({
        "_id": "GOLD",
        "quote_symbol": "MCX:GOLD26AUGFUT",
        "segment": "MCX-OPT",
        "quote_kind": "mcx_fut",
    })
    assert row["name"] == "GOLD"
    assert extra_poll_cfg({"_id": "X"}) is None
