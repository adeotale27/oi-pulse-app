from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from oi_tracker import OITracker, INDICES
from oi_service import INDEX_CONFIG

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="NSE OI Tracker")
api_router = APIRouter(prefix="/api")

tracker = OITracker(db)


# ------------------- Models -------------------
class CredentialsIn(BaseModel):
    api_key: str
    access_token: str


class ModeIn(BaseModel):
    mode: str  # "kite" | "mock"


class SettingsIn(BaseModel):
    threshold_pct: Optional[float] = None
    cooldown_seconds: Optional[int] = None
    compare_minutes: Optional[int] = None
    enabled_indices: Optional[List[str]] = None


class ExpiryIn(BaseModel):
    expiry: Optional[str] = None


# ------------------- Routes -------------------
@api_router.get("/")
async def root():
    return {"message": "NSE OI Tracker API", "indices": list(INDEX_CONFIG.keys())}


@api_router.get("/status")
async def get_status():
    return await tracker.get_status()


@api_router.post("/credentials")
async def set_credentials(payload: CredentialsIn):
    try:
        await tracker.set_credentials(payload.api_key, payload.access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "mode": tracker.mode}


@api_router.get("/credentials/status")
async def credentials_status():
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key": 1, "updated_at": 1})
    return {
        "configured": bool(doc),
        "api_key_hint": (doc.get("api_key")[:4] + "***" if doc else None),
        "updated_at": doc.get("updated_at") if doc else None,
    }


@api_router.post("/mode")
async def set_mode(payload: ModeIn):
    try:
        await tracker.set_mode(payload.mode)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/tracker/start")
async def tracker_start():
    await tracker.start()
    return await tracker.get_status()


@api_router.post("/tracker/stop")
async def tracker_stop():
    await tracker.stop()
    return await tracker.get_status()


@api_router.get("/oi/{index_name}")
async def get_current_oi(index_name: str, expiry: Optional[str] = None):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    if expiry:
        tracker.set_expiry(idx, expiry)
    snap = tracker.last_snapshot.get(idx)
    # if expiry mismatch or no snap, fetch on-demand
    if not snap or (expiry and snap.get("expiry") != expiry):
        try:
            import asyncio
            svc = tracker._get_service()
            snap = await asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx))
            if snap:
                snap["mode"] = tracker.mode
                tracker.last_snapshot[idx] = snap
        except Exception as e:
            raise HTTPException(500, str(e))
    if not snap:
        raise HTTPException(503, "No data yet")
    return snap


@api_router.get("/expiries/{index_name}")
async def get_expiries(index_name: str):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    return {"index": idx, "expiries": tracker.list_expiries(idx), "selected": tracker.selected_expiry.get(idx)}


@api_router.post("/expiries/{index_name}")
async def set_expiry(index_name: str, payload: ExpiryIn):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    tracker.set_expiry(idx, payload.expiry)
    return {"ok": True, "index": idx, "selected": tracker.selected_expiry.get(idx)}


@api_router.get("/settings")
async def get_settings():
    return tracker.settings


@api_router.post("/settings")
async def update_settings(payload: SettingsIn):
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "enabled_indices" in patch:
        for i in patch["enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown index: {i}")
    return await tracker.save_settings(patch)


@api_router.get("/oi/{index_name}/change")
async def get_oi_change(index_name: str, minutes: int = Query(15, ge=1, le=1440), expiry: Optional[str] = None):
    """Return current snapshot plus 'previous' snapshot from N minutes ago for diffing."""
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    if expiry:
        tracker.set_expiry(idx, expiry)
    current = tracker.last_snapshot.get(idx)
    if not current or (expiry and current.get("expiry") != expiry):
        try:
            import asyncio
            svc = tracker._get_service()
            current = await asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx))
            if current:
                current["mode"] = tracker.mode
                tracker.last_snapshot[idx] = current
        except Exception as e:
            raise HTTPException(500, str(e))
    if not current:
        raise HTTPException(503, "No current data")

    target = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    query = {"index": idx, "created_at": {"$lte": target.isoformat()}}
    if expiry:
        query["expiry"] = expiry
    prev_doc = await db.oi_snapshots.find_one(
        query,
        sort=[("created_at", -1)],
        projection={"_id": 0},
    )

    return {
        "index": idx,
        "current": current,
        "previous": prev_doc,
        "minutes": minutes,
    }


@api_router.get("/history/{index_name}")
async def get_history(index_name: str, minutes: int = Query(60, ge=1, le=1440)):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    docs = await db.oi_snapshots.find(
        {"index": idx, "created_at": {"$gte": cutoff}},
        {"_id": 0}
    ).sort("created_at", 1).to_list(length=5000)
    return {"index": idx, "count": len(docs), "history": docs}


@api_router.get("/alerts")
async def get_alerts(limit: int = 50):
    docs = await db.alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=limit)
    return {"alerts": docs}


@api_router.delete("/alerts")
async def clear_alerts():
    r = await db.alerts.delete_many({})
    return {"deleted": r.deleted_count}


@api_router.get("/config")
async def get_config():
    return {"indices": INDEX_CONFIG, "poll_interval_seconds": 15}


# ------------------- Lifecycle -------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    await tracker.load_credentials()
    await tracker.load_settings()
    await tracker.start()
    logger.info(f"OI Tracker started in {tracker.mode} mode")


@app.on_event("shutdown")
async def _shutdown():
    await tracker.stop()
    client.close()
