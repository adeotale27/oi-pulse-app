"""Read-only Market Memory routes backed by the existing OI snapshot pipeline."""
from fastapi import Depends


def mount(api_router, *, require_desk_user):
    import market_memory

    def _db():
        import server
        return server.db

    @api_router.get("/market-memory/{index}")
    async def market_memory_overview(index: str, _user: str = Depends(require_desk_user)):
        return await market_memory.summary(_db(), index.upper())

    @api_router.get("/market-memory/{index}/levels")
    async def market_memory_levels(index: str, _user: str = Depends(require_desk_user)):
        return {"levels": (await market_memory.summary(_db(), index.upper()))["levels"]}

    @api_router.get("/market-memory/{index}/interactions")
    async def market_memory_interactions(index: str, _user: str = Depends(require_desk_user)):
        return {"interactions": (await market_memory.summary(_db(), index.upper()))["interactions"]}
