"""
Daily preload: Kite F&O instrument dump → `kite_underlyings` for Index management.

Run once per trading morning after the publisher token is live:

    cd backend && python preload_fno.py

Safe to re-run. Does not enable extra indices. The live tracker also syncs
this dump on first poll of the IST day (`ensure_instruments_fresh`).
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
    from index_registry import persist_underlyings, summarize_underlyings
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
    svc = tracker.kite_service
    if not svc:
        n = await db.kite_underlyings.count_documents({})
        print("No Kite credentials — cannot refresh dump. Cached underlyings:", n)
        return 0 if n else 2

    await asyncio.to_thread(svc.reload_instruments, True)
    rows = svc.instrument_rows() or []
    summaries = summarize_underlyings(rows, q="", limit=None)
    n = await persist_underlyings(db, summaries)
    print(f"preloaded {n} F&O underlyings ({len(rows)} Kite instruments)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
