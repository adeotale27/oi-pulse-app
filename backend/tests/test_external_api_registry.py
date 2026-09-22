import asyncio

from external_api_registry import _source_rows, build_registry, classify_external_url


def test_classifies_only_known_external_providers():
    assert classify_external_url("https://api.twelvedata.com/quote?symbol=INFY")["endpoint"] == "/quote"
    assert classify_external_url("https://api.kite.trade/quote")["provider"] == "Kite Connect"
    assert classify_external_url("https://striklenz.com/api/oi/NIFTY") is None


def test_registry_is_source_derived_and_contains_live_integrations():
    registry = asyncio.run(build_registry(None))
    providers = {row["name"]: row for row in registry["providers"]}
    assert "Kite Connect" in providers
    assert "Twelve Data" in providers
    assert any(endpoint["endpoint"] == "/quote" for endpoint in providers["Kite Connect"]["endpoints"])
    assert registry["summary"]["endpoints"] >= 1


def test_global_markets_is_discovered_by_the_api_configuration_inventory():
    rows = list(_source_rows())
    assert any(row["module"] == "Global Markets" and row["provider_id"] == "twelve-data" for row in rows)
