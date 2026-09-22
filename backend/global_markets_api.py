"""Global Markets routes.  Quotes are served from the centralized background cache."""
from fastapi import Depends
from pydantic import BaseModel


class InstrumentConfigIn(BaseModel):
    instruments: list[dict] = []


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
        return {"items": await global_markets.configured_instruments(_db())}

    @api_router.post("/global-markets/config")
    async def global_market_config_save(payload: InstrumentConfigIn, _admin: bool = Depends(require_admin)):
        return {"items": await global_markets.save_instrument_config(_db(), payload.instruments)}

    @api_router.get("/global-markets/overview")
    async def global_market_overview(_user: str = Depends(require_desk_user)):
        return await global_markets.overview(_db())
