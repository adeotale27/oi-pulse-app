"""Live external API inventory derived from the running StrikLenz source tree."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
IST = ZoneInfo("Asia/Kolkata")
URL_RE = re.compile(r"https?://[^\s\"'<>]+")

HOSTS = {
    "api.twelvedata.com": ("twelve-data", "Twelve Data", "Market Data", "API key"),
    "financialmodelingprep.com": ("financial-modeling-prep", "Financial Modeling Prep", "Market Data", "API key"),
    "www.nseindia.com": ("nse-india", "NSE India", "Market Data", "Public session"),
    "api.kite.trade": ("kite-connect", "Kite Connect", "Broker / Market Data", "API key + access token"),
    "api.telegram.org": ("telegram", "Telegram Bot API", "Notifications", "Bot token"),
    "query1.finance.yahoo.com": ("yahoo-finance", "Yahoo Finance", "Market Data", "Public"),
    "finance.yahoo.com": ("yahoo-finance", "Yahoo Finance", "Market Data", "Public"),
    "gnews.io": ("gnews", "GNews", "News", "API key"),
    "finnhub.io": ("finnhub", "Finnhub", "News", "API key"),
    "newsapi.org": ("newsapi", "NewsAPI", "News", "API key"),
    "www.alphavantage.co": ("alpha-vantage", "Alpha Vantage", "News", "API key"),
    "api.firecrawl.dev": ("firecrawl", "Firecrawl", "News", "API key"),
    "news.google.com": ("google-news", "Google News RSS", "News", "Public RSS"),
    "economictimes.indiatimes.com": ("economic-times", "Economic Times RSS", "News", "Public RSS"),
    "feeds.bbci.co.uk": ("bbc", "BBC Business RSS", "News", "Public RSS"),
    "www.livemint.com": ("mint", "Mint Markets RSS", "News", "Public RSS"),
    "www.thehindubusinessline.com": ("business-line", "Business Line RSS", "News", "Public RSS"),
    "www.moneycontrol.com": ("moneycontrol", "Moneycontrol RSS", "News", "Public RSS"),
    "api.ipify.org": ("ipify", "ipify", "Network", "Public"),
    "ifconfig.me": ("ifconfig", "ifconfig.me", "Network", "Public"),
    "icanhazip.com": ("icanhazip", "icanhazip.com", "Network", "Public"),
    "zerodha.com": ("zerodha", "Zerodha", "Broker", "Public"),
    "kite.zerodha.com": ("kite-login", "Kite Login", "Authentication", "API key"),
    "api.openai.com": ("openai", "OpenAI", "AI", "API key"),
    "api.deepseek.com": ("deepseek", "DeepSeek", "AI", "API key"),
    "api.x.ai": ("xai", "xAI Grok", "AI", "API key"),
    "api.groq.com": ("groq", "Groq", "AI", "API key"),
    "openrouter.ai": ("openrouter", "OpenRouter", "AI", "API key"),
}

MODULE_HINTS = {
    "adr.py": ("ADR Monitor", "Fetch Indian ADR quotes, listings and history for the ADR desk."),
    "global_markets.py": ("Global Markets", "Fetch the enabled global indices, FX, commodities, crypto and macro instruments."),
    "market_intel.py": ("Market Intel", "Ingest and rank market news used by Market Intelligence and carry context."),
    "desk_outside.py": ("Desk Outside", "Fetch market-news context and fallback constituent prices for the desk."),
    "fii_dii_service.py": ("FII / DII", "Fetch official FII and DII flows shown on the desk."),
    "cas_indicative_nse.py": ("CAS Indicative", "Read NSE indicative close data during the closing auction window."),
    "cas_bridge.py": ("CAS Auto Trade", "Resolve the server public IP for Kite Connect whitelisting."),
    "notifier.py": ("Notifications", "Deliver configured StrikLenz alerts to Telegram."),
    "kite_maintenance.py": ("Kite Maintenance", "Read Zerodha maintenance bulletins for desk availability."),
    "desk_llm.py": ("Desk AI", "Configure the optional AI provider used by Desk AI."),
    "desk_guide.py": ("Desk AI", "Generate the optional Desk AI market guide."),
}


def classify_external_url(raw_url: str) -> Optional[Dict[str, str]]:
    try:
        parsed = urlparse(str(raw_url or ""))
    except Exception:
        return None
    host = (parsed.netloc or "").lower().split(":", 1)[0]
    meta = HOSTS.get(host)
    if not meta:
        return None
    provider_id, provider, category, auth = meta
    return {
        "provider_id": provider_id,
        "provider": provider,
        "category": category,
        "auth": auth,
        "endpoint": parsed.path or "/",
        "host": host,
    }


def _clean_url(raw: str) -> str:
    return raw.rstrip(".,);]}")


def _source_rows() -> Iterable[Dict[str, Any]]:
    for path in ROOT.glob("*.py"):
        if path.name.startswith("test_") or path.name in {"server.py"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        module, purpose = MODULE_HINTS.get(path.name, (path.stem.replace("_", " ").title(), "External service used by this backend module."))
        for raw in URL_RE.findall(text):
            url = _clean_url(raw)
            hit = classify_external_url(url)
            if not hit:
                continue
            yield {
                **hit,
                "method": "POST" if hit["endpoint"] == "/v1/scrape" else "GET",
                "module": module,
                "purpose": purpose,
                "code_references": [f"backend/{path.name}"],
                "enabled": True,
            }


def _kite_rows() -> Iterable[Dict[str, Any]]:
    """Read the installed Kite SDK route table, then retain only methods used here."""
    try:
        from kiteconnect import KiteConnect
        routes = KiteConnect(api_key="registry")._routes
    except Exception:
        return []
    uses = [
        ("market.instruments.all", "GET", "OI Pulse", "Load the instrument master to resolve option-chain tokens.", "backend/oi_service.py"),
        ("market.quote", "GET", "OI Pulse", "Fetch live OI, LTP and index quotes for the OI desk.", "backend/oi_service.py"),
        ("portfolio.positions", "GET", "Positions", "Fetch the live broker book and P&L for Positions and its risk panels.", "backend/server.py"),
        ("api.token", "POST", "Kite Authentication", "Exchange the Kite request token for the daily access token.", "backend/server.py"),
        ("order.place", "POST", "CAS Auto Trade", "Place the configured CAS auto-trade order when that workflow is armed.", "backend/cas_rule_expiry_automation/kite_client.py"),
        ("market.historical", "GET", "CAS Auto Trade", "Read historical candles for the CAS rule/backtest workflow.", "backend/cas_rule_expiry_automation/kite_client.py"),
    ]
    out = []
    for route_key, method, module, purpose, ref in uses:
        endpoint = routes.get(route_key)
        if endpoint:
            out.append({
                "provider_id": "kite-connect", "provider": "Kite Connect", "category": "Broker / Market Data",
                "auth": "API key + access token", "host": "api.kite.trade", "endpoint": endpoint,
                "method": method, "module": module, "purpose": purpose, "code_references": [ref], "enabled": True,
            })
    return out


async def _configured_market_intel_rows(db) -> List[Dict[str, Any]]:
    """Include live admin-configured/custom news sources, not only bundled templates."""
    if db is None:
        return []
    try:
        docs = await db.mi_sources.find({}, {"_id": 0, "api_key_enc": 0, "bearer_enc": 0, "headers_secret": 0}).to_list(length=200)
    except Exception:
        return []
    rows = []
    for doc in docs:
        url = str(doc.get("endpoint") or doc.get("url") or "").strip()
        hit = classify_external_url(url)
        if not hit:
            parsed = urlparse(url)
            host = (parsed.netloc or "").lower()
            if not host:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", host).strip("-")[:48]
            hit = {"provider_id": f"market-intel-{slug}", "provider": str(doc.get("name") or host)[:90], "category": "News", "auth": "Configured secret" if doc.get("api_key_enc") or doc.get("bearer_enc") else "Public", "host": host, "endpoint": parsed.path or "/"}
        rows.append({
            **hit,
            "method": str(doc.get("method") or "GET").upper(),
            "module": "Market Intel",
            "purpose": "Fetch the configured news/feed source for Market Intelligence and carry context.",
            "code_references": ["backend/market_intel.py"],
            "enabled": bool(doc.get("enabled")),
        })
    return rows


def _merge_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        key = (row["provider_id"], row["endpoint"], row.get("method", "GET"))
        if key not in merged:
            merged[key] = {**row, "modules": [row["module"]], "purposes": [row["purpose"]]}
            continue
        cur = merged[key]
        for name in ("module",):
            if row[name] not in cur["modules"]:
                cur["modules"].append(row[name])
        if row["purpose"] not in cur["purposes"]:
            cur["purposes"].append(row["purpose"])
        cur["code_references"] = sorted(set(cur["code_references"] + row["code_references"]))
    return sorted(merged.values(), key=lambda r: (r["provider"], r["endpoint"], r["method"]))


async def _telemetry(db, rows: List[Dict[str, Any]]) -> Dict[tuple, Dict[str, Any]]:
    if db is None:
        return {}
    start = datetime.combine(datetime.now(IST).date(), time.min, tzinfo=IST).astimezone(timezone.utc).isoformat()
    telemetry = db.external_api_telemetry
    stats: Dict[tuple, Dict[str, Any]] = {}
    try:
        pipeline = [
            {"$match": {"ts": {"$gte": start}}},
            {"$group": {
                "_id": {"provider_id": "$provider_id", "endpoint": "$endpoint"},
                "requests_today": {"$sum": 1},
                "errors_today": {"$sum": {"$cond": [{"$eq": ["$ok", False]}, 1, 0]}},
                "latency_total": {"$sum": {"$ifNull": ["$latency_ms", 0]}},
                "last_request": {"$max": "$ts"},
                "last_success": {"$max": {"$cond": [{"$eq": ["$ok", True]}, "$ts", None]}},
                "last_error": {"$max": {"$cond": [{"$eq": ["$ok", False]}, "$ts", None]}},
            }},
        ]
        grouped = await telemetry.aggregate(pipeline).to_list(length=max(len(rows) * 2, 100))
        for item in grouped:
            key = (item.get("_id", {}).get("provider_id"), item.get("_id", {}).get("endpoint"))
            count = int(item.get("requests_today") or 0)
            stats[key] = {
                "requests_today": count,
                "errors_today": int(item.get("errors_today") or 0),
                "avg_latency_ms": round(float(item.get("latency_total") or 0) / count) if count else None,
                "last_request": item.get("last_request"),
                "last_success": item.get("last_success"),
                "last_error": item.get("last_error"),
            }
    except (AttributeError, TypeError):
        # Keep compatibility with lightweight test doubles and older Mongo clients.
        docs = await telemetry.find({"ts": {"$gte": start}}, {"_id": 0}).sort("ts", -1).to_list(length=20_000)
        for doc in docs:
            key = (doc.get("provider_id"), doc.get("endpoint"))
            entry = stats.setdefault(key, {
                "requests_today": 0, "errors_today": 0, "latency_total": 0,
                "last_request": None, "last_success": None, "last_error": None,
            })
            entry["requests_today"] += 1
            entry["errors_today"] += int(not doc.get("ok"))
            entry["latency_total"] += float(doc.get("latency_ms") or 0)
            entry["last_request"] = entry["last_request"] or doc.get("ts")
            if doc.get("ok") and entry["last_success"] is None:
                entry["last_success"] = doc.get("ts")
            if not doc.get("ok") and entry["last_error"] is None:
                entry["last_error"] = doc.get("ts")
        for entry in stats.values():
            count = entry.pop("requests_today")
            entry["requests_today"] = count
            entry["avg_latency_ms"] = round(entry.pop("latency_total") / count) if count else None

    recent: Dict[tuple, List[dict]] = defaultdict(list)
    # The detail view only renders the latest 12 samples per endpoint. Keep
    # this bounded to avoid transferring thousands of unrelated telemetry rows.
    recent_limit = max(len(rows) * 4, 120)
    try:
        recent_docs = await telemetry.find(
            {"ts": {"$gte": start}},
            {"_id": 0},
        ).sort("ts", -1).to_list(length=recent_limit)
    except (AttributeError, TypeError):
        recent_docs = []
    for doc in recent_docs:
        key = (doc.get("provider_id"), doc.get("endpoint"))
        if len(recent[key]) < 12:
            recent[key].append(doc)

    out: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        key = (row["provider_id"], row["endpoint"])
        aggregate = stats.get(key)
        samples = recent.get(key, [])
        requests = int(aggregate.get("requests_today") or 0) if aggregate else 0
        errors = int(aggregate.get("errors_today") or 0) if aggregate else 0
        latency = aggregate.get("avg_latency_ms") if aggregate else None
        if not requests:
            status = "unknown"
        elif errors >= 3 or (errors / requests) >= 0.2:
            status = "failed"
        elif errors or (latency is not None and latency > 1500):
            status = "warning"
        else:
            status = "healthy"
        out[(row["provider_id"], row["endpoint"], row["method"])] = {
            "requests_today": requests, "errors_today": errors, "avg_latency_ms": latency,
            "status": status, "last_request": aggregate.get("last_request") if aggregate else None,
            "last_success": aggregate.get("last_success") if aggregate else None,
            "last_error": aggregate.get("last_error") if aggregate else None,
            "recent_requests": samples[:12],
        }
    return out


async def build_registry(db) -> Dict[str, Any]:
    rows = _merge_rows([*_source_rows(), *_kite_rows(), *(await _configured_market_intel_rows(db))])
    metrics = await _telemetry(db, rows)
    for row in rows:
        row.update(metrics.get((row["provider_id"], row["endpoint"], row["method"]), {
            "requests_today": 0, "errors_today": 0, "avg_latency_ms": None, "status": "unknown",
            "last_request": None, "last_success": None, "last_error": None, "recent_requests": [],
        }))
    providers: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        provider = providers.setdefault(row["provider_id"], {
            "id": row["provider_id"], "name": row["provider"], "category": row["category"], "auth": row["auth"],
            "host": row["host"], "endpoints": [], "modules": [], "code_references": [],
        })
        provider["endpoints"].append(row)
        provider["modules"] = sorted(set(provider["modules"] + row["modules"]))
        provider["code_references"] = sorted(set(provider["code_references"] + row["code_references"]))
    for provider in providers.values():
        endpoints = provider["endpoints"]
        provider["requests_today"] = sum(x["requests_today"] for x in endpoints)
        provider["errors_today"] = sum(x["errors_today"] for x in endpoints)
        live = [x for x in endpoints if x["avg_latency_ms"] is not None]
        provider["avg_latency_ms"] = round(sum(x["avg_latency_ms"] for x in live) / len(live)) if live else None
        states = {x["status"] for x in endpoints}
        provider["status"] = "failed" if "failed" in states else "warning" if "warning" in states else "healthy" if "healthy" in states else "unknown"
    endpoint_metrics = rows
    summary = {
        "providers": len(providers), "endpoints": len(rows),
        "modules": len({m for row in rows for m in row["modules"]}),
        "active": len(providers), "healthy": sum(p["status"] == "healthy" for p in providers.values()),
        "warning": sum(p["status"] == "warning" for p in providers.values()), "failed": sum(p["status"] == "failed" for p in providers.values()),
        "requests_today": sum(x["requests_today"] for x in endpoint_metrics), "errors_today": sum(x["errors_today"] for x in endpoint_metrics),
    }
    latencies = [x["avg_latency_ms"] for x in endpoint_metrics if x["avg_latency_ms"] is not None]
    summary["avg_latency_ms"] = round(sum(latencies) / len(latencies)) if latencies else None
    return {"summary": summary, "providers": sorted(providers.values(), key=lambda p: p["name"]), "endpoints": rows, "generated_at": datetime.now(timezone.utc).isoformat()}
