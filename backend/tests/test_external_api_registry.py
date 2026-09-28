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
    assert registry["summary"]["providers"] > 0
    assert registry["summary"]["active"] == 0


def test_registry_active_count_includes_only_providers_with_requests_today(monkeypatch):
    import external_api_registry

    async def configured_rows(_db):
        return []

    async def telemetry(_db, rows):
        result = {}
        target = next(row for row in rows if row["provider_id"] == "twelve-data")
        result[(target["provider_id"], target["endpoint"], target["method"])] = {
            "requests_today": 2,
            "errors_today": 0,
            "avg_latency_ms": 12,
            "status": "healthy",
            "last_request": None,
            "last_success": None,
            "last_error": None,
            "recent_requests": [],
        }
        return result

    monkeypatch.setattr(external_api_registry, "_configured_market_intel_rows", configured_rows)
    monkeypatch.setattr(external_api_registry, "_telemetry", telemetry)
    registry = asyncio.run(external_api_registry.build_registry(object()))
    assert registry["summary"]["active"] == 1


def test_global_markets_is_discovered_by_the_api_configuration_inventory():
    rows = list(_source_rows())
    assert any(row["module"] == "Global Markets" and row["provider_id"] == "twelve-data" for row in rows)
