from desk_tickers import merge_ticker_row, pick_quote_blob, ticker_symbol_list, CORE_SYMBOLS


def test_merge_uses_snapshot_when_kite_ltp_zero():
    row = merge_ticker_row(
        "SENSEX",
        "SENSEX",
        kite_blob={"last_price": 0, "ohlc": {"close": 81200, "open": 81000}},
        snap={"price": 81150.4, "timestamp": "2026-08-14T10:10:00+00:00"},
    )
    assert row["ltp"] == 81150.4
    assert row["prev_close"] == 81200
    assert row["source"] == "snapshot"
    assert row["change"] == round(81150.4 - 81200, 2)


def test_merge_prefers_kite_ltp():
    row = merge_ticker_row(
        "NIFTY",
        "NIFTY 50",
        kite_blob={"last_price": 24366.2, "ohlc": {"close": 24300, "open": 24280}},
        snap={"price": 24000},
    )
    assert row["ltp"] == 24366.2
    assert row["source"] == "kite"
    assert row["change_pct"] != 0


def test_pick_quote_blob_suffix():
    data = {"BSE:SENSEX": {"last_price": 81111}}
    assert pick_quote_blob(data, "BSE:SENSEX")["last_price"] == 81111
    data2 = {"SENSEX": {"last_price": 80001}}
    assert pick_quote_blob(data2, "BSE:SENSEX")["last_price"] == 80001


def test_core_symbols_include_sensex():
    ids = [s[0] for s in CORE_SYMBOLS]
    assert ids == ["NIFTY", "SENSEX", "BANKNIFTY"]
    listed = ticker_symbol_list(["NIFTY", "SENSEX", "BANKNIFTY"])
    assert [s[0] for s in listed] == ids
