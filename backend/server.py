from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from oi_tracker import OITracker, INDICES
from oi_service import INDEX_CONFIG
from cryptography.fernet import Fernet
import base64, hashlib

def _fernet():
    seed = os.environ.get('MONGO_URL', 'seed') + os.environ.get('DB_NAME', 'db')
    key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(key)

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


class GenerateTokenIn(BaseModel):
    api_key: str
    api_secret: str
    request_token: str
    remember: Optional[bool] = True


class RefreshTokenIn(BaseModel):
    request_token: str


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


@api_router.post("/kite/generate-session")
async def generate_session(payload: GenerateTokenIn):
    """Exchange api_key + api_secret + request_token for a fresh access_token
    using KiteConnect.generate_session(), save it, and switch to LIVE mode."""
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=payload.api_key)
        data = kc.generate_session(payload.request_token, api_secret=payload.api_secret)
        access_token = data.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned by Kite")
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await tracker.set_credentials(payload.api_key, access_token)
    except Exception as e:
        raise HTTPException(400, str(e))
    if payload.remember:
        enc = _fernet().encrypt(payload.api_secret.encode()).decode()
        await db.credentials.update_one(
            {"_id": "kite"},
            {"$set": {"api_secret_enc": enc}},
            upsert=True,
        )
    return {"ok": True, "mode": tracker.mode, "access_token": access_token, "user_id": data.get("user_id"), "remembered": bool(payload.remember)}


@api_router.get("/kite/vault")
async def vault_status():
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key": 1, "api_secret_enc": 1})
    return {
        "has_api_key": bool(doc and doc.get("api_key")),
        "has_api_secret": bool(doc and doc.get("api_secret_enc")),
        "api_key_hint": (doc.get("api_key")[:4] + "***") if (doc and doc.get("api_key")) else None,
    }


@api_router.post("/kite/refresh")
async def kite_refresh(payload: RefreshTokenIn):
    """One-click daily refresh: uses stored api_key + encrypted api_secret + given request_token."""
    doc = await db.credentials.find_one({"_id": "kite"})
    if not doc or not doc.get("api_key") or not doc.get("api_secret_enc"):
        raise HTTPException(400, "No stored api_key/api_secret — use Generate flow first with 'remember' enabled.")
    try:
        api_secret = _fernet().decrypt(doc["api_secret_enc"].encode()).decode()
    except Exception as e:
        raise HTTPException(400, f"Vault decrypt failed: {e}")
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=doc["api_key"])
        data = kc.generate_session(payload.request_token, api_secret=api_secret)
        access_token = data.get("access_token")
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await tracker.set_credentials(doc["api_key"], access_token)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id")}


@api_router.delete("/kite/vault")
async def clear_vault():
    await db.credentials.update_one({"_id": "kite"}, {"$unset": {"api_secret_enc": ""}})
    return {"ok": True}


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

    # -------------------------------------------------------------- #
    # P0 FIX: If cached `last_snapshot` is older than STALE_THRESHOLD
    # seconds, force a fresh get_snapshot() call INLINE. This
    # protects the /change endpoint from a silently-stalled
    # background poll loop (which was causing 1/3/5/10/15 min windows
    # to all resolve to the same DB doc and return identical deltas).
    # -------------------------------------------------------------- #
    STALE_THRESHOLD_SECONDS = 20
    is_stale = False
    if current:
        try:
            cur_ts_dt = datetime.fromisoformat(current.get("timestamp"))
            age = (datetime.now(timezone.utc) - cur_ts_dt).total_seconds()
            if age > STALE_THRESHOLD_SECONDS:
                is_stale = True
                logger.warning(
                    f"/change: cached snapshot for {idx} is {age:.1f}s old "
                    f"(>{STALE_THRESHOLD_SECONDS}s) — refreshing inline."
                )
        except Exception:
            is_stale = True

    if (not current) or is_stale or (expiry and current.get("expiry") != expiry):
        try:
            svc = tracker._get_service()
            fresh = await asyncio.wait_for(
                asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                timeout=10.0,
            )
            if fresh:
                fresh["mode"] = tracker.mode
                tracker.last_snapshot[idx] = fresh
                current = fresh
            elif not current:
                # No cache AND fresh returned None
                raise HTTPException(503, f"No data available for {idx}")
            else:
                # Keep stale as fallback but log
                logger.warning(f"/change: fresh get_snapshot({idx}) returned None; using stale cache.")
        except asyncio.TimeoutError:
            logger.error(f"/change: get_snapshot({idx}) timed out after 10s; using stale cache if any.")
            if not current:
                raise HTTPException(504, f"Snapshot fetch timed out for {idx}")
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"/change inline refresh failed for {idx}: {e}")
            if not current:
                raise HTTPException(500, str(e))
    if not current:
        raise HTTPException(503, "No current data")

    # Always persist the freshly-served `current` snapshot to Mongo so the
    # /change endpoint keeps history current even if the background tracker
    # thread stalls. Upsert on (index, timestamp) so we don't create duplicates
    # for the same market tick.
    current_ts = current.get("timestamp")
    if current_ts:
        try:
            await db.oi_snapshots.update_one(
                {"index": idx, "timestamp": current_ts, "expiry": current.get("expiry")},
                {"$setOnInsert": {**{k: v for k, v in current.items() if k != "_id"},
                                    "created_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
        except Exception as _e:
            logger.warning(f"/change upsert failed for {idx}: {_e}")

    # Anchor the lookback on the `current` snapshot's own timestamp (the actual
    # market-tick time), NOT on wall-clock now(). Using now() would cause every
    # short timeframe (1/3/5/10/15 min) to collapse to the same DB doc whenever
    # the tracker was even briefly behind wall-clock.
    try:
        anchor = datetime.fromisoformat(current_ts) if current_ts else datetime.now(timezone.utc)
    except Exception:
        anchor = datetime.now(timezone.utc)
    target = anchor - timedelta(minutes=minutes)
    # Query on the snapshot's own `timestamp` field (also indexed) so we look
    # for OI data that was actually recorded ~N minutes before `current`.
    query = {"index": idx, "timestamp": {"$lt": current_ts, "$lte": target.isoformat()}} if current_ts else {"index": idx, "created_at": {"$lte": target.isoformat()}}
    if expiry:
        query["expiry"] = expiry
    prev_doc = await db.oi_snapshots.find_one(
        query,
        sort=[("timestamp", -1)],
        projection={"_id": 0},
    )

    # If we don't have a snapshot exactly `minutes` old yet, take the closest
    # older snapshot (still strictly older than current) so users see *some*
    # diff instead of a blank window — and flag history_ready=False.
    if not prev_doc and current_ts:
        fallback_query = {"index": idx, "timestamp": {"$lt": current_ts}}
        if expiry:
            fallback_query["expiry"] = expiry
        prev_doc = await db.oi_snapshots.find_one(
            fallback_query,
            sort=[("timestamp", -1)],
            projection={"_id": 0},
        )

    # Attach a small meta so the frontend can indicate "history warming up" when
    # the requested lookback isn't available yet.
    history_ready = True
    elapsed_min_val: Optional[float] = None
    if prev_doc and current_ts:
        try:
            prev_ts_dt = datetime.fromisoformat(prev_doc.get("timestamp"))
            cur_ts_dt = datetime.fromisoformat(current_ts)
            elapsed_min_val = (cur_ts_dt - prev_ts_dt).total_seconds() / 60.0
            # Consider history "ready" only if we have at least ~80 % of the
            # requested lookback available. Otherwise flag it as warming up.
            if elapsed_min_val < 0.8 * minutes:
                history_ready = False
        except Exception:
            pass
    elif not prev_doc:
        history_ready = False

    # ------------------------------------------------------------------ #
    # P0 FIX (round 2): Suppress the fallback snapshot when it is FAR too
    # young for the requested lookback. Otherwise multiple longer
    # timeframes (10/15/30 min etc.) would all resolve to the SAME
    # "oldest available" doc and display identical CE/PE change values,
    # which is what the user reported as the bug.
    #
    # Rule: if the available baseline is < 60 % of the requested minutes,
    # drop `previous` (return null) so the UI can honestly show "not
    # enough history yet" instead of misleading identical numbers.
    # ------------------------------------------------------------------ #
    if prev_doc and elapsed_min_val is not None and elapsed_min_val < 0.6 * minutes:
        prev_doc = None
        history_ready = False

    return {
        "index": idx,
        "current": current,
        "previous": prev_doc,
        "minutes": minutes,
        "history_ready": history_ready,
        "available_history_minutes": round(elapsed_min_val, 2) if elapsed_min_val is not None else 0.0,
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


# ------------------- Multi-index quote for header ticker -------------------
@api_router.get("/tickers")
async def get_tickers():
    """Return LTP + previous close + change + change% for NIFTY 50, SENSEX and
    BANK NIFTY. Used by the header static ticker strip so users can eyeball
    today's movement at a glance across all three main indices.
    Falls back to mock movement when Kite isn't connected."""
    import random
    result = []
    symbols = [
        ("NIFTY",     "NSE:NIFTY 50",   "NIFTY 50"),
        ("SENSEX",    "BSE:SENSEX",     "SENSEX"),
        ("BANKNIFTY", "NSE:NIFTY BANK", "BANK NIFTY"),
    ]
    if tracker.mode == "kite" and tracker.kite_service:
        try:
            kite = tracker.kite_service.kite
            keys = [s[1] for s in symbols]
            data = await asyncio.to_thread(kite.quote, keys)
            for internal, symbol, label in symbols:
                q = data.get(symbol, {}) if isinstance(data, dict) else {}
                ltp = float(q.get("last_price", 0) or 0)
                ohlc = q.get("ohlc") or {}
                prev = float(ohlc.get("close", 0) or 0)
                change = ltp - prev if prev else 0.0
                change_pct = (change / prev * 100) if prev else 0.0
                result.append({
                    "index": internal,
                    "label": label,
                    "ltp": round(ltp, 2),
                    "prev_close": round(prev, 2),
                    "day_open": round(float(ohlc.get("open", 0) or 0), 2),
                    "day_high": round(float(ohlc.get("high", 0) or 0), 2),
                    "day_low":  round(float(ohlc.get("low", 0) or 0), 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 3),
                    "source": "kite",
                })
            return {"mode": tracker.mode, "tickers": result, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            logger.warning(f"tickers kite failed, falling back to snapshot: {e}")

    # Fallback: use the tracker's last_snapshot which has live prices, and mock a
    # prev_close by biasing it 0-0.8% away from current LTP.
    for internal, _symbol, label in symbols:
        snap = tracker.last_snapshot.get(internal) or {}
        ltp = float(snap.get("price") or 0)
        prev = ltp * (1 - random.uniform(-0.008, 0.008)) if ltp else 0
        change = ltp - prev
        change_pct = (change / prev * 100) if prev else 0.0
        result.append({
            "index": internal, "label": label,
            "ltp": round(ltp, 2), "prev_close": round(prev, 2),
            "day_open": round(prev, 2),
            "day_high": round(ltp * 1.003, 2), "day_low": round(ltp * 0.997, 2),
            "change": round(change, 2), "change_pct": round(change_pct, 3),
            "source": "mock",
        })
    return {"mode": tracker.mode, "tickers": result, "fetched_at": datetime.now(timezone.utc).isoformat()}


# ------------------- Zerodha positions -------------------
@api_router.get("/positions")
async def get_positions():
    """Fetch open F&O positions from the user's Kite account (net + day).
    Only available in kite mode. Returns a normalised list with parsed
    strike / side / expiry for options so the frontend can overlay them."""
    if tracker.mode != "kite" or not tracker.kite_service:
        return {"mode": tracker.mode, "positions": [], "error": "Not in Kite mode. Connect Kite API first."}
    try:
        import re
        kite = tracker.kite_service.kite
        raw = await asyncio.to_thread(kite.positions)
        net = raw.get("net", []) if isinstance(raw, dict) else raw
    except Exception as e:
        return {"mode": tracker.mode, "positions": [], "error": f"Kite error: {type(e).__name__}: {e}"}

    # Parse tradingsymbol like  NIFTY26JUL2426800CE  -> {index, expiry, strike, side}
    # Supported patterns (NSE/BSE weekly & monthly):
    #   <IDX><YY><MMM><DD><STRIKE><CE|PE>   e.g. NIFTY26JUL2426800CE
    #   <IDX><YY><M><DD><STRIKE><CE|PE>     weekly single-digit month e.g. NIFTY26J1424800CE (rare)
    #   <IDX><YY><MMM><STRIKE><CE|PE>       monthly  e.g. NIFTY26JUL24800CE
    OPT_RE = re.compile(
        r"^(?P<idx>NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX)"
        r"(?P<yy>\d{2})"
        r"(?P<mm>[A-Z]{3}|\d{1,2}|[A-Z]\d{1,2})"
        r"(?P<strike>\d{3,7})"
        r"(?P<side>CE|PE)$"
    )
    out = []
    for p in net:
        if int(p.get("quantity", 0)) == 0:
            continue  # skip closed positions with 0 net qty
        ts = p.get("tradingsymbol", "")
        m = OPT_RE.match(ts)
        parsed = {}
        if m:
            parsed = {
                "index": m.group("idx"),
                "strike": int(m.group("strike")),
                "side": m.group("side"),
                "expiry_code": m.group("mm"),
                "expiry_yy": m.group("yy"),
            }
        out.append({
            "tradingsymbol": ts,
            "exchange": p.get("exchange"),
            "product": p.get("product"),
            "quantity": int(p.get("quantity", 0)),
            "average_price": float(p.get("average_price", 0) or 0),
            "last_price": float(p.get("last_price", 0) or 0),
            "pnl": float(p.get("pnl", 0) or 0),
            "unrealised": float(p.get("unrealised", 0) or 0),
            "buy_quantity": int(p.get("buy_quantity", 0)),
            "sell_quantity": int(p.get("sell_quantity", 0)),
            "buy_price": float(p.get("buy_price", 0) or 0),
            "sell_price": float(p.get("sell_price", 0) or 0),
            **parsed,
        })
    # Fresh spot for each index in the positions
    idx_spot = {}
    for pos in out:
        idx = pos.get("index")
        if idx and idx in INDEX_CONFIG and idx not in idx_spot:
            snap = tracker.last_snapshot.get(idx)
            if snap:
                idx_spot[idx] = {"price": snap.get("price"), "atm": snap.get("atm")}
    return {"mode": tracker.mode, "positions": out, "spot": idx_spot}


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
