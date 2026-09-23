"""Global Markets registry and normalized provider quote cache.

The ADR module owns the Twelve Data credentials, rate limiter and HTTP client.
This module deliberately only supplies instrument mappings and normalizes its
cached quotes for the desk surface.
"""
from __future__ import annotations

from datetime import datetime, time, timezone
import os
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import adr

# Provider metadata for the automatic API Configuration inventory. Requests
# still use the centralized ADR client/rate limiter below.
PROVIDER_QUOTE_URL = "https://api.twelvedata.com/quote"
# FMP's current API uses the stable namespace. The legacy v3 endpoint can
# return 401 even for valid keys on newer plans.
FMP_QUOTE_URL = "https://financialmodelingprep.com/stable/quote"
# The free FMP tier is commonly capped at 250 requests/day. A single batched
# quote request every six minutes stays below that cap while still refreshing
# the configured pairs throughout the session.
FMP_POLL_INTERVAL_S = 360
SUPPORTED_PROVIDERS = frozenset({"twelve_data", "fmp"})
FMP_DEFAULT_SYMBOLS = {
    "nasdaq": "^IXIC", "sp500": "^GSPC", "dow": "^DJI", "dax": "^GDAXI",
    "ftse": "^FTSE", "nikkei": "^N225", "hang_seng": "^HSI", "shanghai": "^SSEC",
    "dxy": "DX-Y.NYB", "xauusd": "GCUSD", "silver": "SIUSD",
    "usoil": "CLUSD", "brent": "BZUSD", "btcusd": "BTCUSD", "ethusd": "ETHUSD",
    "solusd": "SOLUSD", "xrpusd": "XRPUSD", "total2": "TOTAL2",
}
LATEST_COL = "global_market_latest"
STATE_COL = "global_market_state"
CFG_COL = "settings"
CFG_ID = "global_markets_prefs"
UTC = timezone.utc
ET = ZoneInfo("America/New_York")
BERLIN = ZoneInfo("Europe/Berlin")
LONDON = ZoneInfo("Europe/London")
TOKYO = ZoneInfo("Asia/Tokyo")
HONG_KONG = ZoneInfo("Asia/Hong_Kong")
SHANGHAI = ZoneInfo("Asia/Shanghai")

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
    {"id": "gift_nifty", "displaySymbol": "GIFT NIFTY", "displayName": "GIFT Nifty", "category": "GLOBAL INDICES", "provider": "builtin", "providerSymbol": "NSEIX:GIFT NIFTY", "exchange": "NSEIX", "timezone": "Asia/Kolkata", "assetType": "index", "session": "equity_india", "enabled": False, "precision": 2, "currency": "INR", "builtin": True},
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
    removed = set((doc or {}).get("removed") or [])
    custom = (doc or {}).get("custom_instruments") if isinstance((doc or {}).get("custom_instruments"), dict) else {}
    rows = []
    for base in INSTRUMENTS:
        if base["id"] in removed:
            continue
        override = overrides.get(base["id"], {}) if isinstance(overrides.get(base["id"], {}), dict) else {}
        provider = str(override.get("provider") or base["provider"]).strip().lower()
        if provider not in SUPPORTED_PROVIDERS:
            provider = base["provider"]
        configured_symbol = str(override.get("providerSymbol") or "").strip()
        default_symbol = FMP_DEFAULT_SYMBOLS.get(base["id"], base["providerSymbol"]) if provider == "fmp" else base["providerSymbol"]
        if provider == "fmp" and (not configured_symbol or configured_symbol.upper() == str(base["providerSymbol"]).upper()):
            configured_symbol = default_symbol
        if base["id"] == "gift_nifty":
            rows.append({**base, "enabled": bool(override.get("enabled", False)), "provider": "builtin", "providerSymbol": "NSEIX:GIFT NIFTY", "builtin": True})
        else:
            rows.append({**base, "enabled": bool(override.get("enabled", False)), "provider": provider, "providerSymbol": configured_symbol or default_symbol})
    for item_id, custom_row in custom.items():
        if item_id in removed or not isinstance(custom_row, dict):
            continue
        provider = str(custom_row.get("provider") or "twelve_data").strip().lower()
        if provider not in SUPPORTED_PROVIDERS:
            provider = "twelve_data"
        symbol = str(custom_row.get("providerSymbol") or "").strip()
        if not item_id or not custom_row.get("displaySymbol") or not symbol:
            continue
        rows.append({
            "id": item_id, "displaySymbol": str(custom_row["displaySymbol"]), "displayName": str(custom_row.get("displayName") or custom_row["displaySymbol"]),
            "category": str(custom_row.get("category") or "GLOBAL INDICES"), "provider": provider, "providerSymbol": symbol,
            "exchange": str(custom_row.get("exchange") or "INDEX"), "timezone": str(custom_row.get("timezone") or "Etc/UTC"),
            "assetType": str(custom_row.get("assetType") or "index"), "session": str(custom_row.get("session") or "24/7"),
            "enabled": bool(custom_row.get("enabled")), "precision": int(custom_row.get("precision") or 2), "currency": str(custom_row.get("currency") or "USD"),
        })
    return rows


async def enabled_provider_items(db) -> Dict[str, List[Dict[str, Any]]]:
    """Return only enabled instruments grouped by their selected provider."""
    grouped: Dict[str, List[Dict[str, Any]]] = {"fmp": [], "twelve_data": [], "builtin": []}
    for item in await configured_instruments(db):
        if item.get("enabled") and item.get("provider") in grouped:
            grouped[item["provider"]].append(item)
    return grouped


async def save_instrument_config(db, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    allowed = {item["id"]: item for item in INSTRUMENTS}
    current_doc = await db[CFG_COL].find_one({"_id": CFG_ID}) if db is not None else None
    patch = dict((current_doc or {}).get("instruments") or {})
    removed = set((current_doc or {}).get("removed") or [])
    custom = dict((current_doc or {}).get("custom_instruments") or {})
    for row in rows:
        item_id = str(row.get("id") or "")
        if row.get("remove"):
            removed.add(item_id)
            patch.pop(item_id, None)
            custom.pop(item_id, None)
            continue
        item = allowed.get(item_id)
        if not item and not item_id.startswith("custom_"):
            continue
        if item_id == "gift_nifty":
            patch[item_id] = {"enabled": bool(row.get("enabled")), "provider": "builtin", "providerSymbol": "NSEIX:GIFT NIFTY"}
            removed.discard(item_id)
            continue
        fallback = item["providerSymbol"] if item else ""
        symbol = str(row.get("providerSymbol") or fallback).strip()
        provider = str(row.get("provider") or (item["provider"] if item else "twelve_data")).strip().lower()
        if provider not in SUPPORTED_PROVIDERS:
            provider = item["provider"] if item else "twelve_data"
        # Never let a blank provider token become an upstream BadSymbol call.
        if item:
            default_symbol = FMP_DEFAULT_SYMBOLS.get(item_id, item["providerSymbol"]) if provider == "fmp" else item["providerSymbol"]
            if provider == "fmp" and symbol == item["providerSymbol"] and item_id in FMP_DEFAULT_SYMBOLS:
                symbol = default_symbol
            patch[item_id] = {"enabled": bool(row.get("enabled")) and bool(symbol), "provider": provider, "providerSymbol": symbol or default_symbol}
        else:
            custom[item_id] = {key: row.get(key) for key in ("displaySymbol", "displayName", "category", "provider", "providerSymbol", "enabled", "exchange", "timezone", "assetType", "session", "precision", "currency")}
        removed.discard(item_id)
    if db is not None:
        await db[CFG_COL].update_one({"_id": CFG_ID}, {"$set": {"instruments": patch, "removed": sorted(removed), "custom_instruments": custom}}, upsert=True)
    return await configured_instruments(db)


def _status(item: Dict[str, Any], quote: Optional[Dict[str, Any]]) -> tuple[str, bool]:
    if item["session"] == "24/7":
        return "24/7", True
    if not instrument_session_open(item):
        return "CLOSED", False
    explicit = (quote or {}).get("is_market_open")
    if explicit is True:
        return "LIVE", True
    if explicit is False:
        return "CLOSED", False
    return "UNKNOWN", False


def _weekday_window(dt: datetime, zone: ZoneInfo, start: time, end: time) -> bool:
    local = (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(zone)
    return local.weekday() < 5 and start <= local.time() < end


def instrument_session_open(item: Dict[str, Any], dt: Optional[datetime] = None) -> bool:
    """Return whether this instrument's venue is open before spending a quote credit."""
    now = dt or datetime.now(UTC)
    session = item.get("session")
    if session == "24/7":
        return True
    if session == "equity_us":
        try:
            import adr
            return adr.is_us_equity_session(now)
        except Exception:
            return _weekday_window(now, ET, time(9, 30), time(16, 0))
    if session == "equity_eu":
        zone = LONDON if item.get("id") == "ftse" else BERLIN
        return _weekday_window(now, zone, time(8, 0) if zone is LONDON else time(9, 0), time(16, 30) if zone is LONDON else time(17, 30))
    if session == "equity_asia":
        zone = TOKYO if item.get("id") == "nikkei" else HONG_KONG if item.get("id") == "hang_seng" else SHANGHAI
        local = (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(zone)
        if local.weekday() >= 5:
            return False
        t = local.time()
        if item.get("id") == "nikkei":
            return time(9, 0) <= t < time(15, 30) and not time(11, 30) <= t < time(12, 30)
        if item.get("id") == "shanghai":
            return time(9, 30) <= t < time(15, 0) and not time(11, 30) <= t < time(13, 0)
        return time(9, 30) <= t < time(16, 0)
    if session == "forex":
        local = (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(ET)
        if local.weekday() == 5:
            return False
        if local.weekday() == 6:
            return local.time() >= time(17, 0)
        if local.weekday() == 4 and local.time() >= time(17, 0):
            return False
        return True
    return False


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
        "session": item.get("session"),
        "sessionOpen": is_open,
    }


async def ensure_indexes(db) -> None:
    if db is not None:
        await db[LATEST_COL].create_index("id", unique=True)


async def overview(db) -> Dict[str, Any]:
    prefs = await load_prefs(db)
    if prefs.get("enabled") is False:
        return {"categories": CATEGORY_ORDER, "items": [], "enabled": False, "updatedAt": datetime.now(timezone.utc).isoformat()}
    latest = {}
    if db is not None:
        async for row in db[LATEST_COL].find({}, {"_id": 0}):
            latest[row.get("id")] = row
    rows = []
    for item in await configured_instruments(db):
        if not item["enabled"]:
            continue
        if item["id"] == "gift_nifty":
            gift = None
            try:
                import server
                gift = (server.extra_tickers.snapshot() or {}).get("gift_nifty")
            except Exception:
                gift = None
            gift = gift or {}
            quote = {
                "last_price": gift.get("last"),
                "previous_close": gift.get("prev_close"),
                "change": gift.get("change"),
                "change_percent": gift.get("change_pct"),
                "last_quote_at": gift.get("ts"),
                "fetched_at": gift.get("ts"),
                "poll_status": "ok" if gift.get("last") is not None else "stale",
                "exchange": "NSEIX",
                "currency": "INR",
                "is_market_open": None,
            }
            row = normalize(item, quote)
            row["source"] = "builtin"
            row["providerSymbol"] = "NSEIX:GIFT NIFTY"
            row["stale"] = gift.get("last") is None
            rows.append(row)
        else:
            rows.append(normalize(item, latest.get(item["id"])))
    return {"categories": CATEGORY_ORDER, "items": rows, "enabled": True, "updatedAt": datetime.now(timezone.utc).isoformat()}


async def poll_next(db) -> None:
    """Refresh configured symbols while keeping provider calls bounded."""
    if (await load_prefs(db)).get("enabled") is False:
        return
    state = await db[STATE_COL].find_one({"_id": "cursor"}) if db is not None else None
    providers = await enabled_provider_items(db)
    enabled = providers["fmp"] + providers["twelve_data"] + providers["builtin"]
    open_items = [item for item in enabled if instrument_session_open(item)]
    if not open_items:
        return
    cursor = int((state or {}).get("position") or 0) % len(enabled)
    item = next((candidate for candidate in open_items if enabled.index(candidate) >= cursor), open_items[0])
    # FMP accepts a comma-separated symbol list, so refresh all selected FMP
    # pairs in one request instead of spending one call per pair.
    fmp_items = [row for row in providers["fmp"] if instrument_session_open(row)]
    last_fmp = (state or {}).get("fmp_last_polled_at")
    fmp_due = True
    if last_fmp:
        try:
            fmp_due = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last_fmp))).total_seconds() >= FMP_POLL_INTERVAL_S
        except (TypeError, ValueError):
            fmp_due = True
    if fmp_items and fmp_due:
        if (await load_prefs(db)).get("enabled") is False:
            return
        key = _fmp_api_key_from_doc(await load_prefs(db))
        quotes, error = await fetch_fmp_quotes(
            key,
            [(row["id"], row["providerSymbol"], row["exchange"]) for row in fmp_items],
        )
        if db is not None:
            for row in fmp_items:
                quote = quotes.get(row["id"].upper())
                if quote:
                    await db[LATEST_COL].update_one(
                        {"id": row["id"]},
                        {"$set": {"id": row["id"], **quote, "poll_status": "ok"}},
                        upsert=True,
                    )
                elif error:
                    await db[LATEST_COL].update_one(
                        {"id": row["id"]},
                        {"$set": {"id": row["id"], "poll_status": "failed", "poll_error": error}},
                        upsert=True,
                    )
            await db[STATE_COL].update_one(
                {"_id": "cursor"},
                {"$set": {"fmp_last_polled_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
    if item["provider"] == "twelve_data" and providers["twelve_data"]:
        if (await load_prefs(db)).get("enabled") is False:
            return
        key = adr._api_key_from_doc(await adr.load_prefs(db))
        quotes, error = await adr.fetch_quotes(key, [(item["id"], item["providerSymbol"], item["exchange"])], source="global_market")
        quote = quotes.get(item["id"].upper())
        if db is not None:
            if quote:
                await db[LATEST_COL].update_one({"id": item["id"]}, {"$set": {"id": item["id"], **quote, "poll_status": "ok"}}, upsert=True)
            elif error:
                await db[LATEST_COL].update_one({"id": item["id"]}, {"$set": {"id": item["id"], "poll_status": "failed", "poll_error": error}}, upsert=True)
    if db is not None:
        await db[STATE_COL].update_one({"_id": "cursor"}, {"$set": {"position": (enabled.index(item) + 1) % len(enabled)}}, upsert=True)


async def load_prefs(db) -> Dict[str, Any]:
    doc = await db[CFG_COL].find_one({"_id": CFG_ID}) if db is not None else None
    return {"_id": CFG_ID, "enabled": True, **(doc or {})}


def public_prefs(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Return global settings without returning either provider's secret."""
    out = {k: v for k, v in (doc or {}).items() if k not in {"_id", "fmp_api_key", "fmp_api_key_enc"}}
    out["fmp_api_key_configured"] = bool((doc or {}).get("fmp_api_key_enc")) or bool(
        os.environ.get("FMP_API_KEY", "").strip()
    )
    out["enabled"] = (doc or {}).get("enabled", True) is not False
    return out


def _fmp_api_key_from_doc(doc: Optional[Dict[str, Any]]) -> str:
    if doc and doc.get("fmp_api_key_enc"):
        try:
            from desk_llm import decrypt_secret
            return decrypt_secret(doc["fmp_api_key_enc"])
        except Exception:
            return ""
    return os.environ.get("FMP_API_KEY", "").strip()


async def save_prefs(db, patch: Dict[str, Any]) -> Dict[str, Any]:
    cur = await load_prefs(db)
    token = patch.pop("fmp_api_key", None)
    if token:
        from desk_llm import encrypt_secret
        cur["fmp_api_key_enc"] = encrypt_secret(str(token).strip())
    if patch.pop("clear_fmp_key", False):
        cur.pop("fmp_api_key_enc", None)
    cur["_id"] = CFG_ID
    if db is not None:
        await db[CFG_COL].update_one({"_id": CFG_ID}, {"$set": cur}, upsert=True)
    return public_prefs(cur)


def normalize_fmp_quote(raw: Dict[str, Any], *, symbol: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict) or raw.get("price") is None:
        return None
    def num(value):
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
    return {
        "provider": "fmp",
        "symbol": str(raw.get("symbol") or symbol or "").upper(),
        "name": raw.get("name"),
        "exchange": raw.get("exchange"),
        "currency": raw.get("currency") or "USD",
        "last_price": num(raw.get("price")),
        "open": num(raw.get("open")),
        "high": num(raw.get("dayHigh")),
        "low": num(raw.get("dayLow")),
        "previous_close": num(raw.get("previousClose")),
        "change": num(raw.get("change")),
        "change_percent": num(raw.get("changesPercentage")),
        "volume": int(num(raw.get("volume"))) if num(raw.get("volume")) is not None else None,
        "average_volume": int(num(raw.get("avgVolume"))) if num(raw.get("avgVolume")) is not None else None,
        "last_quote_at": datetime.fromtimestamp(float(raw["timestamp"]), timezone.utc).isoformat() if raw.get("timestamp") else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "is_market_open": None,
    }


async def fetch_fmp_quotes(api_key: str, specs: List[Any]) -> tuple[Dict[str, Dict[str, Any]], Optional[str]]:
    if not api_key:
        return {}, "not_configured"
    out: Dict[str, Dict[str, Any]] = {}
    normalized = []
    for spec in specs:
        desk = str(spec[0] if not isinstance(spec, str) else spec).strip().upper()
        symbol = str(spec[1] if not isinstance(spec, str) else spec).strip().upper()
        if desk and symbol:
            normalized.append((desk, symbol))
    if not normalized:
        return out, "no_symbols"
    try:
        response = await adr._http_get(
            FMP_QUOTE_URL,
            {"symbol": ",".join(symbol for _, symbol in normalized), "apikey": api_key},
        )
    except Exception:
        return out, "provider_unavailable"
    if response.status_code in (401, 403):
        return out, "unauthorized"
    if response.status_code == 429:
        return out, "rate_limited"
    if response.status_code >= 400:
        return out, f"provider_http_{response.status_code}"
    try:
        payload = response.json()
    except Exception:
        return out, "bad_payload"
    if isinstance(payload, dict) and (payload.get("Error Message") or payload.get("error")):
        return out, "provider_error"
    rows = payload if isinstance(payload, list) else [payload]
    by_symbol = {}
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        raw_symbol = str(raw.get("symbol") or "").strip().upper()
        quote = normalize_fmp_quote(raw, symbol=raw_symbol)
        if quote and raw_symbol:
            by_symbol[raw_symbol] = quote
    for desk, symbol in normalized:
        quote = by_symbol.get(symbol)
        if quote:
            out[desk] = quote
            out[symbol] = quote
    return out, None if len(out) else "no_quotes"


async def test_fmp_connection(db=None, api_key: Optional[str] = None) -> Dict[str, Any]:
    """Make one safe FMP request for the admin connection check."""
    if isinstance(db, str) and api_key is None:
        key = db
    else:
        key = api_key or _fmp_api_key_from_doc(await load_prefs(db))
    if not key:
        return {"ok": False, "error": "Not configured"}
    quotes, error = await fetch_fmp_quotes(key, [("AAPL", "AAPL", "NASDAQ")])
    if quotes.get("AAPL"):
        return {"ok": True, "message": "Financial Modeling Prep connection succeeded"}
    from error_log import record_error
    await record_error(
        source="global_markets",
        message=error or "Financial Modeling Prep connection failed",
        path="/global-markets/test-fmp",
        kind="ProviderError",
    )
    return {"ok": False, "error": error or "Connection failed"}
