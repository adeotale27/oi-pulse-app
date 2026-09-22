"""Global Markets registry and normalized Twelve Data cache.

The ADR module owns the Twelve Data credentials, rate limiter and HTTP client.
This module deliberately only supplies instrument mappings and normalizes its
cached quotes for the desk surface.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import adr

# Provider metadata for the automatic API Configuration inventory. Requests
# still use the centralized ADR client/rate limiter below.
PROVIDER_QUOTE_URL = "https://api.twelvedata.com/quote"
LATEST_COL = "global_market_latest"
STATE_COL = "global_market_state"
CFG_COL = "settings"
CFG_ID = "global_markets_prefs"

# Add a market by adding one row here.  displaySymbol is never sent upstream.
INSTRUMENTS: List[Dict[str, Any]] = [
    {"id": "nasdaq", "displaySymbol": "NASDAQ", "displayName": "Nasdaq Composite", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "IXIC", "exchange": "NASDAQ", "timezone": "America/New_York", "assetType": "index", "session": "equity_us", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "sp500", "displaySymbol": "S&P 500", "displayName": "S&P 500", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "SPX", "exchange": "INDEX", "timezone": "America/New_York", "assetType": "index", "session": "equity_us", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "dow", "displaySymbol": "DOW JONES", "displayName": "Dow Jones Industrial Average", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "DJI", "exchange": "INDEX", "timezone": "America/New_York", "assetType": "index", "session": "equity_us", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "dax", "displaySymbol": "DAX", "displayName": "DAX 40", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "GDAXI", "exchange": "INDEX", "timezone": "Europe/Berlin", "assetType": "index", "session": "equity_eu", "enabled": True, "precision": 2, "currency": "EUR"},
    {"id": "ftse", "displaySymbol": "FTSE 100", "displayName": "FTSE 100", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "FTSE", "exchange": "INDEX", "timezone": "Europe/London", "assetType": "index", "session": "equity_eu", "enabled": True, "precision": 2, "currency": "GBP"},
    {"id": "nikkei", "displaySymbol": "NIKKEI 225", "displayName": "Nikkei 225", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "N225", "exchange": "INDEX", "timezone": "Asia/Tokyo", "assetType": "index", "session": "equity_asia", "enabled": True, "precision": 2, "currency": "JPY"},
    {"id": "hang_seng", "displaySymbol": "HANG SENG", "displayName": "Hang Seng Index", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "HSI", "exchange": "INDEX", "timezone": "Asia/Hong_Kong", "assetType": "index", "session": "equity_asia", "enabled": True, "precision": 2, "currency": "HKD"},
    {"id": "shanghai", "displaySymbol": "SHANGHAI COMPOSITE", "displayName": "Shanghai Composite", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "SSE", "exchange": "INDEX", "timezone": "Asia/Shanghai", "assetType": "index", "session": "equity_asia", "enabled": True, "precision": 2, "currency": "CNY"},
    {"id": "gift_nifty", "displaySymbol": "GIFT NIFTY", "displayName": "GIFT Nifty", "category": "GLOBAL INDICES", "provider": "twelve_data", "providerSymbol": "NIFTY", "exchange": "NSE", "timezone": "Asia/Kolkata", "assetType": "index", "session": "equity_india", "enabled": False, "precision": 2, "currency": "INR"},
    {"id": "eurusd", "displaySymbol": "EURUSD", "displayName": "Euro / US Dollar", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "EUR/USD", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 5, "currency": "USD"},
    {"id": "gbpjpy", "displaySymbol": "GBPJPY", "displayName": "British Pound / Japanese Yen", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "GBP/JPY", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 3, "currency": "JPY"},
    {"id": "gbpusd", "displaySymbol": "GBPUSD", "displayName": "British Pound / US Dollar", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "GBP/USD", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 5, "currency": "USD"},
    {"id": "usdjpy", "displaySymbol": "USDJPY", "displayName": "US Dollar / Japanese Yen", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "USD/JPY", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 3, "currency": "JPY"},
    {"id": "nzdusd", "displaySymbol": "NZDUSD", "displayName": "New Zealand Dollar / US Dollar", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "NZD/USD", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 5, "currency": "USD"},
    {"id": "usdinr", "displaySymbol": "USDINR", "displayName": "US Dollar / Indian Rupee", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "USD/INR", "exchange": "FOREX", "timezone": "Etc/UTC", "assetType": "forex", "session": "forex", "enabled": True, "precision": 4, "currency": "INR"},
    {"id": "dxy", "displaySymbol": "DXY", "displayName": "US Dollar Index", "category": "FX / FOREX", "provider": "twelve_data", "providerSymbol": "DXY", "exchange": "INDEX", "timezone": "America/New_York", "assetType": "index", "session": "forex", "enabled": True, "precision": 3, "currency": "USD"},
    {"id": "xauusd", "displaySymbol": "XAUUSD", "displayName": "Gold Spot", "category": "COMMODITIES", "provider": "twelve_data", "providerSymbol": "XAU/USD", "exchange": "FOREX", "timezone": "America/New_York", "assetType": "commodity", "session": "forex", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "silver", "displaySymbol": "SILVER", "displayName": "Silver Spot", "category": "COMMODITIES", "provider": "twelve_data", "providerSymbol": "XAG/USD", "exchange": "FOREX", "timezone": "America/New_York", "assetType": "commodity", "session": "forex", "enabled": True, "precision": 3, "currency": "USD"},
    {"id": "usoil", "displaySymbol": "USOIL", "displayName": "WTI Crude Oil", "category": "COMMODITIES", "provider": "twelve_data", "providerSymbol": "WTI/USD", "exchange": "FOREX", "timezone": "America/New_York", "assetType": "commodity", "session": "forex", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "brent", "displaySymbol": "BRENT", "displayName": "Brent Crude Oil", "category": "COMMODITIES", "provider": "twelve_data", "providerSymbol": "BRENT/USD", "exchange": "FOREX", "timezone": "America/New_York", "assetType": "commodity", "session": "forex", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "btcusd", "displaySymbol": "BTCUSD", "displayName": "Bitcoin / US Dollar", "category": "CRYPTO", "provider": "twelve_data", "providerSymbol": "BTC/USD", "exchange": "CRYPTO", "timezone": "Etc/UTC", "assetType": "crypto", "session": "24/7", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "ethusd", "displaySymbol": "ETHUSD", "displayName": "Ethereum / US Dollar", "category": "CRYPTO", "provider": "twelve_data", "providerSymbol": "ETH/USD", "exchange": "CRYPTO", "timezone": "Etc/UTC", "assetType": "crypto", "session": "24/7", "enabled": True, "precision": 2, "currency": "USD"},
    {"id": "solusd", "displaySymbol": "SOLUSD", "displayName": "Solana / US Dollar", "category": "CRYPTO", "provider": "twelve_data", "providerSymbol": "SOL/USD", "exchange": "CRYPTO", "timezone": "Etc/UTC", "assetType": "crypto", "session": "24/7", "enabled": True, "precision": 3, "currency": "USD"},
    {"id": "xrpusd", "displaySymbol": "XRPUSD", "displayName": "XRP / US Dollar", "category": "CRYPTO", "provider": "twelve_data", "providerSymbol": "XRP/USD", "exchange": "CRYPTO", "timezone": "Etc/UTC", "assetType": "crypto", "session": "24/7", "enabled": True, "precision": 4, "currency": "USD"},
    {"id": "total2", "displaySymbol": "TOTAL2", "displayName": "Crypto Market Cap ex Bitcoin", "category": "CRYPTO", "provider": "twelve_data", "providerSymbol": "TOTAL2", "exchange": "CRYPTO", "timezone": "Etc/UTC", "assetType": "index", "session": "24/7", "enabled": False, "precision": 0, "currency": "USD"},
    {"id": "us10y", "displaySymbol": "US 10Y", "displayName": "US 10-Year Treasury Yield", "category": "MACRO", "provider": "twelve_data", "providerSymbol": "US10Y", "exchange": "INDEX", "timezone": "America/New_York", "assetType": "yield", "session": "equity_us", "enabled": False, "precision": 3, "currency": "USD"},
]

CATEGORY_ORDER = ("GLOBAL INDICES", "FX / FOREX", "COMMODITIES", "CRYPTO", "ADR MONITOR", "MACRO")


def instruments() -> List[Dict[str, Any]]:
    return [dict(item) for item in INSTRUMENTS]


async def configured_instruments(db) -> List[Dict[str, Any]]:
    """Admin enables each instrument explicitly; unsupported symbols stay hidden."""
    doc = await db[CFG_COL].find_one({"_id": CFG_ID}) if db is not None else None
    overrides = (doc or {}).get("instruments") if isinstance((doc or {}).get("instruments"), dict) else {}
    rows = []
    for base in INSTRUMENTS:
        override = overrides.get(base["id"], {}) if isinstance(overrides.get(base["id"], {}), dict) else {}
        rows.append({**base, "enabled": bool(override.get("enabled", False)), "providerSymbol": str(override.get("providerSymbol") or base["providerSymbol"]).strip()})
    return rows


async def save_instrument_config(db, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    allowed = {item["id"]: item for item in INSTRUMENTS}
    current_doc = await db[CFG_COL].find_one({"_id": CFG_ID}) if db is not None else None
    patch = dict((current_doc or {}).get("instruments") or {})
    for row in rows:
        item = allowed.get(str(row.get("id") or ""))
        if not item:
            continue
        symbol = str(row.get("providerSymbol") or item["providerSymbol"]).strip()
        # Never let a blank provider token become an upstream BadSymbol call.
        patch[item["id"]] = {"enabled": bool(row.get("enabled")) and bool(symbol), "providerSymbol": symbol or item["providerSymbol"]}
    if db is not None:
        await db[CFG_COL].update_one({"_id": CFG_ID}, {"$set": {"instruments": patch}}, upsert=True)
    return await configured_instruments(db)


def _status(item: Dict[str, Any], quote: Optional[Dict[str, Any]]) -> tuple[str, bool]:
    if item["session"] == "24/7":
        return "24/7", True
    explicit = (quote or {}).get("is_market_open")
    if explicit is True:
        return "LIVE", True
    if explicit is False:
        return "CLOSED", False
    return "UNKNOWN", False


def normalize(item: Dict[str, Any], quote: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    quote = quote or {}
    status, is_open = _status(item, quote)
    available = quote.get("last_price") is not None
    return {
        "id": item["id"], "symbol": item["displaySymbol"], "displayName": item["displayName"],
        "category": item["category"], "assetType": item["assetType"], "price": quote.get("last_price"),
        "previousClose": quote.get("previous_close"), "change": quote.get("change"),
        "changePercent": quote.get("change_percent"), "open": quote.get("open"), "high": quote.get("high"),
        "low": quote.get("low"), "volume": quote.get("volume"), "currency": quote.get("currency") or item["currency"],
        "timestamp": quote.get("last_quote_at") or quote.get("fetched_at"), "exchange": quote.get("exchange") or item["exchange"],
        "timezone": item["timezone"], "marketStatus": status, "isMarketOpen": is_open,
        "source": item["provider"], "stale": bool(quote.get("poll_status") in ("failed", "stale")),
        "available": available, "providerSymbol": item["providerSymbol"], "precision": item["precision"],
        "macro": item["displaySymbol"] in {"USDINR", "DXY", "XAUUSD", "BRENT", "USOIL", "US 10Y"},
    }


async def ensure_indexes(db) -> None:
    if db is not None:
        await db[LATEST_COL].create_index("id", unique=True)


async def overview(db) -> Dict[str, Any]:
    latest = {}
    if db is not None:
        async for row in db[LATEST_COL].find({}, {"_id": 0}):
            latest[row.get("id")] = row
    rows = [normalize(item, latest.get(item["id"])) for item in await configured_instruments(db) if item["enabled"]]
    return {"categories": CATEGORY_ORDER, "items": rows, "updatedAt": datetime.now(timezone.utc).isoformat()}


async def poll_next(db) -> None:
    """Refresh exactly one configured symbol; the shared ADR limiter budgets credits."""
    key = adr._api_key_from_doc(await adr.load_prefs(db))
    if not key:
        return
    state = await db[STATE_COL].find_one({"_id": "cursor"}) if db is not None else None
    enabled = [item for item in await configured_instruments(db) if item["enabled"]]
    if not enabled:
        return
    cursor = int((state or {}).get("position") or 0) % len(enabled)
    item = enabled[cursor]
    quotes, error = await adr.fetch_quotes(key, [(item["id"], item["providerSymbol"], item["exchange"])], source="global_market")
    quote = quotes.get(item["id"].upper())
    if db is not None:
        if quote:
            await db[LATEST_COL].update_one({"id": item["id"]}, {"$set": {"id": item["id"], **quote, "poll_status": "ok"}}, upsert=True)
        elif error:
            await db[LATEST_COL].update_one({"id": item["id"]}, {"$set": {"id": item["id"], "poll_status": "failed"}}, upsert=True)
        await db[STATE_COL].update_one({"_id": "cursor"}, {"$set": {"position": cursor + 1}}, upsert=True)
