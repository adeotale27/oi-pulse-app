"""HTTP routes for Desk AI keys and Market Intelligence."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict


class ProviderIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    name: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    select: Optional[bool] = None
    clear_key: Optional[bool] = None


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    name: str = "Source"
    source_type: str = "RSS"
    endpoint: Optional[str] = None
    url: Optional[str] = None
    method: str = "GET"
    query: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, str]] = None
    auth: str = "none"
    auth_key: Optional[str] = None
    auth_header: Optional[str] = None
    mapping: Optional[Dict[str, str]] = None
    api_key: Optional[str] = None
    enabled: bool = True
    priority: int = 50
    max_items: int = 30
    fetch_frequency_seconds: Optional[int] = None
    category: Optional[str] = None
    region: Optional[str] = None


class AckIn(BaseModel):
    event_cluster_id: str = ""


class PrefsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    page_enabled: Optional[bool] = None
    popup_enabled: Optional[bool] = None
    popup_min_impact: Optional[int] = None
    popup_min_india: Optional[int] = None
    show_critical: Optional[bool] = None
    show_high: Optional[bool] = None
    show_moderate: Optional[bool] = None
    categories: Optional[list] = None
    ui_poll_seconds: Optional[int] = None
    min_impact: Optional[int] = None
    min_india: Optional[int] = None


def mount(api_router, *, require_admin, require_desk_user):
    import desk_llm
    import market_intel as mi
    from desk_llm import encrypt_secret

    def _db():
        import server
        return server.db

    def _settings():
        import server
        tr = getattr(server, "tracker", None)
        if tr and isinstance(getattr(tr, "settings", None), dict):
            return tr.settings
        return {}

    async def _prefs(user_id: str) -> Dict[str, Any]:
        db = _db()
        base = mi.default_user_prefs()
        if db is None:
            return {**base, "user_id": user_id}
        doc = await db[mi.PREF_COL].find_one({"user_id": user_id}, {"_id": 0}) or {}
        return {**base, **doc, "user_id": user_id}

    @api_router.get("/desk-ai/providers")
    async def desk_ai_providers(_admin: bool = Depends(require_admin)):
        rows = await desk_llm.list_providers(_db())
        return {"providers": rows, "env_fallback": bool(desk_llm.env_llm().get("api_key"))}

    @api_router.post("/desk-ai/providers")
    async def desk_ai_provider_save(payload: ProviderIn, _admin: bool = Depends(require_admin)):
        try:
            row = await desk_llm.upsert_provider(_db(), payload.model_dump())
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True, "provider": row}

    @api_router.post("/desk-ai/providers/{provider_id}/select")
    async def desk_ai_provider_select(provider_id: str, _admin: bool = Depends(require_admin)):
        try:
            await desk_llm.set_active(_db(), provider_id)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True, "providers": await desk_llm.list_providers(_db())}

    @api_router.delete("/desk-ai/providers/{provider_id}")
    async def desk_ai_provider_delete(provider_id: str, _admin: bool = Depends(require_admin)):
        await desk_llm.delete_provider(_db(), provider_id)
        return {"ok": True, "providers": await desk_llm.list_providers(_db())}

    @api_router.get("/market-intel/templates")
    async def mi_templates(_admin: bool = Depends(require_admin)):
        return {"apis": mi.PUBLIC_API_CATALOG, "rss": mi.RSS_TEMPLATES, "types": list(mi.SOURCE_TYPES)}

    @api_router.get("/market-intel/sources")
    async def mi_sources(_admin: bool = Depends(require_admin)):
        db = _db()
        if db is None:
            return {"sources": []}
        await mi.ensure_default_sources(db)
        rows = [mi.public_source(d) async for d in db[mi.SRC_COL].find({}, {"_id": 0})]
        for r in rows:
            r["status"] = mi.source_health_status(r)
        return {"sources": rows}

    @api_router.post("/market-intel/sources")
    async def mi_source_save(payload: SourceIn, _admin: bool = Depends(require_admin)):
        db = _db()
        st = str(payload.source_type or "RSS").upper()
        if st not in mi.SOURCE_TYPES:
            raise HTTPException(400, "source_type must be API, RSS, FIRECRAWL, or OFFICIAL_FEED")
        sid = payload.id or mi.new_source_id()
        prev = await db[mi.SRC_COL].find_one({"id": sid}) or {}
        doc = {
            **prev,
            "id": sid,
            "name": payload.name[:80],
            "source_type": st,
            "endpoint": (payload.endpoint or payload.url or "").strip(),
            "method": (payload.method or "GET").upper(),
            "query": payload.query or {},
            "headers": payload.headers or {},
            "auth": payload.auth or "none",
            "auth_key": payload.auth_key,
            "auth_header": payload.auth_header,
            "mapping": payload.mapping or {},
            "enabled": bool(payload.enabled),
            "priority": int(payload.priority or 50),
            "max_items": max(1, min(80, int(payload.max_items or 30))),
            "category": payload.category,
            "region": payload.region,
        }
        if payload.api_key:
            doc["api_key_enc"] = encrypt_secret(payload.api_key)
            if st != "FIRECRAWL" and (payload.auth or "none") == "none":
                doc["auth"] = "bearer"
        doc.pop("api_key", None)
        await db[mi.SRC_COL].update_one({"id": sid}, {"$set": doc}, upsert=True)
        saved = await db[mi.SRC_COL].find_one({"id": sid}, {"_id": 0})
        return {"ok": True, "source": mi.public_source(saved)}

    @api_router.delete("/market-intel/sources/{source_id}")
    async def mi_source_delete(source_id: str, _admin: bool = Depends(require_admin)):
        await _db()[mi.SRC_COL].delete_one({"id": source_id})
        return {"ok": True}

    @api_router.post("/market-intel/sources/{source_id}/test")
    async def mi_source_test(source_id: str, _admin: bool = Depends(require_admin)):
        src = await _db()[mi.SRC_COL].find_one({"id": source_id})
        if not src:
            raise HTTPException(404, "Unknown source")
        stats = await mi.ingest_one(_db(), src, test=True)
        return {"ok": not stats.get("error"), **stats}

    @api_router.post("/market-intel/sources/{source_id}/fetch")
    async def mi_source_fetch(source_id: str, _admin: bool = Depends(require_admin)):
        src = await _db()[mi.SRC_COL].find_one({"id": source_id})
        if not src:
            raise HTTPException(404, "Unknown source")
        stats = await mi.ingest_one(_db(), src, test=False)
        await mi.update_source_health(_db(), source_id, stats)
        return {"ok": not stats.get("error"), **{k: stats[k] for k in stats if k != "preview"}}

    @api_router.post("/market-intel/cleanup")
    async def mi_cleanup(_admin: bool = Depends(require_admin)):
        try:
            result = await mi.cleanup_old(_db(), _settings())
            return {"ok": True, **result}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200], "deleted": 0}

    @api_router.get("/market-intel/stats")
    async def mi_stats(_admin: bool = Depends(require_admin)):
        db = _db()
        s = _settings()
        stored = await db[mi.ART_COL].count_documents({}) if db is not None else 0
        ret = int(s.get("market_intel_retention_days") or mi.DEFAULT_RETENTION_DAYS)
        mn = int(s.get("market_intel_min_history_days") or mi.DEFAULT_MIN_HISTORY_DAYS)
        cut = mi.retention_cutoff(mi.ist_today(), ret, mn)
        return {
            "stored": stored,
            "retention_days": ret,
            "min_history_days": mn,
            "cutoff": cut.isoformat(),
            "collection": mi.ART_COL,
        }

    @api_router.get("/market-intel/prefs")
    async def mi_prefs_get(request: Request, role: str = Depends(require_desk_user)):
        from server import _ledger_owner
        uid = await _ledger_owner(request, role)
        return {"prefs": await _prefs(uid)}

    @api_router.post("/market-intel/prefs")
    async def mi_prefs_save(payload: PrefsIn, request: Request, role: str = Depends(require_desk_user)):
        from server import _ledger_owner
        uid = await _ledger_owner(request, role)
        patch = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "ui_poll_seconds" in patch:
            patch["ui_poll_seconds"] = max(60, min(1800, int(patch["ui_poll_seconds"])))
        if "popup_min_impact" in patch:
            patch["popup_min_impact"] = max(50, min(100, int(patch["popup_min_impact"])))
        if "popup_min_india" in patch:
            patch["popup_min_india"] = max(0, min(100, int(patch["popup_min_india"])))
        cur = await _prefs(uid)
        cur.update(patch)
        cur["user_id"] = uid
        await _db()[mi.PREF_COL].update_one({"user_id": uid}, {"$set": cur}, upsert=True)
        return {"ok": True, "prefs": cur}

    @api_router.get("/market-intel")
    async def mi_feed(
        request: Request,
        role: str = Depends(require_desk_user),
        filt: str = Query("all", alias="filter"),
        feed_date: Optional[str] = Query(None, alias="date"),
    ):
        from server import _ledger_owner
        uid = await _ledger_owner(request, role)
        prefs = await _prefs(uid)
        try:
            mi.parse_feed_date(feed_date)
        except ValueError as e:
            raise HTTPException(400, str(e))
        try:
            items = await mi.feed_for_user(_db(), prefs, filt, 40, date_str=feed_date)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            logger = __import__("logging").getLogger("market_intel")
            logger.exception("market-intel feed failed")
            try:
                from error_log import record_error
                await record_error(
                    source="api",
                    message=str(e)[:300],
                    path="/api/market-intel",
                    kind=type(e).__name__,
                )
            except Exception:
                pass
            raise HTTPException(500, "Market intelligence feed failed")
        for it in items:
            if isinstance(it, dict):
                it.pop("_id", None)
        return {"items": items, "date": (mi.parse_feed_date(feed_date) or mi.ist_today()).isoformat()}

    @api_router.get("/market-intel/popup")
    async def mi_popup(request: Request, role: str = Depends(require_desk_user)):
        from server import _ledger_owner
        uid = await _ledger_owner(request, role)
        prefs = await _prefs(uid)
        s = _settings()
        global_on = s.get("market_intel_popup_enabled", True) is not False
        items = await mi.popup_candidates(
            _db(), uid, prefs, global_on, is_admin=(role == "admin")
        )
        keys = (
            "title", "impact_score", "india_relevance_score", "event_type",
            "summary", "potential", "event_cluster_id", "source_name", "impact_band",
            "published_at",
        )
        return {
            "items": [{k: it.get(k) for k in keys} for it in items],
            "critical_count": len(items),
            "day": mi.ist_today().isoformat(),
            "dock_until_next": s.get("market_intel_popup_dock_until_next", True) is not False,
        }

    @api_router.post("/market-intel/popup/ack")
    async def mi_popup_ack(payload: AckIn, request: Request, role: str = Depends(require_desk_user)):
        from server import _ledger_owner
        uid = await _ledger_owner(request, role)
        cid = str(payload.event_cluster_id or "")
        if cid:
            await mi.mark_popup_shown(_db(), uid, cid)
        return {"ok": True}
    @api_router.get("/market-intel/config")
    async def mi_config_get(request: Request, role: str = Depends(require_desk_user)):
        s = _settings()
        # Use market_intel_retention_days as max_days_back, fallback to 5
        max_days_back = s.get("market_intel_retention_days") or 5
        config = {
            "max_days_back": int(max_days_back),
            # Optionally include other settings
            "popup_enabled": s.get("market_intel_popup_enabled", True) is not False,
            "popup_dock_until_next": s.get("market_intel_popup_dock_until_next", True) is not False,
            "ingest_seconds": s.get("market_intel_ingest_seconds") or 300,
            "retention_days": s.get("market_intel_retention_days") or 5,
            "min_history_days": s.get("market_intel_min_history_days") or 2,
        }
        return {"config": config}

    return api_router
