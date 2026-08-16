#!/usr/bin/env python3
"""Restore StrikLenz JSON dump into MongoDB.

- Reads MONGO_URL + DB_NAME from backend/.env
- Each *.json file is an array of documents (string _id, ISO-string dates) -> matches app storage exactly
- Files ending in _partN are merged into the same base collection
- Existing collections are dropped then re-inserted (idempotent restore)
"""
import os
import re
import json
import sys
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")

DUMP_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/oi_restore")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "oi_pulse")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# Map file stem -> collection (strip _partN suffix)
files = sorted(p for p in DUMP_DIR.glob("*.json") if p.name != "dump.zip")
by_collection: dict[str, list[Path]] = {}
for p in files:
    coll = re.sub(r"_part\d+$", "", p.stem)
    by_collection.setdefault(coll, []).append(p)

print(f"Restoring into DB '{DB_NAME}' from {DUMP_DIR}")
total = 0
for coll, parts in sorted(by_collection.items()):
    docs = []
    for part in sorted(parts):
        with open(part) as f:
            data = json.load(f)
        if isinstance(data, dict):
            data = [data]
        docs.extend(data)
    db[coll].drop()
    if docs:
        # insert in batches to avoid oversized ops
        BATCH = 1000
        for i in range(0, len(docs), BATCH):
            db[coll].insert_many(docs[i:i + BATCH], ordered=False)
    print(f"  {coll:<28} {len(docs):>7} docs")
    total += len(docs)

# The dump may carry a stale admin_credentials password hash inside `settings`.
# Remove it so the ADMIN_PASSWORD env var is the single source of truth for login.
removed = db.settings.delete_one({"_id": "admin_credentials"}).deleted_count
if removed:
    print("  (removed stale settings/admin_credentials so ADMIN_PASSWORD env wins)")

print(f"DONE. {total} documents across {len(by_collection)} collections.")
client.close()
