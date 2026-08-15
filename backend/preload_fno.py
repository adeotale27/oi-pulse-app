"""
Optional CLI to fill Index-management search cache from Kite.

The live desk does **not** auto-dump after token save. Search / Sync in
Index management loads underlyings on demand.

    cd backend && python preload_fno.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent))


async def main() -> int:
    from oi_tracker import OITracker

    mongo = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or "oi_pulse"
    if not mongo:
        print("MONGO_URL missing", file=sys.stderr)
        return 1

    client = AsyncIOMotorClient(mongo)
    db = client[db_name]
    tracker = OITracker(db)
    await tracker.load_credentials()
    n = await tracker.preload_fno_dump(force=True)
    if not tracker.kite_service:
        cached = await db.kite_underlyings.count_documents({})
        print("No Kite credentials — cannot refresh dump. Cached underlyings:", cached)
        return 0 if cached else 2
    print(f"preloaded {n} F&O underlyings")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
