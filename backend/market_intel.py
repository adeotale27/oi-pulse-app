"""Market Intelligence: ingest → normalize → score → cluster → rank → retain.

Sources are Mongo-configured (API / RSS / Firecrawl / official feed).
The engine never branches on a website name.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from error_log import record_error, redact

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")

SRC_COL = "mi_sources"
ART_COL = "mi_articles"
SEEN_COL = "mi_popup_seen"
PREF_COL = "mi_user_prefs"

SOURCE_TYPES = ("API", "RSS", "FIRECRAWL", "OFFICIAL_FEED")
STATUSES = ("HEALTHY", "WARNING", "FAILED", "DISABLED")

DEFAULT_INGEST_S = 300
DEFAULT_RETENTION_DAYS = 5
DEFAULT_MIN_HISTORY_DAYS = 2
BOOT_DELAY_S = 90  # do not compete with OI/Kite boot

FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v1/scrape"

PUBLIC_API_CATALOG = [
    {
        "id": "gnews",
        "name": "GNews",
        "note": "public-apis News. Free tier + API key. India + world headlines.",
        "source_type": "API",
        "endpoint": "https://gnews.io/api/v4/search",
        "method": "GET",
        "auth": "query",
        "auth_key": "apikey",
        "query": {"q": "markets OR RBI OR Federal Reserve OR crude", "lang": "en", "max": "20"},
        "mapping": {"list": "articles", "title": "title", "url": "url", "description": "description", "published_at": "publishedAt", "source": "source.name"},
    },
    {
        "id": "finnhub-news",
        "name": "Finnhub market news",
        "note": "public-apis Finance. Token header. General market news.",
        "source_type": "API",
        "endpoint": "https://finnhub.io/api/v1/news",
        "method": "GET",
        "auth": "query",
        "auth_key": "token",
        "query": {"category": "general"},
        "mapping": {"list": "", "title": "headline", "url": "url", "description": "summary", "published_at": "datetime", "source": "source"},
    },
    {
        "id": "newsapi",
        "name": "NewsAPI.org",
        "note": "public-apis News. Header X-Api-Key. Dev plan is delayed; prefer paid/live.",
        "source_type": "API",
        "endpoint": "https://newsapi.org/v2/everything",
        "method": "GET",
        "auth": "header",
        "auth_header": "X-Api-Key",
        "query": {"q": "Federal Reserve OR RBI OR crude oil OR Nifty", "language": "en", "pageSize": "20", "sortBy": "publishedAt"},
        "mapping": {"list": "articles", "title": "title", "url": "url", "description": "description", "published_at": "publishedAt", "source": "source.name"},
    },
    {
        "id": "alphavantage-news",
        "name": "Alpha Vantage NEWS_SENTIMENT",
        "note": "public-apis Finance. Query apikey. Rate-limited free tier.",
        "source_type": "API",
        "endpoint": "https://www.alphavantage.co/query",
        "method": "GET",
        "auth": "query",
        "auth_key": "apikey",
        "query": {"function": "NEWS_SENTIMENT", "topics": "economy_macro,energy_transportation,financial_markets", "limit": "20"},
        "mapping": {"list": "feed", "title": "title", "url": "url", "description": "summary", "published_at": "time_published", "source": "source"},
    },
]

RSS_TEMPLATES = [
    {
        "id": "google-news-in",
        "name": "Google News (markets, IN)",
        "source_type": "RSS",
        "endpoint": "https://news.google.com/rss/search?q=RBI+OR+Sensex+OR+Nifty+OR+FOMC+OR+crude+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
        "note": "Public RSS. Same family as Desk AI tape.",
    },
    {
        "id": "et-markets",
        "name": "Economic Times markets",
        "source_type": "RSS",
        "endpoint": "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
        "note": "Public RSS already used on the desk tape.",
    },
    {
        "id": "bbc-business",
        "name": "BBC Business",
        "source_type": "RSS",
        "endpoint": "https://feeds.bbci.co.uk/news/business/rss.xml",
        "note": "Public RSS. Global business headlines.",
    },
    {
        "id": "mint-markets",
        "name": "Mint markets",
        "source_type": "RSS",
        "endpoint": "https://www.livemint.com/rss/markets",
        "note": "Public RSS. India markets.",
    },
    {
        "id": "hindu-bl-markets",
        "name": "Business Line markets",
        "source_type": "RSS",
        "endpoint": "https://www.thehindubusinessline.com/markets/feeder/default.rss",
        "note": "Public RSS. India markets.",
    },
    {
        "id": "moneycontrol-markets",
        "name": "Moneycontrol market reports",
        "source_type": "RSS",
        "endpoint": "https://www.moneycontrol.com/rss/marketreports.xml",
        "note": "Public RSS. India market reports.",
    },
]

# --- scoring (data-driven keywords, not a fixed index catalog) ---
_CRIT = (
    r"\bemergency\b", r"\brate cut\b", r"\brate hike\b", r"\b50\s*bp", r"\bfomc\b",
    r"\bfederal reserve\b", r"\bfed (holds|cuts|hikes|pauses)\b",
    r"\bopec\+?\b.{0,40}\b(cut|boost|output|production)\b",
    r"\bsupply disruption\b", r"\bstrait of hormuz\b", r"\boil embargo\b",
    r"\bdefault\b", r"\bbankruptcy\b", r"\bwar\b.{0,30}\b(escalat|invasion)\b",
)
_HIGH = (
    r"\bcpi\b", r"\bppi\b", r"\bnonfarm\b", r"\bunemployment\b", r"\bgdp\b",
    r"\becb\b", r"\bboj\b", r"\bboe\b", r"\brbi\b", r"\bsebi\b",
    r"\brepo rate\b", r"\btariff", r"\bsanction", r"\bcrude\b", r"\brent\b", r"\bwti\b",
    r"\bearnings surprise\b", r"\bguidance (cut|raise|slash)\b", r"\bmerger\b", r"\bacquisition\b",
    r"\bfraud\b", r"\bdowngrade\b", r"\binflation\b",
)
_INDIA_DIRECT = (
    r"\bindia\b", r"\bindian\b", r"\brbi\b", r"\bsebi\b", r"\bnse\b", r"\bbse\b",
    r"\bfii\b", r"\bdii\b", r"\binr\b", r"\brupee\b", r"\bmof\b", r"\bfinance ministry\b",
    r"\bwpi\b", r"\biip\b", r"\bgift nifty\b",
)
_INDIA_VIA_GLOBAL = (
    r"\bfed\b", r"\bfederal reserve\b", r"\busd\b", r"\bdollar\b", r"\bus treasury\b",
    r"\byield", r"\bcrude\b", r"\boil\b", r"\bopec\b", r"\bchina\b", r"\btariff",
    r"\bmiddle east\b", r"\bukraine\b", r"\brussia\b", r"\bliquidity\b",
    r"\becb\b", r"\bpmi\b", r"\bcpi\b", r"\bjobs report\b", r"\bnonfarm\b",
)
_NOISE = (
    r"\bopinion\b", r"\bwhat to watch\b", r"\bmay rally\b", r"\bcould rise\b",
    r"\banalyst (says|see)\b", r"\bhow to trade\b", r"\bnewsletter\b",
    r"\brecap\b", r"\bweek ahead\b", r"\bexplained\b",
)

_TOKEN = re.compile(r"[a-z0-9]{3,}")


def ist_today(now: Optional[datetime] = None) -> date:
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n.astimezone(IST).date()


def item_ist_date(doc: Dict[str, Any]) -> Optional[date]:
    """Calendar day shown on the desk: YYYY-MM-DD prefix of published/discovered."""
    raw = str(doc.get("published_at") or doc.get("discovered_at") or "").strip()
    if len(raw) >= 10:
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            pass
    return None


def is_ist_today_item(doc: Dict[str, Any], today: Optional[date] = None) -> bool:
    d = item_ist_date(doc)
    return d is not None and d == (today or ist_today())


def clamp_retention(retention_days: int, min_history_days: int) -> Tuple[int, int]:
    mn = max(1, min(30, int(min_history_days or DEFAULT_MIN_HISTORY_DAYS)))
    ret = max(mn, min(90, int(retention_days or DEFAULT_RETENTION_DAYS)))
    return ret, mn


def retention_cutoff(today: date, retention_days: int, min_history_days: int) -> date:
    ret, mn = clamp_retention(retention_days, min_history_days)
    days = max(ret, mn)
    return today - timedelta(days=days - 1)


def _blob(*parts: Any) -> str:
    return " ".join(str(p or "") for p in parts).lower()


def _hits(text: str, patterns: Iterable[str]) -> int:
    return sum(1 for p in patterns if re.search(p, text, re.I))


def classify_event_type(text: str) -> str:
    t = text.lower()
    if _hits(t, (r"\brbi\b", r"\bsebi\b", r"\bnse\b", r"\bindia")):
        if _hits(t, (r"\bcpi\b", r"\bgdp\b", r"\brepo", r"\brbi")):
            return "india_macro"
    if _hits(t, (r"\bfed\b", r"\bfomc\b", r"\bcpi\b", r"\bnonfarm", r"\becb\b")):
        return "macro"
    if _hits(t, (r"\bcrude\b", r"\boil\b", r"\bopec\b", r"\brent\b")):
        return "oil"
    if _hits(t, (r"\bwar\b", r"\btariff", r"\bsanction", r"\bukraine", r"\bisrael", r"\bhamas")):
        return "geopolitics"
    if _hits(t, (r"\bearnings\b", r"\bmerger\b", r"\bceo\b", r"\bipo\b", r"\bdefault\b")):
        return "corporate"
    return "other"


def impact_score(title: str, summary: str = "") -> int:
    t = _blob(title, summary)
    if _hits(t, _NOISE) and not _hits(t, _CRIT + _HIGH):
        return 22
    score = 28
    score += 28 * _hits(t, _CRIT)
    score += 14 * _hits(t, _HIGH)
    if re.search(r"\b(cpi|ppi|nonfarm|fomc|federal reserve|us cpi)\b", t):
        score += 12
    if re.search(r"\b(surprise|above (forecast|expectations?)|misses|plunges|soars|emergency)\b", t):
        score += 12
    if re.search(r"\b(commentary|says|may|could|might)\b", t) and not _hits(t, _CRIT):
        score -= 10
    return int(max(0, min(100, score)))


def india_relevance_score(title: str, summary: str = "") -> int:
    t = _blob(title, summary)
    score = 8 * _hits(t, _INDIA_DIRECT) + 10 * min(4, _hits(t, _INDIA_VIA_GLOBAL))
    if _hits(t, (r"\brbi\b", r"\binr\b", r"\bfii\b", r"\bsebi\b")):
        score += 28
    if _hits(t, (r"\bfed\b", r"\bcpi\b", r"\bcrude\b")):
        score += 30
    return int(max(0, min(100, score)))


def impact_band(score: int, *, critical=90, high=75, moderate=55, low=35) -> str:
    if score >= critical:
        return "CRITICAL"
    if score >= high:
        return "HIGH"
    if score >= moderate:
        return "MODERATE"
    if score >= low:
        return "LOW"
    return "NOISE"


def normalize_title(title: str) -> str:
    s = re.sub(r"[^a-z0-9\s]+", " ", str(title or "").lower())
    s = s.replace("federal reserve", "fed")
    s = re.sub(r"\b(\d+)\s*bps?\b", r"\1bp", s)
    s = re.sub(r"\b(the|a|an|to|of|in|on|for|and|as)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def duplicate_hash(title: str, url: str = "") -> str:
    host = urlparse(str(url or "")).netloc.lower().replace("www.", "")
    base = normalize_title(title) or host
    return hashlib.sha1(base.encode()).hexdigest()[:20]


def token_set(title: str) -> set:
    raw = _TOKEN.findall(normalize_title(title))
    out = set()
    for t in raw:
        out.add(t)
        if t.endswith("s") and len(t) > 3:
            out.add(t[:-1])
    return out


def similar_titles(a: str, b: str, thresh: float = 0.32) -> bool:
    sa, sb = token_set(a), token_set(b)
    if not sa or not sb:
        return False
    return len(sa & sb) / len(sa | sb) >= thresh


def cluster_id_for(title: str, existing: List[Dict[str, Any]]) -> str:
    for row in existing:
        if similar_titles(title, row.get("title") or ""):
            return str(row.get("event_cluster_id") or row.get("duplicate_hash") or uuid.uuid4().hex[:16])
    return duplicate_hash(title)


def rank_key(doc: Dict[str, Any]) -> Tuple:
    impact = int(doc.get("impact_score") or 0)
    india = int(doc.get("india_relevance_score") or 0)
    pri = int(doc.get("source_priority") or 50)
    pub = str(doc.get("published_at") or "")
    urgency = 1 if impact >= 90 else 0
    return (-(impact * 2 + india + pri // 5 + urgency * 20), pub)


def potential_impact_lines(event_type: str, india: int) -> List[str]:
    lines = {
        "macro": ["US yields / USD may move", "FII risk appetite can shift", "Indian equities may follow global tape"],
        "oil": ["Crude ↑ pressure", "INR / inflation risk", "Indian equities energy-sensitive"],
        "india_macro": ["Domestic rates / INR", "Banking and rate-sensitive sectors", "Index options vol can jump"],
        "geopolitics": ["Risk-off tape", "Oil / shipping premium", "FII flows cautious"],
        "corporate": ["Single-name / sector move", "Credit and positioning risk"],
    }.get(event_type, ["Watch liquidity and overnight gaps"])
    if india < 40:
        return lines[:2]
    return lines


def extract_path(data: Any, path: str) -> Any:
    if not path:
        return data
    cur = data
    for part in str(path).replace("[", ".").replace("]", "").split("."):
        if part == "" or cur is None:
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError, TypeError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def map_records(payload: Any, mapping: Optional[Dict[str, str]]) -> List[Dict[str, Any]]:
    mapping = mapping or {}
    list_path = mapping.get("list") or ""
    raw = extract_path(payload, list_path) if list_path else payload
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        def g(key, *alts):
            p = mapping.get(key)
            if p:
                v = extract_path(item, p)
                if v is not None:
                    return v
            for a in alts:
                if a in item:
                    return item[a]
            return None
        title = g("title", "title", "headline", "name")
        if not title:
            continue
        pub = g("published_at", "published_at", "publishedAt", "pubDate", "datetime", "time_published")
        if isinstance(pub, (int, float)) and pub > 1e11:
            pub = datetime.fromtimestamp(pub / 1000, tz=timezone.utc).isoformat()
        elif isinstance(pub, (int, float)) and pub > 1e9:
            pub = datetime.fromtimestamp(pub, tz=timezone.utc).isoformat()
        out.append({
            "title": str(title)[:400],
            "url": str(g("url", "url", "link") or "")[:800],
            "description": str(g("description", "description", "summary", "content") or "")[:2000],
            "published_at": str(pub or "")[:40],
            "source_name": str(g("source", "source") or "")[:80],
            "author": str(g("author", "author") or "")[:80],
        })
    return out


def public_source(doc: Dict[str, Any]) -> Dict[str, Any]:
    d = {k: v for k, v in (doc or {}).items() if k not in ("api_key_enc", "headers_secret", "bearer_enc")}
    d["has_secret"] = bool(doc.get("api_key_enc") or doc.get("bearer_enc"))
    st = str(doc.get("source_type") or "").upper()
    auth = str(doc.get("auth") or "none").lower()
    d["needs_key"] = st == "FIRECRAWL" or auth not in ("none", "")
    d.pop("_id", None)
    return d


def source_health_status(doc: Dict[str, Any]) -> str:
    if not doc.get("enabled"):
        return "DISABLED"
    fails = int(doc.get("consecutive_failures") or 0)
    if fails >= 3:
        return "FAILED"
    if fails >= 1:
        return "WARNING"
    return "HEALTHY"


def _catalog_source_doc(t: Dict[str, Any], *, enabled: bool, priority: int) -> Dict[str, Any]:
    st = str(t.get("source_type") or "RSS").upper()
    return {
        "id": t["id"],
        "name": t.get("name") or t["id"],
        "source_type": st,
        "endpoint": t.get("endpoint") or t.get("url") or "",
        "method": str(t.get("method") or "GET").upper(),
        "query": dict(t.get("query") or {}),
        "headers": dict(t.get("headers") or {}),
        "auth": t.get("auth") or "none",
        "auth_key": t.get("auth_key"),
        "auth_header": t.get("auth_header"),
        "mapping": dict(t.get("mapping") or {}),
        "enabled": enabled,
        "priority": int(t.get("priority") or priority),
        "max_items": int(t.get("max_items") or 30),
        "category": t.get("category"),
        "region": t.get("region"),
        "is_catalog": True,
    }


async def ensure_default_sources(db) -> None:
    """Seed public market-news RSS (on) and catalog APIs (on, skipped until a key is stored). Never overwrite enabled."""
    if db is None:
        return
    for t in RSS_TEMPLATES:
        if await db[SRC_COL].find_one({"id": t["id"]}):
            continue
        await db[SRC_COL].update_one({"id": t["id"]}, {"$set": _catalog_source_doc(t, enabled=True, priority=20)}, upsert=True)
    for t in PUBLIC_API_CATALOG:
        if await db[SRC_COL].find_one({"id": t["id"]}):
            continue
        await db[SRC_COL].update_one({"id": t["id"]}, {"$set": _catalog_source_doc(t, enabled=True, priority=40)}, upsert=True)


async def ensure_indexes(db) -> None:
    if db is None:
        return
    await db[ART_COL].create_index("published_at")
    await db[ART_COL].create_index("discovered_at")
    await db[ART_COL].create_index("duplicate_hash")
    await db[ART_COL].create_index("event_cluster_id")
    await db[ART_COL].create_index("source_id")
    await db[ART_COL].create_index([("status", 1), ("published_at", -1)])
    await db[SRC_COL].create_index("enabled")
    await db[SEEN_COL].create_index([("user_id", 1), ("event_cluster_id", 1)], unique=True)
    await db[PREF_COL].create_index("user_id", unique=True)


def popup_allowed(global_on: bool, prefs: Dict[str, Any], *, is_admin: bool) -> bool:
    """In-app popup only. Ingest always runs independently of these ticks.

    Global desk tick off → nobody. Global on → admin always sees it (page hide
    does not suppress). Guests need their own popup tick; page tick is unrelated.
    """
    if not global_on:
        return False
    if is_admin:
        return True
    return bool((prefs or {}).get("popup_enabled", True))


def default_user_prefs() -> Dict[str, Any]:
    return {
        "page_enabled": True,
        "popup_enabled": True,
        "popup_min_impact": 90,
        "popup_min_india": 70,
        "show_critical": True,
        "show_high": True,
        "show_moderate": False,
        "categories": ["India", "Macro", "Fed", "Oil", "Geopolitics", "Corporate"],
        "ui_poll_seconds": 120,
        "min_impact": 55,
        "min_india": 0,
    }


def _secret_from_source(src: Dict[str, Any]) -> str:
    from desk_llm import decrypt_secret
    for k in ("api_key_enc", "bearer_enc"):
        blob = src.get(k)
        if blob:
            try:
                return decrypt_secret(blob)
            except Exception:
                return ""
    return ""


async def _http_json(method: str, url: str, *, headers=None, params=None, json_body=None, timeout=12.0):
    import httpx
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        r = await client.request(method.upper(), url, headers=headers, params=params, json=json_body)
        return r


def _auth_headers_params(src: Dict[str, Any]) -> Tuple[Dict[str, str], Dict[str, str]]:
    secret = _secret_from_source(src)
    headers = dict(src.get("headers") or {})
    params = dict(src.get("query") or src.get("query_params") or {})
    auth = str(src.get("auth") or "none").lower()
    if secret and auth == "bearer":
        headers["Authorization"] = f"Bearer {secret}"
    elif secret and auth == "header":
        headers[str(src.get("auth_header") or "X-Api-Key")] = secret
    elif secret and auth in ("query", "api_key"):
        params[str(src.get("auth_key") or "apikey")] = secret
    return {str(k): str(v) for k, v in headers.items()}, {str(k): str(v) for k, v in params.items()}


async def fetch_source_raw(src: Dict[str, Any], *, test: bool = False) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Return (mapped items, meta). Never raises to caller for HTTP failures — meta.error set."""
    st = str(src.get("source_type") or "RSS").upper()
    url = str(src.get("endpoint") or src.get("url") or "").strip()
    meta: Dict[str, Any] = {"fetched": 0, "http_status": None, "error": None}
    limit = 5 if test else int(src.get("max_items") or 30)
    if not url:
        meta["error"] = "missing_url"
        return [], meta
    try:
        if st in ("RSS", "OFFICIAL_FEED"):
            from desk_outside import parse_rss_items, UA
            import httpx
            async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
                r = await client.get(url)
            meta["http_status"] = r.status_code
            r.raise_for_status()
            items = parse_rss_items(r.text, limit=limit)
            mapped = [{
                "title": it.get("title"),
                "url": it.get("url") or it.get("link"),
                "description": it.get("summary") or it.get("title"),
                "published_at": it.get("published") or "",
                "source_name": it.get("source") or src.get("name") or "",
            } for it in items]
            meta["fetched"] = len(mapped)
            return mapped[:limit], meta

        if st == "FIRECRAWL":
            from desk_llm import decrypt_secret
            key = ""
            if src.get("api_key_enc"):
                try:
                    key = decrypt_secret(src["api_key_enc"])
                except Exception:
                    key = ""
            if not key:
                meta["error"] = "missing_firecrawl_key"
                return [], meta
            body = {"url": url, "formats": ["markdown"], "onlyMainContent": True}
            r = await _http_json("POST", FIRECRAWL_SCRAPE, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json_body=body, timeout=20.0)
            meta["http_status"] = r.status_code
            if r.status_code in (429, 500, 502, 503):
                meta["error"] = f"http_{r.status_code}"
                return [], meta
            r.raise_for_status()
            data = r.json() if r.content else {}
            md = ((data.get("data") or {}).get("markdown") if isinstance(data.get("data"), dict) else None) or data.get("markdown") or ""
            title = urlparse(url).netloc or url
            mapped = [{
                "title": title,
                "url": url,
                "description": str(md)[:1500],
                "published_at": datetime.now(timezone.utc).isoformat(),
                "source_name": src.get("name") or title,
            }]
            meta["fetched"] = 1
            return mapped, meta

        # API
        auth = str(src.get("auth") or "none").lower()
        if auth not in ("none", "") and not _secret_from_source(src):
            meta["error"] = "missing_api_key"
            return [], meta
        headers, params = _auth_headers_params(src)
        method = str(src.get("method") or "GET").upper()
        r = await _http_json(method, url, headers=headers, params=params, json_body=src.get("body") if method != "GET" else None)
        meta["http_status"] = r.status_code
        if r.status_code in (429, 500, 502, 503, 504):
            meta["error"] = f"http_{r.status_code}"
            return [], meta
        r.raise_for_status()
        payload = r.json() if r.content else {}
        mapped = map_records(payload, src.get("mapping") or {})
        meta["fetched"] = len(mapped)
        return mapped[:limit], meta
    except Exception as e:
        import httpx
        if isinstance(e, httpx.TimeoutException):
            meta["error"] = "timeout"
            return [], meta
        meta["error"] = redact(str(e) or type(e).__name__)[:240]
        return [], meta


def enrich_item(raw: Dict[str, Any], src: Dict[str, Any]) -> Dict[str, Any]:
    title = str(raw.get("title") or "").strip()
    summary = str(raw.get("description") or "")
    url = str(raw.get("url") or "")
    impact = impact_score(title, summary)
    india = india_relevance_score(title, summary)
    et = classify_event_type(_blob(title, summary))
    now = datetime.now(timezone.utc).isoformat()
    dhash = duplicate_hash(title, url)
    status = "noise" if impact < 35 else "ok"
    return {
        "id": uuid.uuid4().hex,
        "source_id": src.get("id"),
        "source_name": src.get("name") or raw.get("source_name") or "",
        "source_type": src.get("source_type"),
        "source_url": src.get("endpoint") or src.get("url") or "",
        "article_url": url,
        "title": title[:400],
        "summary": summary[:2000],
        "published_at": str(raw.get("published_at") or now)[:40],
        "discovered_at": now,
        "author": raw.get("author") or "",
        "event_type": et,
        "impact_score": impact,
        "india_relevance_score": india,
        "impact_band": impact_band(impact),
        "duplicate_hash": dhash,
        "event_cluster_id": dhash,
        "status": status,
        "source_priority": int(src.get("priority") or 50),
        "potential": potential_impact_lines(et, india),
    }


async def ingest_one(db, src: Dict[str, Any], *, test: bool = False) -> Dict[str, Any]:
    stats = {"fetched": 0, "accepted": 0, "duplicates": 0, "noise": 0, "error": None, "preview": []}
    if not src.get("enabled") and not test:
        stats["error"] = "disabled"
        return stats
    items, meta = await fetch_source_raw(src, test=test)
    stats["fetched"] = meta.get("fetched") or len(items)
    stats["error"] = meta.get("error")
    stats["http_status"] = meta.get("http_status")
    if meta.get("error"):
        return stats
    recent = []
    if db is not None and not test:
        recent = await db[ART_COL].find({}, {"title": 1, "event_cluster_id": 1, "duplicate_hash": 1, "_id": 0}).sort("discovered_at", -1).to_list(80)
    for raw in items:
        row = enrich_item(raw, src)
        if test:
            stats["preview"].append({k: row[k] for k in ("title", "impact_score", "india_relevance_score", "event_type", "article_url", "impact_band")})
            stats["accepted"] += 1
            continue
        if row["status"] == "noise":
            stats["noise"] += 1
        cid = cluster_id_for(row["title"], recent)
        row["event_cluster_id"] = cid
        if db is None:
            stats["accepted"] += 1
            continue
        exists = await db[ART_COL].find_one({"duplicate_hash": row["duplicate_hash"]})
        if exists:
            stats["duplicates"] += 1
            continue
        await db[ART_COL].insert_one(row)
        recent.insert(0, row)
        stats["accepted"] += 1
    return stats


async def update_source_health(db, src_id: str, stats: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    err = stats.get("error")
    patch: Dict[str, Any] = {
        "last_run": now,
        "last_fetched": stats.get("fetched") or 0,
        "last_accepted": stats.get("accepted") or 0,
        "last_duplicates": stats.get("duplicates") or 0,
        "last_noise": stats.get("noise") or 0,
        "last_error": err,
    }
    if err in ("missing_api_key", "missing_firecrawl_key", "disabled"):
        await db[SRC_COL].update_one({"id": src_id}, {"$set": patch})
        return
    if err:
        patch["last_error_at"] = now
        await db[SRC_COL].update_one({"id": src_id}, {"$set": patch, "$inc": {"consecutive_failures": 1}})
    else:
        patch["last_success"] = now
        patch["consecutive_failures"] = 0
        await db[SRC_COL].update_one({"id": src_id}, {"$set": patch})


async def run_all_sources(db, settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    summary = {"ran": 0, "ok": 0, "failed": 0}
    if db is None:
        return summary
    cur = db[SRC_COL].find({"enabled": True})
    async for src in cur:
        summary["ran"] += 1
        try:
            stats = await ingest_one(db, src, test=False)
            await update_source_health(db, src["id"], stats)
            if stats.get("error") in ("missing_api_key", "missing_firecrawl_key", "disabled"):
                pass
            elif stats.get("error"):
                summary["failed"] += 1
                await record_error(
                    source="market_intel",
                    message=f"source {src.get('name') or src.get('id')}: {stats.get('error')}",
                    kind=str(stats.get("error") or "fetch"),
                    path=f"/market-intel/source/{src.get('id')}",
                )
            else:
                summary["ok"] += 1
        except Exception as e:
            summary["failed"] += 1
            logger.warning("mi source %s failed: %s", src.get("id"), redact(e))
            try:
                await update_source_health(db, src.get("id"), {"error": redact(e)[:200]})
            except Exception:
                pass
    try:
        await cleanup_old(db, settings or {})
    except Exception as e:
        logger.warning("mi cleanup: %s", redact(e))
    return summary


async def cleanup_old(db, settings: Dict[str, Any]) -> Dict[str, Any]:
    ret = int(settings.get("market_intel_retention_days") or DEFAULT_RETENTION_DAYS)
    mn = int(settings.get("market_intel_min_history_days") or DEFAULT_MIN_HISTORY_DAYS)
    cut = retention_cutoff(ist_today(), ret, mn)
    cut_s = cut.isoformat()
    q = {"published_at": {"$lt": cut_s}}
    # also drop rows whose published_at is ISO datetime before cutoff date
    n = 0
    if db is None:
        return {"deleted": 0, "cutoff": cut_s}
    cursor = db[ART_COL].find({}, {"_id": 1, "published_at": 1, "discovered_at": 1})
    ids = []
    async for row in cursor:
        raw = str(row.get("published_at") or row.get("discovered_at") or "")[:10]
        try:
            d = date.fromisoformat(raw)
        except ValueError:
            continue
        if d < cut:
            ids.append(row["_id"])
        if len(ids) >= 500:
            res = await db[ART_COL].delete_many({"_id": {"$in": ids}})
            n += res.deleted_count
            ids = []
    if ids:
        res = await db[ART_COL].delete_many({"_id": {"$in": ids}})
        n += res.deleted_count
    remaining = await db[ART_COL].count_documents({})
    logger.info("mi cleanup deleted=%s remaining=%s cutoff=%s", n, remaining, cut_s)
    return {"deleted": n, "remaining": remaining, "cutoff": cut_s, "retention_days": ret}


def passes_filter(doc: Dict[str, Any], filt: str) -> bool:
    f = (filt or "all").lower()
    et = str(doc.get("event_type") or "")
    band = str(doc.get("impact_band") or "")
    if f in ("", "all"):
        return True
    if f == "breaking":
        return int(doc.get("impact_score") or 0) >= 90
    if f == "critical":
        return band == "CRITICAL"
    if f == "high":
        return band in ("CRITICAL", "HIGH")
    if f == "india":
        return int(doc.get("india_relevance_score") or 0) >= 60 or et == "india_macro"
    if f == "macro":
        return et in ("macro", "india_macro")
    if f == "rbi":
        return et == "india_macro" or "rbi" in _blob(doc.get("title"))
    if f == "fed":
        return "fed" in _blob(doc.get("title"), doc.get("summary")) or et == "macro"
    if f == "oil":
        return et == "oil"
    if f == "geopolitics":
        return et == "geopolitics"
    if f == "corporate":
        return et == "corporate"
    return True


def cluster_rows(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    bags: Dict[str, List[Dict[str, Any]]] = {}
    for d in docs:
        bags.setdefault(str(d.get("event_cluster_id") or d.get("id")), []).append(d)
    out = []
    for cid, rows in bags.items():
        rows.sort(key=lambda x: -int(x.get("impact_score") or 0))
        primary = dict(rows[0])
        primary["event_cluster_id"] = cid
        primary["source_count"] = len(rows)
        primary["sources"] = list({r.get("source_name") for r in rows if r.get("source_name")})
        out.append(primary)
    out.sort(key=rank_key)
    return out


async def feed_for_user(db, prefs: Dict[str, Any], filt: str = "all", limit: int = 40) -> List[Dict[str, Any]]:
    if db is None:
        return []
    docs = await db[ART_COL].find({"status": {"$ne": "gone"}}, {"_id": 0}).sort("discovered_at", -1).to_list(300)
    min_i = int(prefs.get("min_impact") or 0)
    min_in = int(prefs.get("min_india") or 0)
    show_mod = bool(prefs.get("show_moderate", False))
    show_high = bool(prefs.get("show_high", True))
    show_crit = bool(prefs.get("show_critical", True))
    cats = {str(c).lower() for c in (prefs.get("categories") or [])}
    all_cats = {"india", "macro", "fed", "oil", "geopolitics", "corporate"}
    cat_filter = bool(cats) and not all_cats.issubset(cats) and len(cats) < 6
    kept = []
    for d in docs:
        sc = int(d.get("impact_score") or 0)
        if sc < min_i:
            continue
        if int(d.get("india_relevance_score") or 0) < min_in:
            continue
        band = d.get("impact_band")
        if band == "CRITICAL" and not show_crit:
            continue
        if band == "HIGH" and not show_high:
            continue
        if band == "MODERATE" and not show_mod:
            continue
        if band in ("LOW", "NOISE") and not show_mod:
            continue
        if not passes_filter(d, filt):
            continue
        if not is_ist_today_item(d):
            continue
        if cat_filter:
            et = str(d.get("event_type") or "")
            ok = (
                ("india" in cats and (et == "india_macro" or int(d.get("india_relevance_score") or 0) >= 60))
                or ("macro" in cats and et in ("macro", "india_macro"))
                or ("fed" in cats and "fed" in _blob(d.get("title"), d.get("summary")))
                or ("oil" in cats and et == "oil")
                or ("geopolitics" in cats and et == "geopolitics")
                or ("corporate" in cats and et == "corporate")
            )
            if not ok:
                continue
        kept.append(d)
    return cluster_rows(kept)[:limit]


async def popup_candidates(
    db, user_id: str, prefs: Dict[str, Any], global_on: bool, *, is_admin: bool = False
) -> List[Dict[str, Any]]:
    if not popup_allowed(global_on, prefs, is_admin=is_admin):
        return []
    p = {
        **(prefs or {}),
        "min_impact": 0,
        "min_india": 0,
        "show_critical": True,
        "show_high": True,
        "show_moderate": False,
    }
    rows = await feed_for_user(db, p, "all", 80)
    crit = [
        r for r in rows
        if str(r.get("impact_band") or "") == "CRITICAL" or int(r.get("impact_score") or 0) >= 90
    ]
    return crit[:12]


async def mark_popup_shown(db, user_id: str, cluster_id: str) -> None:
    await db[SEEN_COL].update_one(
        {"user_id": user_id, "event_cluster_id": cluster_id},
        {"$set": {"user_id": user_id, "event_cluster_id": cluster_id, "shown_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


def new_source_id() -> str:
    return uuid.uuid4().hex[:12]


async def ingest_loop(get_db, get_settings, stop_event) -> None:
    """Pull and store news on the admin interval. Page/popup ticks never stop this."""
    import asyncio
    await asyncio.sleep(BOOT_DELAY_S)
    while not stop_event.is_set():
        db = get_db()
        settings = get_settings() or {}
        interval = int(settings.get("market_intel_ingest_seconds") or DEFAULT_INGEST_S)
        interval = max(60, min(3600, interval))
        try:
            if db is not None:
                await ensure_default_sources(db)
                await run_all_sources(db, settings)
        except Exception as e:
            logger.warning("mi loop: %s", redact(e))
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            raise
