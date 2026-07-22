"""
Seed the Index Event Risk Dashboard collections from the artifacts shipped in
/app/backend/seed_data/. Idempotent — safe to re-run.

Usage:
    python /app/backend/seed_index_data.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load env
load_dotenv(Path(__file__).parent / ".env")

# Local imports
sys.path.insert(0, str(Path(__file__).parent))
from event_risk_service import (  # noqa: E402
    read_upload_bytes,
    parse_constituents,
    parse_events,
    save_constituents,
    save_events,
)

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or "oi_pulse"

SEED_DIR = Path(__file__).parent / "seed_data"

FILES = [
    ("NIFTY", SEED_DIR / "nifty50.xlsx"),
    ("BANKNIFTY", SEED_DIR / "banknifty.xlsx"),
    ("SENSEX", SEED_DIR / "sensex.xlsx"),
]

EVENTS_FILE = SEED_DIR / "events.csv"


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    print(f"[seed] Connected to Mongo db={DB_NAME}")

    # --- Constituents ---
    for idx, path in FILES:
        if not path.exists():
            print(f"[seed] SKIP {idx}: file not found at {path}")
            continue
        with open(path, "rb") as f:
            data = f.read()
        df = read_upload_bytes(data, path.name)
        rows, errors = parse_constituents(df, idx)
        if errors:
            print(f"[seed] ❌ {idx}: {len(errors)} validation errors")
            for e in errors[:10]:
                print(f"       - {e}")
            continue
        res = await save_constituents(db, idx, rows)
        print(f"[seed] ✅ {idx}: saved {res['rows_saved']} constituents")

    # --- Events ---
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "rb") as f:
            data = f.read()
        df = read_upload_bytes(data, EVENTS_FILE.name)
        rows, errors = parse_events(df)
        if errors:
            print(f"[seed] ❌ events: {len(errors)} validation errors")
            for e in errors[:10]:
                print(f"       - {e}")
        else:
            res = await save_events(db, rows, source_filename=EVENTS_FILE.name)
            print(f"[seed] ✅ events: saved {res['rows_saved']} rows")
    else:
        print(f"[seed] SKIP events: file not found at {EVENTS_FILE}")

    # --- Summary counts ---
    for idx in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        cnt = await db.index_constituents.count_documents({"index": idx})
        print(f"[seed] index_constituents[{idx}] = {cnt}")
    ev_cnt = await db.nse_events.count_documents({})
    print(f"[seed] nse_events total = {ev_cnt}")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())