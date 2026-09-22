"""Global Markets routes.  Quotes are served from the centralized background cache."""
from fastapi import Depends


def mount(api_router, *, require_desk_user):
    import global_markets

    def _db():
        import server
        return server.db

    @api_router.get("/global-markets/instruments")
    async def global_market_instruments(_user: str = Depends(require_desk_user)):
        return {"items": global_markets.instruments()}

    @api_router.get("/global-markets/overview")
    async def global_market_overview(_user: str = Depends(require_desk_user)):
        return await global_markets.overview(_db())
