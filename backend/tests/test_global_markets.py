import asyncio
from datetime import datetime, timezone

from global_markets import (
    INSTRUMENTS,
    configured_instruments,
    enabled_provider_items,
    normalize,
    normalize_fmp_quote,
    public_prefs,
    test_fmp_connection as check_fmp_connection,
    fetch_fmp_quotes,
    instrument_session_open,
)
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


def test_global_market_session_gates_closed_venues():
    nasdaq = next(item for item in INSTRUMENTS if item["id"] == "nasdaq")
    crypto = next(item for item in INSTRUMENTS if item["id"] == "btcusd")
    friday_after_close = datetime(2026, 7, 10, 21, 0, tzinfo=timezone.utc)
    assert not instrument_session_open(nasdaq, friday_after_close)
    assert instrument_session_open(crypto, friday_after_close)
    assert normalize(nasdaq, None)["marketStatus"] == "CLOSED"


def test_global_instruments_are_opt_in_until_admin_enables_them():
    rows = asyncio.run(configured_instruments(None))
    assert rows
    assert all(row["enabled"] is False for row in rows)


def test_memory_levels_are_derived_from_existing_snapshot_fields():
    levels = _levels({"price": 23500, "prev_close": 23400, "atm": 23500, "strikes": [{"strike": 23450, "ce_oi": 10, "pe_oi": 20}]})
    assert {row["levelType"] for row in levels} >= {"PREVIOUS_CLOSE", "ATM", "CALL_OI"}


def test_global_config_preserves_per_instrument_provider():
    class Collection:
        async def find_one(self, *_args, **_kwargs):
            return {"instruments": {"sp500": {"enabled": True, "provider": "fmp", "providerSymbol": "^GSPC"}}}
    class DB:
        settings = Collection()
        def __getitem__(self, name):
            return self.settings
    row = next(item for item in asyncio.run(configured_instruments(DB())) if item["id"] == "sp500")
    assert row["provider"] == "fmp"
    assert row["providerSymbol"] == "^GSPC"


def test_fmp_provider_switch_replaces_stale_twelve_data_symbol():
    class Collection:
        async def find_one(self, *_args, **_kwargs):
            return {"instruments": {
                "xauusd": {"enabled": True, "provider": "fmp", "providerSymbol": "XAU/USD"},
                "sp500": {"enabled": True, "provider": "fmp", "providerSymbol": "^GSPC"},
            }}
    class DB:
        settings = Collection()
        def __getitem__(self, name):
            return self.settings
    rows = asyncio.run(configured_instruments(DB()))
    assert next(item for item in rows if item["id"] == "xauusd")["providerSymbol"] == "GCUSD"
    assert next(item for item in rows if item["id"] == "sp500")["providerSymbol"] == "^GSPC"


def test_provider_usage_is_empty_when_no_enabled_provider_is_selected():
    class Collection:
        async def find_one(self, *_args, **_kwargs):
            return {"instruments": {
                "sp500": {"enabled": False, "provider": "fmp"},
                "eurusd": {"enabled": False, "provider": "twelve_data"},
            }}
    class DB:
        settings = Collection()
        def __getitem__(self, name):
            return self.settings
    providers = asyncio.run(enabled_provider_items(DB()))
    assert providers["fmp"] == []
    assert providers["twelve_data"] == []


def test_fmp_quote_normalizes_to_global_quote_shape():
    quote = normalize_fmp_quote({"symbol": "AAPL", "price": 200, "previousClose": 198, "change": 2, "changesPercentage": 1.01, "volume": 10, "timestamp": 1758000000})
    assert quote["provider"] == "fmp"
    assert quote["last_price"] == 200
    assert quote["change_percent"] == 1.01


def test_global_public_prefs_never_leaks_fmp_key():
    pub = public_prefs({"fmp_api_key_enc": "encrypted-secret"})
    assert "fmp_api_key_enc" not in pub
    assert "encrypted-secret" not in str(pub)


def test_fmp_connection_does_not_return_key_when_not_configured():
    result = asyncio.run(check_fmp_connection(""))
    assert result == {"ok": False, "error": "Not configured"}


def test_fmp_connection_returns_small_safe_success(monkeypatch):
    async def fake_fetch(_key, _specs):
        return {"AAPL": {"last_price": 200}}, None

    monkeypatch.setattr("global_markets.fetch_fmp_quotes", fake_fetch)
    result = asyncio.run(check_fmp_connection("secret-key"))
    assert result["ok"] is True
    assert "secret-key" not in str(result)
    assert set(result) == {"ok", "message"}


def test_fmp_quotes_are_requested_in_one_batch(monkeypatch):
    calls = []

    class Response:
        status_code = 200

        def json(self):
            return [
                {"symbol": "^GSPC", "price": 5000},
                {"symbol": "EURUSD", "price": 1.1},
            ]

    async def fake_get(url, params):
        calls.append((url, params))
        return Response()

    monkeypatch.setattr("global_markets.adr._http_get", fake_get)
    quotes, error = asyncio.run(fetch_fmp_quotes("secret-key", [
        ("sp500", "^GSPC", "INDEX"),
        ("eurusd", "EURUSD", "FOREX"),
    ]))

    assert error is None
    assert quotes["SP500"]["last_price"] == 5000
    assert quotes["EURUSD"]["last_price"] == 1.1
    assert len(calls) == 1
    assert calls[0][1]["symbol"] == "^GSPC,EURUSD"
