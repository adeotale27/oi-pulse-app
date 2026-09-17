"""Indian ADR monitor: Twelve Data → Mongo → desk API. Secrets never leave the vault."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from error_log import record_error, redact

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
ET = ZoneInfo("America/New_York")
BERLIN = ZoneInfo("Europe/Berlin")
UTC = timezone.utc

CFG_COL = "settings"
CFG_ID = "adr_prefs"
UNIVERSE_COL = "adr_universe"
OBS_COL = "adr_observations"
LATEST_COL = "adr_latest"
STATE_COL = "adr_poll_state"

PROVIDER = "twelve_data"
QUOTE_URL = "https://api.twelvedata.com/quote"
STOCKS_URL = "https://api.twelvedata.com/stocks"
TIME_SERIES_URL = "https://api.twelvedata.com/time_series"

DEFAULT_POLL_SECONDS = 300
# Twelve Data Basic 8: 8 API credits / minute, 800 / day. /quote is 1 credit per symbol.
# A comma-batch of 8 symbols still spends 8 credits in one second (dashboard "minutely max").
TD_CREDITS_PER_MINUTE = 8
TD_CREDIT_GAP_S = 60.0 / TD_CREDITS_PER_MINUTE
TD_RATE_LIMIT_BACKOFF_S = 90
DEFAULT_LARGE_MOVE = 5.0
DEFAULT_BANKING_MOVE = 5.0
US_OPEN = dtime(9, 30)
US_CLOSE = dtime(16, 0)
DE_OPEN = dtime(9, 0)
DE_CLOSE = dtime(17, 30)
IST_OPEN_REFRESH = dtime(9, 15)
US_EXCHANGES = frozenset({"NYSE", "NASDAQ", "NYSE ARCA", "NYSE MKT", "AMEX"})
DE_EXCHANGES = frozenset({"FRA", "XETRA", "FWB", "FSE", "XETR", "FRANKFURT"})
LISTING_FLAGS = {"US": "🇺🇸", "DE": "🇩🇪", "GB": "🇬🇧"}
RETENTION_HOURS = int(os.environ.get("ADR_RETENTION_HOURS") or os.environ.get("SNAPSHOT_RETENTION_HOURS") or 96)

# NYSE full-day closures (not early closes). DST is handled by America/New_York.
NYSE_HOLIDAYS = {
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
}

# True ADRs of Indian-listed (or India-headquartered) parents — not every US “India” listing.
SEED_ADRS: List[Dict[str, Any]] = [
    {"company_name": "Infosys", "indian_symbol": "INFY", "adr_symbol": "INFY", "exchange": "NYSE", "sector": "IT", "adr_ratio": "1:1"},
    {"company_name": "HDFC Bank", "indian_symbol": "HDFCBANK", "adr_symbol": "HDB", "exchange": "NYSE", "sector": "BANKING", "adr_ratio": "1:3"},
    {"company_name": "ICICI Bank", "indian_symbol": "ICICIBANK", "adr_symbol": "IBN", "exchange": "NYSE", "sector": "BANKING", "adr_ratio": "1:2"},
    {"company_name": "Wipro", "indian_symbol": "WIPRO", "adr_symbol": "WIT", "exchange": "NYSE", "sector": "IT", "adr_ratio": "1:1"},
    {"company_name": "Dr. Reddy's Laboratories", "indian_symbol": "DRREDDY", "adr_symbol": "RDY", "exchange": "NYSE", "sector": "PHARMA", "adr_ratio": "1:1"},
    {"company_name": "Sify Technologies", "indian_symbol": "SIFY", "adr_symbol": "SIFY", "exchange": "NASDAQ", "sector": "IT", "adr_ratio": "1:1"},
    {"company_name": "WNS", "indian_symbol": "WNS", "adr_symbol": "WNS", "exchange": "NYSE", "sector": "IT", "adr_ratio": "1:1"},
    {"company_name": "Tata Motors", "indian_symbol": "TATAMOTORS", "adr_symbol": "TTM", "exchange": "NYSE", "sector": "AUTO", "adr_ratio": "1:5"},
]

_INDIAN_NAME_RE = re.compile(
    r"\b(infosys|hdfc|icici|wipro|reddy|sify|tata motors|wipro|vedanta|axis bank|"
    r"state bank of india|reliance industries|bharti|hindustan unilever|itc limited|"
    r"larsen|mahindra|wipro|dr\.?\s*reddy)\b",
    re.I,
)

_stop = None
_task = None
_last_quote_credit_at = 0.0
_rate_limited_until = 0.0


def _now_utc() -> datetime:
    return datetime.now(UTC)


def now_et(dt: Optional[datetime] = None) -> datetime:
    src = dt or _now_utc()
    if src.tzinfo is None:
        src = src.replace(tzinfo=UTC)
    return src.astimezone(ET)


def now_ist(dt: Optional[datetime] = None) -> datetime:
    src = dt or _now_utc()
    if src.tzinfo is None:
        src = src.replace(tzinfo=UTC)
    return src.astimezone(IST)


def et_date_iso(dt: Optional[datetime] = None) -> str:
    return now_et(dt).date().isoformat()


def is_nyse_holiday(iso: str) -> bool:
    return str(iso)[:10] in NYSE_HOLIDAYS


def is_us_equity_session(dt: Optional[datetime] = None) -> bool:
    local = now_et(dt)
    if local.weekday() >= 5:
        return False
    if is_nyse_holiday(local.date().isoformat()):
        return False
    t = local.timetz().replace(tzinfo=None) if False else local.time()
    return US_OPEN <= t < US_CLOSE


def us_market_label(dt: Optional[datetime] = None, *, provider_open: Optional[bool] = None) -> str:
    if is_us_equity_session(dt):
        return "US Market Open"
    if provider_open is False or not is_us_equity_session(dt):
        return "US Market Closed"
    return "US Market Closed"


def _num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v) -> Optional[int]:
    n = _num(v)
    if n is None:
        return None
    return int(n)


def default_prefs() -> Dict[str, Any]:
    return {
        "_id": CFG_ID,
        "provider": PROVIDER,
        "enabled": True,
        "poll_interval_seconds": DEFAULT_POLL_SECONDS,
        "us_timezone": "America/New_York",
        "us_open": "09:30",
        "us_close": "16:00",
        "indian_open_refresh": True,
        "indian_open_refresh_ist": "09:15",
        "large_move_threshold_percent": DEFAULT_LARGE_MOVE,
        "banking_move_threshold_percent": DEFAULT_BANKING_MOVE,
        "notifications_enabled": True,
        "market_intelligence_enabled": True,
        "api_key_configured": False,
    }


def public_prefs(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    base = default_prefs()
    if doc:
        for k, v in doc.items():
            if k in ("api_key", "api_key_enc", "token"):
                continue
            if k == "_id":
                continue
            base[k] = v
    base["api_key_configured"] = bool((doc or {}).get("api_key_enc")) or bool(
        (os.environ.get("TWELVE_DATA_API_KEY") or "").strip()
    )
    base.pop("api_key", None)
    base.pop("api_key_enc", None)
    return base


def _api_key_from_doc(doc: Optional[Dict[str, Any]]) -> str:
    if doc:
        enc = doc.get("api_key_enc")
        if enc:
            try:
                from desk_llm import decrypt_secret
                return decrypt_secret(enc)
            except Exception:
                logger.warning("adr vault decrypt failed")
    return (os.environ.get("TWELVE_DATA_API_KEY") or "").strip()


def universe_doc(row: Dict[str, Any], *, existing_id: Optional[str] = None) -> Dict[str, Any]:
    adr = str(row.get("adr_symbol") or "").strip().upper()
    indian = str(row.get("indian_symbol") or "").strip().upper()
    uid = existing_id or str(row.get("id") or adr.lower())
    sector = str(row.get("sector") or "OTHER").strip().upper()
    return {
        "id": uid,
        "company_name": str(row.get("company_name") or adr).strip(),
        "indian_symbol": indian,
        "adr_symbol": adr,
        "exchange": str(row.get("exchange") or "NYSE").strip().upper(),
        "sector": sector,
        "adr_ratio": str(row.get("adr_ratio") or "1:1").strip(),
        "currency": str(row.get("currency") or "USD").strip().upper() or "USD",
        "provider": str(row.get("provider") or PROVIDER),
        "provider_symbol": str(row.get("provider_symbol") or adr).strip().upper(),
        "enabled": row.get("enabled") is not False,
        "market_intelligence_enabled": row.get("market_intelligence_enabled") is not False,
        "notification_enabled": row.get("notification_enabled") is not False,
        "large_move_threshold_percent": _num(row.get("large_move_threshold_percent")),
        "priority": int(row.get("priority") or 50),
    }


def listing_country_code(exchange: Optional[str]) -> str:
    e = str(exchange or "").strip().upper()
    if e in DE_EXCHANGES:
        return "DE"
    if e in {"LSE", "LON", "LONDON"}:
        return "GB"
    return "US"


def listing_flag(exchange: Optional[str]) -> str:
    return LISTING_FLAGS.get(listing_country_code(exchange), "🇺🇸")


def listing_market_name(exchange: Optional[str]) -> str:
    code = listing_country_code(exchange)
    if code == "DE":
        return "German Market"
    if code == "GB":
        return "UK Market"
    return "US Market"


def is_de_equity_session(dt: Optional[datetime] = None) -> bool:
    src = dt or _now_utc()
    if src.tzinfo is None:
        src = src.replace(tzinfo=UTC)
    local = src.astimezone(BERLIN)
    if local.weekday() >= 5:
        return False
    t = local.time()
    return DE_OPEN <= t < DE_CLOSE


def is_listing_session_open(exchange: Optional[str], dt: Optional[datetime] = None) -> bool:
    if listing_country_code(exchange) == "DE":
        return is_de_equity_session(dt)
    return is_us_equity_session(dt)


def is_indian_adr_listing(row: Dict[str, Any]) -> bool:
    """Indian-parent US ADRs, plus Indian names listed in Germany (e.g. Reliance on XETRA)."""
    if not isinstance(row, dict):
        return False
    symbol = str(row.get("symbol") or row.get("adr_symbol") or "").upper()
    seed = {r["adr_symbol"] for r in SEED_ADRS}
    if symbol in seed:
        return True
    exch = str(row.get("exchange") or "").upper()
    typ = str(row.get("type") or "").lower()
    country = str(row.get("country") or "").lower()
    name = str(row.get("name") or row.get("company_name") or "")
    indian_name = bool(_INDIAN_NAME_RE.search(name))
    adr_like = ("deposit" in typ) or ("adr" in typ) or typ in ("adr", "gdr")
    if exch in DE_EXCHANGES:
        return indian_name or country in ("india", "ind")
    if exch not in US_EXCHANGES:
        return False
    if country in ("india", "ind"):
        return adr_like or exch in ("NYSE", "NASDAQ")
    if adr_like and indian_name:
        return True
    return False


def normalize_quote(raw: Dict[str, Any], *, symbol: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    if raw.get("status") == "error" or raw.get("code"):
        return None
    close = _num(raw.get("close") if raw.get("close") is not None else raw.get("last"))
    prev = _num(raw.get("previous_close"))
    chg = _num(raw.get("change"))
    pct = _num(raw.get("percent_change"))
    w = raw.get("fifty_two_week") if isinstance(raw.get("fifty_two_week"), dict) else {}
    open_flag = raw.get("is_market_open")
    if isinstance(open_flag, str):
        open_flag = open_flag.lower() in ("true", "1", "yes")
    ts = raw.get("timestamp")
    fetched = _now_utc().isoformat()
    dt = raw.get("datetime") or raw.get("last_quote_at")
    return {
        "provider": PROVIDER,
        "symbol": str(raw.get("symbol") or symbol or "").upper(),
        "name": raw.get("name"),
        "exchange": raw.get("exchange"),
        "mic_code": raw.get("mic_code"),
        "currency": raw.get("currency") or "USD",
        "datetime": dt,
        "timestamp": int(ts) if ts not in (None, "") else None,
        "last_quote_at": dt,
        "last_price": close,
        "open": _num(raw.get("open")),
        "high": _num(raw.get("high")),
        "low": _num(raw.get("low")),
        "previous_close": prev,
        "change": chg,
        "change_percent": pct,
        "volume": _int(raw.get("volume")),
        "average_volume": _int(raw.get("average_volume") or raw.get("average_volume_2w")),
        "rolling_1d_change": _num(raw.get("rolling_1d_change")),
        "rolling_7d_change": _num(raw.get("rolling_7d_change")),
        "rolling_change": _num(raw.get("rolling_change")),
        "week52_low": _num(w.get("low")),
        "week52_high": _num(w.get("high")),
        "week52_low_change": _num(w.get("low_change")),
        "week52_high_change": _num(w.get("high_change")),
        "week52_low_change_percent": _num(w.get("low_change_percent")),
        "week52_high_change_percent": _num(w.get("high_change_percent")),
        "week52_range": w.get("range"),
        "is_market_open": bool(open_flag) if open_flag is not None else None,
        "fetched_at": fetched,
        "provider_extra": {k: raw[k] for k in ("average_volume", "fifty_two_week") if k in raw},
    }


def observation_from_quote(cfg: Dict[str, Any], quote: Dict[str, Any], *, poll_status: str = "ok") -> Dict[str, Any]:
    now = _now_utc().isoformat()
    return {
        "id": uuid.uuid4().hex,
        "adr_id": cfg["id"],
        "timestamp": now,
        "provider": PROVIDER,
        "symbol": cfg.get("adr_symbol"),
        "name": quote.get("name") or cfg.get("company_name"),
        "exchange": quote.get("exchange") or cfg.get("exchange"),
        "currency": quote.get("currency") or "USD",
        "last_price": quote.get("last_price"),
        "open": quote.get("open"),
        "high": quote.get("high"),
        "low": quote.get("low"),
        "previous_close": quote.get("previous_close"),
        "change": quote.get("change"),
        "change_percent": quote.get("change_percent"),
        "volume": quote.get("volume"),
        "average_volume": quote.get("average_volume"),
        "rolling_1d_change": quote.get("rolling_1d_change"),
        "rolling_7d_change": quote.get("rolling_7d_change"),
        "rolling_change": quote.get("rolling_change"),
        "week52_low": quote.get("week52_low"),
        "week52_high": quote.get("week52_high"),
        "week52_low_change": quote.get("week52_low_change"),
        "week52_high_change": quote.get("week52_high_change"),
        "week52_low_change_percent": quote.get("week52_low_change_percent"),
        "week52_high_change_percent": quote.get("week52_high_change_percent"),
        "week52_range": quote.get("week52_range"),
        "is_market_open": quote.get("is_market_open"),
        "poll_status": poll_status,
        "fetched_at": quote.get("fetched_at") or now,
        "last_quote_at": quote.get("last_quote_at"),
    }


def large_move(obs: Dict[str, Any], threshold: float) -> bool:
    pct = _num(obs.get("change_percent"))
    if pct is None:
        return False
    return abs(pct) >= float(threshold)


def meaningful_new_move(prev_pct: Optional[float], new_pct: Optional[float], threshold: float) -> bool:
    """New alert only when we first cross the threshold or move ≥2pp further."""
    if new_pct is None:
        return False
    if abs(new_pct) < float(threshold):
        return False
    if prev_pct is None or abs(prev_pct) < float(threshold):
        return True
    if (new_pct >= 0) != (prev_pct >= 0) and abs(new_pct) >= float(threshold):
        return True
    return abs(abs(new_pct) - abs(prev_pct)) >= 2.0


def is_banking_sector(sector: str) -> bool:
    return str(sector or "").strip().upper() in ("BANKING", "BANK", "BANKS", "FINANCIAL")


async def ensure_indexes(db) -> None:
    if db is None:
        return
    await db[UNIVERSE_COL].create_index("id", unique=True)
    await db[UNIVERSE_COL].create_index("adr_symbol", unique=True)
    await db[OBS_COL].create_index([("adr_id", 1), ("timestamp", -1)])
    await db[OBS_COL].create_index("timestamp")
    await db[LATEST_COL].create_index("adr_id", unique=True)


async def load_prefs(db) -> Dict[str, Any]:
    doc = None
    if db is not None:
        doc = await db[CFG_COL].find_one({"_id": CFG_ID})
    return doc or {"_id": CFG_ID}


async def save_prefs(db, patch: Dict[str, Any]) -> Dict[str, Any]:
    cur = await load_prefs(db)
    token = patch.pop("api_key", None)
    if token:
        from desk_llm import encrypt_secret
        cur["api_key_enc"] = encrypt_secret(str(token).strip())
    if patch.get("clear_key"):
        cur.pop("api_key_enc", None)
    for k, v in patch.items():
        if k in ("api_key", "api_key_enc", "clear_key"):
            continue
        cur[k] = v
    cur["_id"] = CFG_ID
    if db is not None:
        await db[CFG_COL].update_one({"_id": CFG_ID}, {"$set": cur}, upsert=True)
    return public_prefs(cur)


async def seed_universe(db) -> int:
    if db is None:
        return 0
    n = 0
    for i, row in enumerate(SEED_ADRS):
        doc = universe_doc({**row, "priority": 10 + i, "enabled": True})
        existing = await db[UNIVERSE_COL].find_one({"adr_symbol": doc["adr_symbol"]})
        if existing:
            continue
        await db[UNIVERSE_COL].update_one({"id": doc["id"]}, {"$setOnInsert": doc}, upsert=True)
        n += 1
    return n


async def list_universe(db, *, enabled_only: bool = False) -> List[Dict[str, Any]]:
    if db is None:
        return []
    q: Dict[str, Any] = {}
    if enabled_only:
        q["enabled"] = True
    return await db[UNIVERSE_COL].find(q, {"_id": 0}).sort("priority", 1).to_list(200)


def validate_universe_row(row: Dict[str, Any]) -> str:
    if not str(row.get("company_name") or "").strip():
        return "company required"
    if not str(row.get("indian_symbol") or "").strip():
        return "Indian symbol required"
    if not str(row.get("adr_symbol") or "").strip():
        return "ADR symbol required"
    if not str(row.get("exchange") or "").strip():
        return "exchange required"
    ratio = str(row.get("adr_ratio") or "1:1")
    if not re.match(r"^\d+(\.\d+)?:\d+(\.\d+)?$", ratio.strip()):
        return "ADR ratio must look like 1:1"
    return ""


async def upsert_universe_row(db, row: Dict[str, Any]) -> Dict[str, Any]:
    err = validate_universe_row(row)
    if err:
        raise ValueError(err)
    adr = str(row.get("adr_symbol")).strip().upper()
    existing = await db[UNIVERSE_COL].find_one({"adr_symbol": adr}) if db is not None else None
    want_id = str(row.get("id") or (existing or {}).get("id") or adr.lower())
    other = await db[UNIVERSE_COL].find_one({"id": {"$ne": want_id}, "adr_symbol": adr}) if db is not None else None
    if other:
        raise ValueError("duplicate ADR symbol")
    pair = await db[UNIVERSE_COL].find_one({
        "id": {"$ne": want_id},
        "indian_symbol": str(row.get("indian_symbol")).strip().upper(),
        "adr_symbol": adr,
    }) if db is not None else None
    if pair:
        raise ValueError("duplicate mapping")
    doc = universe_doc(row, existing_id=want_id)
    if db is not None:
        await db[UNIVERSE_COL].update_one({"id": want_id}, {"$set": doc}, upsert=True)
    return doc


async def delete_universe_row(db, uid: str) -> None:
    if db is None:
        return
    await db[UNIVERSE_COL].delete_one({"id": uid})


async def lookup_index_membership(db, indian_symbol: str) -> List[str]:
    if db is None or not indian_symbol:
        return []
    out = []
    try:
        cursor = db.index_constituents.find(
            {"symbol": {"$regex": f"^{re.escape(indian_symbol)}$", "$options": "i"}},
            {"_id": 0, "index": 1, "index_code": 1},
        )
        async for row in cursor:
            idx = str(row.get("index") or row.get("index_code") or "").upper()
            if idx and idx not in out:
                out.append(idx)
    except Exception:
        return []
    return out


def _strip_key(url: str) -> str:
    return redact(re.sub(r"(?i)([?&]apikey=)[^&]+", r"\1<redacted>", url))


async def _http_get(url: str, params: Dict[str, Any], timeout: float = 18.0):
    import httpx
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await client.get(url, params=params)


def quote_credit_wait_s(last_credit_at: float, now_mono: float, gap_s: float = TD_CREDIT_GAP_S) -> float:
    """Seconds to sleep so we never spend more than 8 Twelve Data credits per minute."""
    if last_credit_at <= 0:
        return 0.0
    return max(0.0, float(gap_s) - (now_mono - last_credit_at))


def rate_limit_wait_s(until_mono: float, now_mono: float) -> float:
    return max(0.0, until_mono - now_mono)


async def _consume_td_credit() -> None:
    """Serialize Twelve Data calls to Basic-8 (8 credits/min)."""
    global _last_quote_credit_at, _rate_limited_until
    now = time.monotonic()
    extra = rate_limit_wait_s(_rate_limited_until, now)
    gap = quote_credit_wait_s(_last_quote_credit_at, now + extra)
    wait = extra + gap
    if wait > 0:
        await asyncio.sleep(wait)
    _last_quote_credit_at = time.monotonic()


def mark_twelve_data_rate_limited(seconds: float = TD_RATE_LIMIT_BACKOFF_S) -> None:
    global _rate_limited_until
    _rate_limited_until = time.monotonic() + max(30.0, float(seconds))


async def fetch_quotes(api_key: str, symbols: List[str]) -> Tuple[Dict[str, Dict[str, Any]], Optional[str]]:
    if not api_key:
        return {}, "not_configured"
    if not symbols:
        return {}, None
    out: Dict[str, Dict[str, Any]] = {}
    err = None
    seen = []
    for raw_sym in symbols:
        sym = str(raw_sym or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.append(sym)
        await _consume_td_credit()
        try:
            r = await _http_get(QUOTE_URL, {"symbol": sym, "apikey": api_key})
        except Exception as e:
            import httpx
            kind = "Timeout" if isinstance(e, httpx.TimeoutException) else type(e).__name__
            await record_error(source="adr", message=redact(str(e))[:400], path="/quote", kind=kind)
            err = "timeout" if kind == "Timeout" else "provider_unavailable"
            continue
        if r.status_code in (401, 403):
            await record_error(source="adr", message=f"Client error {r.status_code} Unauthorized", path="/quote", kind="AuthError")
            return out, "unauthorized"
        if r.status_code == 429:
            mark_twelve_data_rate_limited()
            await record_error(source="adr", message="Client error 429 Too Many Requests", path="/quote", kind="RateLimit")
            return out, "rate_limited"
        if r.status_code >= 500:
            await record_error(source="adr", message=f"Client error {r.status_code} Internal Server Error", path="/quote", kind="ProviderError")
            err = "provider_unavailable"
            continue
        try:
            payload = r.json()
        except Exception:
            err = "bad_payload"
            continue
        if isinstance(payload, dict) and payload.get("status") == "error":
            msg = str(payload.get("message") or "quote error")
            if "rate" in msg.lower() or "limit" in msg.lower():
                mark_twelve_data_rate_limited()
                await record_error(source="adr", message=redact(msg)[:400], path="/quote", kind="RateLimit")
                return out, "rate_limited"
            await record_error(source="adr", message=redact(msg)[:400], path="/quote", kind="ProviderError")
            err = "provider_error"
            continue
        raw = payload
        if isinstance(payload, dict) and isinstance(payload.get(sym), dict):
            raw = payload[sym]
        if not isinstance(raw, dict):
            continue
        norm = normalize_quote(raw, symbol=sym)
        if norm:
            out[norm["symbol"]] = norm
    return out, err


async def test_connection(api_key: str) -> Dict[str, Any]:
    if not api_key:
        return {"ok": False, "error": "Not configured"}
    quotes, err = await fetch_quotes(api_key, ["INFY"])
    if quotes.get("INFY"):
        return {"ok": True, "symbol": "INFY", "last": quotes["INFY"].get("last_price")}
    return {"ok": False, "error": err or "Connection Failed"}


async def discover_and_seed(db, api_key: str) -> int:
    """Pull Twelve Data listings and keep only Indian ADRs missing from the universe."""
    added = await seed_universe(db)
    if not api_key or db is None:
        return added
    try:
        await _consume_td_credit()
        r = await _http_get(STOCKS_URL, {"type": "American Depositary Receipt", "apikey": api_key}, timeout=25.0)
        if r.status_code != 200:
            return added
        data = r.json()
        rows = data.get("data") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            return added
        for raw in rows:
            if not is_indian_adr_listing(raw):
                continue
            doc = universe_doc({
                "company_name": raw.get("name") or raw.get("symbol"),
                "indian_symbol": str(raw.get("symbol") or "").upper(),
                "adr_symbol": str(raw.get("symbol") or "").upper(),
                "exchange": raw.get("exchange") or "NYSE",
                "sector": "OTHER",
                "adr_ratio": "1:1",
                "provider_symbol": raw.get("symbol"),
                "enabled": True,
            })
            exists = await db[UNIVERSE_COL].find_one({"adr_symbol": doc["adr_symbol"]})
            if exists:
                continue
            await db[UNIVERSE_COL].update_one({"id": doc["id"]}, {"$setOnInsert": doc}, upsert=True)
            added += 1
    except Exception as e:
        await record_error(source="adr", message=redact(str(e))[:400], path="/stocks", kind=type(e).__name__)
    return added


async def prune_observations(db) -> None:
    if db is None:
        return
    cutoff = (_now_utc() - timedelta(hours=max(24, RETENTION_HOURS))).isoformat()
    try:
        keep = set()
        async for row in db[LATEST_COL].find({}, {"id": 1}):
            if row.get("id"):
                keep.add(row["id"])
        await db[OBS_COL].delete_many({"timestamp": {"$lt": cutoff}, "id": {"$nin": list(keep)}})
    except Exception as e:
        logger.warning("adr prune: %s", e)


def row_view(cfg: Dict[str, Any], latest: Optional[Dict[str, Any]], *, us_open: bool, indices: Optional[List[str]] = None) -> Dict[str, Any]:
    obs = latest or {}
    exch = cfg.get("exchange")
    venue_open = is_listing_session_open(exch)
    quote_open = obs.get("is_market_open")
    listing_open = bool(quote_open) if quote_open is not None else venue_open
    stale = (not listing_open) or obs.get("poll_status") in ("failed", "stale")
    status = "CURRENT"
    if obs.get("poll_status") == "failed":
        status = "LAST_KNOWN"
    elif not listing_open:
        status = "STALE"
    elif quote_open is False and venue_open:
        status = "USING_LAST_KNOWN"
    return {
        **{k: cfg.get(k) for k in (
            "id", "company_name", "indian_symbol", "adr_symbol", "exchange", "sector",
            "adr_ratio", "currency", "provider", "enabled", "priority",
        )},
        "listing_country": listing_country_code(exch),
        "listing_flag": listing_flag(exch),
        "listing_open": listing_open,
        "market_label": listing_market_name(exch),
        "last_price": obs.get("last_price"),
        "change": obs.get("change"),
        "change_percent": obs.get("change_percent"),
        "open": obs.get("open"),
        "high": obs.get("high"),
        "low": obs.get("low"),
        "previous_close": obs.get("previous_close"),
        "volume": obs.get("volume"),
        "average_volume": obs.get("average_volume"),
        "rolling_1d_change": obs.get("rolling_1d_change"),
        "rolling_7d_change": obs.get("rolling_7d_change"),
        "week52_low": obs.get("week52_low"),
        "week52_high": obs.get("week52_high"),
        "week52_range": obs.get("week52_range"),
        "is_market_open": listing_open if quote_open is None else bool(quote_open),
        "poll_status": obs.get("poll_status") or ("ok" if latest else "empty"),
        "fetched_at": obs.get("fetched_at"),
        "last_quote_at": obs.get("last_quote_at"),
        "display_status": status,
        "stale": stale,
        "indices": indices or [],
        "large_move": large_move(obs, float(cfg.get("large_move_threshold_percent") or 0) or DEFAULT_LARGE_MOVE) if obs else False,
        "observation": obs,
    }


async def desk_snapshot(db) -> Dict[str, Any]:
    prefs = public_prefs(await load_prefs(db))
    us_open = is_us_equity_session()
    items = await list_universe(db, enabled_only=True)
    latest_map = {}
    if db is not None:
        async for row in db[LATEST_COL].find({}, {"_id": 0}):
            latest_map[row.get("adr_id")] = row
    rows = []
    for cfg in items:
        idx = await lookup_index_membership(db, cfg.get("indian_symbol") or "")
        rows.append(row_view(cfg, latest_map.get(cfg["id"]), us_open=us_open, indices=idx))
    fetched = [r.get("fetched_at") for r in rows if r.get("fetched_at")]
    last = max(fetched) if fetched else None
    gainers = sum(1 for r in rows if (r.get("change_percent") or 0) > 0)
    losers = sum(1 for r in rows if (r.get("change_percent") or 0) < 0)
    large = sum(1 for r in rows if r.get("large_move"))
    return {
        "prefs": {k: prefs[k] for k in prefs if k not in ("api_key", "api_key_enc")},
        "us_market_open": us_open,
        "us_market_label": us_market_label(provider_open=us_open),
        "last_update": last,
        "summary": {
            "configured": len(rows),
            "gainers": gainers,
            "losers": losers,
            "large_moves": large,
            "us_market": "Open" if us_open else "Closed",
        },
        "items": rows,
    }


async def history(db, adr_id: str, range_key: str = "1D") -> List[Dict[str, Any]]:
    if db is None:
        return []
    hours = {"1D": 24, "5D": 24 * 5, "1M": 24 * 31}.get(str(range_key).upper(), 24)
    since = (_now_utc() - timedelta(hours=hours)).isoformat()
    docs = await db[OBS_COL].find(
        {"adr_id": adr_id, "timestamp": {"$gte": since}},
        {"_id": 0},
    ).sort("timestamp", 1).to_list(2000)
    return docs


async def _emit_intel_and_alerts(db, cfg: Dict[str, Any], obs: Dict[str, Any], prefs: Dict[str, Any], prev_latest: Optional[Dict[str, Any]]) -> None:
    if not cfg.get("market_intelligence_enabled", True) or prefs.get("market_intelligence_enabled") is False:
        return
    glob_thr = float(prefs.get("large_move_threshold_percent") or DEFAULT_LARGE_MOVE)
    own = _num(cfg.get("large_move_threshold_percent"))
    thr = float(own) if own is not None else glob_thr
    bank_thr = float(prefs.get("banking_move_threshold_percent") or DEFAULT_BANKING_MOVE)
    pct = _num(obs.get("change_percent"))
    prev_pct = _num((prev_latest or {}).get("change_percent") or (prev_latest or {}).get("last_alert_pct"))
    banking = is_banking_sector(cfg.get("sector"))
    hit = large_move(obs, thr) or (banking and large_move(obs, bank_thr))
    if not hit or not meaningful_new_move(prev_pct, pct, min(thr, bank_thr) if banking else thr):
        return
    sign = "🟢" if (pct or 0) >= 0 else "🔴"
    title = f"{sign} {cfg['company_name']} ADR {pct:+.1f}%"
    if banking and large_move(obs, bank_thr):
        title = f"{sign} Banking ADR Alert {cfg['company_name']} {pct:+.1f}%"
    summary = (
        f"{cfg['company_name']} ADR ({cfg['adr_symbol']}) {pct:+.2f}% at ${obs.get('last_price')} "
        f"on {cfg.get('exchange')} during the US session. Indian symbol {cfg.get('indian_symbol')}."
    )
    indices = await lookup_index_membership(db, cfg.get("indian_symbol") or "")
    if indices:
        summary += " Linked indices: " + ", ".join(indices) + "."
    impact = 92 if abs(pct or 0) >= max(thr, 8) else 80
    now = _now_utc().isoformat()
    session = et_date_iso()
    dhash = hashlib.sha1(f"adr|{cfg['id']}|{session}|{int((pct or 0) // 2)}".encode()).hexdigest()[:16]
    art = {
        "id": uuid.uuid4().hex,
        "source_id": "adr-monitor",
        "source_name": "ADR Monitor",
        "source_type": "OFFICIAL_FEED",
        "source_url": "",
        "article_url": "",
        "title": title[:400],
        "summary": summary[:2000],
        "published_at": now,
        "discovered_at": now,
        "author": "",
        "event_type": "corporate",
        "impact_score": impact,
        "india_relevance_score": 88,
        "impact_band": "CRITICAL" if impact >= 90 else "HIGH",
        "duplicate_hash": dhash,
        "event_cluster_id": dhash,
        "status": "ok",
        "source_priority": 15,
        "potential": ["US ADR move can gap the NSE parent at the Indian open"],
        "adr_id": cfg["id"],
        "adr_symbol": cfg["adr_symbol"],
    }
    if db is not None:
        exists = await db["mi_articles"].find_one({"duplicate_hash": dhash})
        if not exists:
            await db["mi_articles"].insert_one(art)
        if prefs.get("notifications_enabled") is not False and cfg.get("notification_enabled") is not False:
            alert = {
                "index": cfg.get("indian_symbol") or cfg["adr_symbol"],
                "created_at": now,
                "price": obs.get("last_price"),
                "atm": None,
                "direction": f"Large ADR Move {cfg['company_name']} {pct:+.2f}%",
                "severity": "warning",
                "strikes": [],
                "message": f"{cfg['company_name']} ADR {cfg['adr_symbol']} ${obs.get('last_price')} {pct:+.2f}%",
                "kind": "adr",
                "adr_id": cfg["id"],
            }
            recent = await db.alerts.find_one({"adr_id": cfg["id"], "kind": "adr"}, sort=[("created_at", -1)])
            if recent:
                try:
                    last_ts = datetime.fromisoformat(str(recent["created_at"]).replace("Z", "+00:00"))
                    if (_now_utc() - last_ts).total_seconds() < 3600 and not meaningful_new_move(
                        _num(recent.get("change_percent")), pct, thr
                    ):
                        return
                except Exception:
                    pass
            alert["change_percent"] = pct
            await db.alerts.insert_one(alert)
            try:
                from notifier import notifier
                await notifier.alert_oi_spike(alert)
            except Exception:
                pass


async def poll_once(db, *, reason: str = "interval") -> Dict[str, Any]:
    prefs_doc = await load_prefs(db)
    prefs = {**default_prefs(), **{k: v for k, v in prefs_doc.items() if k != "_id"}}
    if prefs.get("enabled") is False:
        return {"ok": False, "reason": "disabled"}
    key = _api_key_from_doc(prefs_doc)
    await seed_universe(db)
    items = await list_universe(db, enabled_only=True)
    symbols = [c.get("provider_symbol") or c["adr_symbol"] for c in items]
    quotes, err = await fetch_quotes(key, symbols)
    stored = 0
    failed = 0
    for cfg in items:
        sym = (cfg.get("provider_symbol") or cfg["adr_symbol"]).upper()
        q = quotes.get(sym)
        prev = None
        if db is not None:
            prev = await db[LATEST_COL].find_one({"adr_id": cfg["id"]}, {"_id": 0})
        if not q:
            failed += 1
            continue
        obs = observation_from_quote(cfg, q, poll_status="ok")
        if db is not None:
            await db[OBS_COL].insert_one(dict(obs))
            latest = {**obs, "last_alert_pct": (prev or {}).get("last_alert_pct")}
            await db[LATEST_COL].update_one({"adr_id": cfg["id"]}, {"$set": latest}, upsert=True)
            await _emit_intel_and_alerts(db, cfg, obs, prefs, prev)
            if large_move(obs, float(cfg.get("large_move_threshold_percent") or prefs.get("large_move_threshold_percent") or DEFAULT_LARGE_MOVE)):
                await db[LATEST_COL].update_one({"adr_id": cfg["id"]}, {"$set": {"last_alert_pct": obs.get("change_percent")}})
        stored += 1
    if err and stored == 0:
        await record_error(
            source="adr",
            message=f"ADR poll {reason} failed ({err}); keeping last successful observations",
            path="/adr/poll",
            kind="PollFailed",
        )
        if err != "rate_limited" and db is not None:
            await db[LATEST_COL].update_many({}, {"$set": {"poll_status": "failed"}})
        return {"ok": False, "reason": err, "stored": 0, "failed": failed}
    if db is not None:
        await db[STATE_COL].update_one(
            {"_id": "loop"},
            {"$set": {"last_reason": reason, "last_ok_at": _now_utc().isoformat(), "stored": stored}},
            upsert=True,
        )
        await prune_observations(db)
    return {"ok": True, "reason": reason, "stored": stored, "failed": failed, "error": err}


def _seconds_since(iso_ts: Any, dt: datetime) -> Optional[float]:
    if not iso_ts:
        return None
    try:
        prev = datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        if prev.tzinfo is None:
            prev = prev.replace(tzinfo=UTC)
        return (dt - prev).total_seconds()
    except Exception:
        return None


def should_poll_now(state: Dict[str, Any], prefs: Dict[str, Any], now: Optional[datetime] = None) -> Tuple[bool, str]:
    """Return (poll?, reason). Immediate on US open; stop after US close; one IST 09:15 refresh."""
    dt = now or _now_utc()
    et = now_et(dt)
    ist = now_ist(dt)
    interval = max(60, int(prefs.get("poll_interval_seconds") or DEFAULT_POLL_SECONDS))
    last_ok = state.get("last_ok_at")
    last_attempt = state.get("last_attempt_at") or last_ok
    backoff = max(0, int(state.get("rate_limit_backoff_s") or 0))
    min_gap = max(interval, backoff)
    last_open_day = state.get("last_us_open_day")
    last_ist_day = state.get("last_ist_refresh_day")
    us_open = is_us_equity_session(dt)
    de_open = is_de_equity_session(dt)
    today_et = et.date().isoformat()
    today_ist = ist.date().isoformat()

    age = _seconds_since(last_attempt, dt)
    if age is not None and age < min_gap and backoff:
        return False, "wait"

    if us_open and last_open_day != today_et:
        return True, "us_open"
    if prefs.get("indian_open_refresh") is not False:
        ist_t = ist.time()
        window_end = (datetime.combine(date(2000, 1, 1), IST_OPEN_REFRESH) + timedelta(minutes=4)).time()
        nse_day = True
        try:
            from market_hours import is_trading_day
            nse_day = is_trading_day(ist)
        except Exception:
            nse_day = ist.weekday() < 5
        if nse_day and IST_OPEN_REFRESH <= ist_t <= window_end and last_ist_day != today_ist:
            return True, "ist_open"
    if not us_open and not de_open:
        return False, "us_closed"
    if age is not None and age < min_gap:
        return False, "wait"
    if de_open and not us_open and not last_ok:
        return True, "de_open"
    if not last_ok:
        return True, "interval"
    try:
        prev = datetime.fromisoformat(str(last_ok).replace("Z", "+00:00"))
        if (dt - prev).total_seconds() >= interval:
            return True, "interval"
    except Exception:
        return True, "interval"
    return False, "wait"


async def loop(db_fn, stop: asyncio.Event) -> None:
    await asyncio.sleep(12)
    while not stop.is_set():
        try:
            db = db_fn() if callable(db_fn) else db_fn
            await seed_universe(db)
            prefs_doc = await load_prefs(db)
            prefs = {**default_prefs(), **prefs_doc}
            state = {}
            if db is not None:
                state = await db[STATE_COL].find_one({"_id": "loop"}) or {}
            go, reason = should_poll_now(state, prefs)
            if go and prefs.get("enabled") is not False:
                result = await poll_once(db, reason=reason)
                patch = {"last_reason": reason, "last_attempt_at": _now_utc().isoformat()}
                if result.get("reason") == "rate_limited":
                    patch["rate_limit_backoff_s"] = TD_RATE_LIMIT_BACKOFF_S
                elif result.get("ok"):
                    patch["rate_limit_backoff_s"] = 0
                else:
                    patch["rate_limit_backoff_s"] = 45
                if reason == "us_open":
                    patch["last_us_open_day"] = et_date_iso()
                if reason == "ist_open":
                    patch["last_ist_refresh_day"] = now_ist().date().isoformat()
                if db is not None:
                    await db[STATE_COL].update_one({"_id": "loop"}, {"$set": patch}, upsert=True)
                if not result.get("ok") and reason == "ist_open":
                    logger.warning("09:15 IST ADR refresh failed; last successful data kept")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("adr loop: %s", e)
            await record_error(source="adr", message=redact(str(e))[:400], path="/adr/loop", kind=type(e).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass


def start_loop(db_fn):
    global _stop, _task
    _stop = asyncio.Event()
    _task = asyncio.create_task(loop(db_fn, _stop))
    return _task, _stop


def stop_loop():
    global _stop
    if _stop:
        _stop.set()
