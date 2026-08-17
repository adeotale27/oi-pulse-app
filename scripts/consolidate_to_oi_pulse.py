#!/usr/bin/env python3
"""Consolidate to a SINGLE database: oi_pulse.

Steps (idempotent):
  1. Drop the entire `oi_pulse` database (all collections/documents).
  2. Copy every collection + document from `striklenz` into `oi_pulse` (preserving _id).
  3. Drop the entire `striklenz` database.

Run against whatever MONGO_URL points to (preview here; on production the same
script can be run by Emergent Support / prod DB tooling).
"""
import os
from pymongo import MongoClient
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")

MONGO_URL = os.environ["MONGO_URL"]
SOURCE = "striklenz"
TARGET = "oi_pulse"

client = MongoClient(MONGO_URL)
existing = client.list_database_names()
print("Databases before:", [d for d in existing if d not in ("admin", "config", "local")])

# 1. Drop target completely
client.drop_database(TARGET)
print(f"[1/3] Dropped '{TARGET}'")

# 2. Copy source -> target
if SOURCE in client.list_database_names():
    src = client[SOURCE]
    tgt = client[TARGET]
    total = 0
    for coll in src.list_collection_names():
        docs = list(src[coll].find({}))
        if docs:
            BATCH = 1000
            for i in range(0, len(docs), BATCH):
                tgt[coll].insert_many(docs[i:i + BATCH], ordered=False)
        print(f"      {coll:<28} {len(docs):>7} docs -> {TARGET}")
        total += len(docs)
    print(f"[2/3] Copied {total} docs from '{SOURCE}' to '{TARGET}'")
    # 3. Drop source
    client.drop_database(SOURCE)
    print(f"[3/3] Dropped '{SOURCE}'")
else:
    print(f"[2/3] Source '{SOURCE}' not present — nothing to copy.")
    print(f"[3/3] Nothing to drop.")

after = [d for d in client.list_database_names() if d not in ("admin", "config", "local")]
print("Databases after:", after)
tgt_counts = {c: client[TARGET][c].count_documents({}) for c in client[TARGET].list_collection_names()}
print(f"'{TARGET}' collections: {len(tgt_counts)}, total docs: {sum(tgt_counts.values())}")
client.close()
