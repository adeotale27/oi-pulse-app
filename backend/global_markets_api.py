"""Global Markets routes.  Quotes are served from the centralized background cache."""
from fastapi import Depends
from pydantic import BaseModel


class InstrumentConfigIn(BaseModel):
    instruments: list[dict] = []
    fmp_api_key: str | None = None
    clear_fmp_key: bool = False
    enabled: bool | None = None


def mount(api_router, *, require_desk_user, require_admin):
    import global_markets

    def _db():
        import server
        return server.db

    @api_router.get("/global-markets/instruments")
    async def global_market_instruments(_user: str = Depends(require_desk_user)):
        return {"items": global_markets.instruments()}

    @api_router.get("/global-markets/config")
    async def global_market_config(_admin: bool = Depends(require_admin)):
        return {
            "items": await global_markets.configured_instruments(_db()),
            "prefs": global_markets.public_prefs(await global_markets.load_prefs(_db())),
        }

    @api_router.post("/global-markets/config")
    async def global_market_config_save(payload: InstrumentConfigIn, _admin: bool = Depends(require_admin)):
        import server
        prefs = await global_markets.save_prefs(
            _db(),
            {
                "fmp_api_key": payload.fmp_api_key,
                "clear_fmp_key": payload.clear_fmp_key,
                **({"enabled": payload.enabled} if payload.enabled is not None else {}),
            },
        )
        if payload.enabled is not None and getattr(server, "tracker", None) is not None:
            current = dict(getattr(server.tracker, "settings", {}) or {})
            public_pages = list(current.get("visible_pages") or [
                "oi-change", "open-interest", "strike-table", "buildup",
                "positions", "alerts", "activity", "holidays", "straddle",
                "index-events", "market-intel",
            ])
            admin_pages = list(current.get("admin_visible_pages") or [
                "oi-change", "open-interest", "strike-table", "sell-candidates",
                "buildup", "positions", "alerts", "activity", "holidays",
                "straddle", "index-events", "cas", "market-intel",
            ])
            if payload.enabled:
                if "adrs" not in public_pages:
                    public_pages.append("adrs")
                if "adrs" not in admin_pages:
                    admin_pages.append("adrs")
            else:
                public_pages = [page for page in public_pages if page != "adrs"]
                admin_pages = [page for page in admin_pages if page != "adrs"]
            await server.tracker.save_settings({
                "visible_pages": public_pages,
                "admin_visible_pages": admin_pages,
            })
        return {"items": await global_markets.save_instrument_config(_db(), payload.instruments), "prefs": prefs}

    @api_router.post("/global-markets/test")
    async def global_market_test(_admin: bool = Depends(require_admin)):
        if (await global_markets.load_prefs(_db())).get("enabled") is False:
            return {"ok": False, "error": "Global Markets is disabled; no provider request was made"}
        providers = await global_markets.enabled_provider_items(_db())
        if not providers["fmp"]:
            return {"ok": False, "error": "No enabled instruments are assigned to FMP; no provider request was made"}
        return await global_markets.test_fmp_connection(_db())

    @api_router.get("/global-markets/overview")
    async def global_market_overview(_user: str = Depends(require_desk_user)):
        return await global_markets.overview(_db())

    @api_router.get("/global-markets/status")
    async def global_market_status(_user: str = Depends(require_desk_user)):
        prefs = await global_markets.load_prefs(_db())
        return {"enabled": prefs.get("enabled") is not False}
