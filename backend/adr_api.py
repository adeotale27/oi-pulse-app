"""HTTP routes for the ADR desk page and admin universe."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict


class PrefsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: Optional[bool] = None
    poll_interval_seconds: Optional[int] = None
    us_open: Optional[str] = None
    us_close: Optional[str] = None
    indian_open_refresh: Optional[bool] = None
    indian_open_refresh_ist: Optional[str] = None
    large_move_threshold_percent: Optional[float] = None
    banking_move_threshold_percent: Optional[float] = None
    notifications_enabled: Optional[bool] = None
    market_intelligence_enabled: Optional[bool] = None
    api_key: Optional[str] = None
    clear_key: Optional[bool] = None
    discover: Optional[bool] = None


class UniverseIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    company_name: str = ""
    indian_symbol: str = ""
    adr_symbol: str = ""
    exchange: str = "NYSE"
    sector: str = "OTHER"
    adr_ratio: str = "1:1"
    currency: str = "USD"
    provider_symbol: Optional[str] = None
    enabled: bool = True
    market_intelligence_enabled: bool = True
    notification_enabled: bool = True
    large_move_threshold_percent: Optional[float] = None
    priority: int = 50


def mount(api_router, *, require_admin, require_desk_user):
    import adr as adr_mod

    def _db():
        import server
        return server.db

    @api_router.get("/adrs")
    async def adrs_snapshot(_user: str = Depends(require_desk_user)):
        db = _db()
        await adr_mod.seed_universe(db)
        snap = await adr_mod.desk_snapshot(db)
        # Never leak vault fields
        prefs = snap.get("prefs") or {}
        for k in list(prefs):
            if "key" in k.lower() or "token" in k.lower() or k.endswith("_enc"):
                prefs.pop(k, None)
        snap["prefs"] = prefs
        return snap

    @api_router.get("/adrs/history/{adr_id}")
    async def adrs_history(adr_id: str, range: str = "1D", _user: str = Depends(require_desk_user)):
        docs = await adr_mod.history(_db(), adr_id, range)
        return {"items": docs, "range": range}

    @api_router.get("/adrs/config")
    async def adrs_config_get(_admin: bool = Depends(require_admin)):
        pub = adr_mod.public_prefs(await adr_mod.load_prefs(_db()))
        items = await adr_mod.list_universe(_db())
        return {"prefs": pub, "items": items, "seed": adr_mod.SEED_ADRS}

    @api_router.post("/adrs/config")
    async def adrs_config_set(payload: PrefsIn, _admin: bool = Depends(require_admin)):
        patch = payload.model_dump(exclude_none=True)
        if "poll_interval_seconds" in patch:
            n = int(patch["poll_interval_seconds"])
            if n < 60 or n > 3600:
                raise HTTPException(400, "poll_interval_seconds must be 60–3600")
            patch["poll_interval_seconds"] = n
        discover = bool(patch.pop("discover", False))
        pub = await adr_mod.save_prefs(_db(), patch)
        if discover:
            key = adr_mod._api_key_from_doc(await adr_mod.load_prefs(_db()))
            added = await adr_mod.discover_and_seed(_db(), key)
            pub["discovered"] = added
        return {"prefs": pub}

    @api_router.post("/adrs/items")
    async def adrs_item_upsert(payload: UniverseIn, _admin: bool = Depends(require_admin)):
        try:
            doc = await adr_mod.upsert_universe_row(_db(), payload.model_dump())
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"item": doc}

    @api_router.post("/adrs/items/{uid}/toggle")
    async def adrs_item_toggle(uid: str, _admin: bool = Depends(require_admin)):
        db = _db()
        row = await db[adr_mod.UNIVERSE_COL].find_one({"id": uid}, {"_id": 0})
        if not row:
            raise HTTPException(404, "ADR not found")
        row["enabled"] = not bool(row.get("enabled", True))
        await db[adr_mod.UNIVERSE_COL].update_one({"id": uid}, {"$set": {"enabled": row["enabled"]}})
        return {"item": row}

    @api_router.delete("/adrs/items/{uid}")
    async def adrs_item_delete(uid: str, _admin: bool = Depends(require_admin)):
        await adr_mod.delete_universe_row(_db(), uid)
        return {"ok": True}

    @api_router.post("/adrs/test")
    async def adrs_test(_admin: bool = Depends(require_admin)):
        key = adr_mod._api_key_from_doc(await adr_mod.load_prefs(_db()))
        return await adr_mod.test_connection(key)

    @api_router.post("/adrs/poll")
    async def adrs_poll(_admin: bool = Depends(require_admin)):
        return await adr_mod.poll_once(_db(), reason="manual")
