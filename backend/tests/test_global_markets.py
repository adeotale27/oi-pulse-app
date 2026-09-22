from global_markets import INSTRUMENTS, normalize
from market_memory import _levels


def test_global_registry_keeps_provider_symbols_separate_from_display_symbols():
    eurusd = next(item for item in INSTRUMENTS if item["id"] == "eurusd")
    assert eurusd["displaySymbol"] == "EURUSD"
    assert eurusd["providerSymbol"] == "EUR/USD"


def test_normalized_crypto_is_247_and_unavailable_quote_is_honest():
    btc = next(item for item in INSTRUMENTS if item["id"] == "btcusd")
    no_quote = normalize(btc, None)
    assert no_quote["available"] is False
    assert no_quote["marketStatus"] == "24/7"
    quote = normalize(btc, {"last_price": 100.0, "change": 1, "change_percent": 1})
    assert quote["available"] is True
    assert quote["price"] == 100.0


def test_memory_levels_are_derived_from_existing_snapshot_fields():
    levels = _levels({"price": 23500, "prev_close": 23400, "atm": 23500, "strikes": [{"strike": 23450, "ce_oi": 10, "pe_oi": 20}]})
    assert {row["levelType"] for row in levels} >= {"PREVIOUS_CLOSE", "ATM", "CALL_OI"}
