from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Depends
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
import time
from collections import defaultdict, deque
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from oi_tracker import OITracker, INDICES
from oi_service import INDEX_CONFIG
from vrp_service import compute_vrp
from market_hours import is_market_open
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

# Give notifier a handle to the db so it can read/write prefs
import notifier as _notifier_boot
_notifier_boot.set_db(db)


# ------------------- Auth helpers (must be defined before endpoints that Depends on them) -------------------
import secrets
import hmac

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Adeotale")
_ADMIN_PASSWORD_FALLBACK = os.environ.get("ADMIN_PASSWORD", "MasterApp@123")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
if not ADMIN_TOKEN:
    ADMIN_TOKEN = hashlib.sha256(f"{ADMIN_USERNAME}:{_ADMIN_PASSWORD_FALLBACK}:oi-pulse".encode()).hexdigest()

# 8-hour idle timeout for admin sessions.
ADMIN_SESSION_TTL_SECONDS = int(os.environ.get("ADMIN_SESSION_TTL_SECONDS", str(8 * 3600)))
GUEST_SESSION_TTL_SECONDS = int(os.environ.get("GUEST_SESSION_TTL_SECONDS", str(12 * 3600)))


def _pw_hash(password: str, salt: bytes) -> str:
    """Deterministic salted password hash (PBKDF2-HMAC-SHA256, 120k iters)."""
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return dk.hex()


async def _verify_admin_password(password: str) -> bool:
    """Check password against DB-stored hash if it exists, else fall back to env."""
    doc = await db.settings.find_one({"_id": "admin_credentials"})
    if doc and doc.get("password_hash") and doc.get("salt_hex"):
        salt = bytes.fromhex(doc["salt_hex"])
        return hmac.compare_digest(_pw_hash(password, salt), doc["password_hash"])
    return hmac.compare_digest(password, _ADMIN_PASSWORD_FALLBACK)


async def _store_admin_password(new_password: str):
    salt = secrets.token_bytes(16)
    await db.settings.update_one(
        {"_id": "admin_credentials"},
        {"$set": {
            "password_hash": _pw_hash(new_password, salt),
            "salt_hex": salt.hex(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )


def _extract_bearer(request: Request, header: str) -> str:
    tok = (request.headers.get(header) or "").strip()
    if tok:
        return tok
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


async def _admin_from_request(request: Request):
    tok = _extract_bearer(request, "x-admin-token")
    if not tok:
        return None
    sess = await db.admin_sessions.find_one({"_id": tok})
    if not sess:
        return None
    try:
        created_at = datetime.fromisoformat(sess.get("created_at"))
    except Exception:
        return None
    age = (datetime.now(timezone.utc) - created_at).total_seconds()
    if age > ADMIN_SESSION_TTL_SECONDS:
        try:
            await db.admin_sessions.delete_one({"_id": tok})
        except Exception:
            pass
        return None
    return sess


async def _is_admin_request(request: Request) -> bool:
    return (await _admin_from_request(request)) is not None


async def require_admin(request: Request):
    """FastAPI dependency: 401 if not authenticated as admin."""
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    return True


async def _guest_from_request(request: Request):
    tok = _extract_bearer(request, "x-guest-token")
    if not tok:
        return None
    sess = await db.guest_sessions.find_one({"_id": tok})
    if not sess:
        return None
    try:
        started = datetime.fromisoformat(sess.get("started_at"))
    except Exception:
        return None
    if (datetime.now(timezone.utc) - started).total_seconds() > GUEST_SESSION_TTL_SECONDS:
        try:
            await db.guest_sessions.delete_one({"_id": tok})
        except Exception:
            pass
        return None
    # Touch last_seen_at
    try:
        await db.guest_sessions.update_one(
            {"_id": tok},
            {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        pass
    return sess


def _next_market_close_ist() -> datetime:
    from market_hours import IST
    now = datetime.now(IST)
    close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    if now >= close:
        close = close + timedelta(days=1)
    return close.astimezone(timezone.utc)


async def _get_public_access_state():
    doc = await db.settings.find_one({"_id": "public_access"}) or {}
    open_ = bool(doc.get("open", False))
    exp = doc.get("expires_at")
    expires_at_iso = None
    if exp:
        try:
            exp_dt = datetime.fromisoformat(exp)
            if datetime.now(timezone.utc) >= exp_dt:
                await db.settings.update_one(
                    {"_id": "public_access"}, {"$set": {"open": False, "expires_at": None}}, upsert=True
                )
                open_ = False
            else:
                expires_at_iso = exp_dt.isoformat()
        except Exception:
            open_ = False
    return open_, expires_at_iso


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
async def set_credentials(payload: CredentialsIn, _admin: bool = Depends(require_admin)):
    try:
        await tracker.set_credentials(payload.api_key, payload.access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/kite/generate-session")
async def generate_session(payload: GenerateTokenIn, _admin: bool = Depends(require_admin)):
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
async def vault_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key": 1, "api_secret_enc": 1})
    return {
        "has_api_key": bool(doc and doc.get("api_key")),
        "has_api_secret": bool(doc and doc.get("api_secret_enc")),
        "api_key_hint": (doc.get("api_key")[:4] + "***") if (doc and doc.get("api_key")) else None,
    }


@api_router.post("/kite/refresh")
async def kite_refresh(payload: RefreshTokenIn, _admin: bool = Depends(require_admin)):
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
async def clear_vault(_admin: bool = Depends(require_admin)):
    await db.credentials.update_one({"_id": "kite"}, {"$unset": {"api_secret_enc": ""}})
    return {"ok": True}


@api_router.get("/credentials/status")
async def credentials_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key": 1, "updated_at": 1})
    return {
        "configured": bool(doc),
        "api_key_hint": (doc.get("api_key")[:4] + "***" if doc else None),
        "updated_at": doc.get("updated_at") if doc else None,
    }


@api_router.post("/mode")
async def set_mode(payload: ModeIn, _admin: bool = Depends(require_admin)):
    try:
        await tracker.set_mode(payload.mode)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/tracker/start")
async def tracker_start(_admin: bool = Depends(require_admin)):
    await tracker.start()
    return await tracker.get_status()


@api_router.post("/tracker/stop")
async def tracker_stop(_admin: bool = Depends(require_admin)):
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
    # if expiry mismatch or no snap, fetch on-demand (only when market is open)
    if not snap or (expiry and snap.get("expiry") != expiry):
        if not is_market_open():
            # Market closed → serve latest from DB, don't hit Kite.
            doc = await db.oi_snapshots.find_one(
                {"index": idx, **({"expiry": expiry} if expiry else {})},
                sort=[("created_at", -1)],
                projection={"_id": 0},
            )
            if doc:
                snap = doc
                tracker.last_snapshot[idx] = doc
        else:
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
async def set_expiry(index_name: str, payload: ExpiryIn, _admin: bool = Depends(require_admin)):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    tracker.set_expiry(idx, payload.expiry)
    return {"ok": True, "index": idx, "selected": tracker.selected_expiry.get(idx)}


@api_router.get("/settings")
async def get_settings():
    return tracker.settings


@api_router.post("/settings")
async def update_settings(payload: SettingsIn, _admin: bool = Depends(require_admin)):
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
        # Respect market hours: once the market is closed, we STOP pulling
        # fresh ticks and simply serve the last snapshot from memory / DB.
        # This satisfies the "9:15 AM – 3:30 PM only" polling requirement
        # and keeps the UI stable overnight / on weekends / on holidays.
        market_is_open = is_market_open()
        if not market_is_open:
            if not current:
                # No in-memory cache — try DB for the most recent snapshot for this index.
                doc = await db.oi_snapshots.find_one(
                    {"index": idx, **({"expiry": expiry} if expiry else {})},
                    sort=[("created_at", -1)],
                    projection={"_id": 0},
                )
                if doc:
                    current = doc
                    tracker.last_snapshot[idx] = doc
                else:
                    raise HTTPException(503, f"No data available for {idx} — market is closed and no cached snapshot yet.")
            # else: keep the stale cached snapshot untouched — this IS the "last
            # data held in DB" that the user should see after market close.
        else:
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


@api_router.get("/vrp/{index_name}")
async def get_vrp(index_name: str, days: int = Query(30, ge=5, le=90)):
    """Volatility Risk Premium for an index (IV - Historical Vol).

    Uses Kite historical_data (daily OHLC) to compute HV_10, HV_20 and
    Parkinson high-low HV. Compares against the current India VIX (from
    tracker.last_snapshot[idx].vix) to produce VRP and a rolling series
    for the sparkline.

    Requires Kite credentials — in mock mode returns an empty-shape response
    with an `error` field so the frontend can degrade gracefully.
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    # Resolve current IV (India VIX). We prefer the most recent snapshot's vix
    # value; fall back to any index's vix if the target index hasn't polled.
    iv_pct: Optional[float] = None
    snap = tracker.last_snapshot.get(idx)
    if snap and snap.get("vix"):
        iv_pct = float(snap["vix"])
    else:
        for k in ("NIFTY", "SENSEX", "BANKNIFTY"):
            s = tracker.last_snapshot.get(k)
            if s and s.get("vix"):
                iv_pct = float(s["vix"])
                break

    if tracker.mode != "kite" or not tracker.kite_service:
        return {
            "index": idx,
            "iv": iv_pct,
            "vrp": None,
            "regime": "unknown",
            "label": "Needs Kite login",
            "tone": "slate",
            "series": [],
            "error": "not_in_kite_mode",
        }

    return await compute_vrp(tracker.kite_service, db, idx, iv_pct, days=days)


@api_router.get("/alerts")
async def get_alerts(limit: int = 50):
    docs = await db.alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=limit)
    return {"alerts": docs}


@api_router.delete("/alerts")
async def clear_alerts(_admin: bool = Depends(require_admin)):
    r = await db.alerts.delete_many({})
    return {"deleted": r.deleted_count}


@api_router.get("/config")
async def get_config():
    return {"indices": INDEX_CONFIG, "poll_interval_seconds": 15}


# ------------------- Simple Admin Auth + Public Access Toggle -------------------
# Helpers moved to top of file. Endpoints follow.


class LoginIn(BaseModel):
    username: str
    password: str


@api_router.post("/auth/login")
async def auth_login(payload: LoginIn, request: Request):
    if not hmac.compare_digest(payload.username, ADMIN_USERNAME) or \
       not await _verify_admin_password(payload.password):
        raise HTTPException(401, "Invalid credentials")
    # Rotate a fresh session token, store with created_at → allows 8h expiry.
    token = secrets.token_urlsafe(32)
    ip = request.client.host if request.client else None
    await db.admin_sessions.insert_one({
        "_id": token,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ip": ip,
        "user_agent": request.headers.get("user-agent", "")[:200],
    })
    return {
        "ok": True, "token": token, "is_admin": True, "username": ADMIN_USERNAME,
        "expires_in_seconds": ADMIN_SESSION_TTL_SECONDS,
    }


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordIn, request: Request,
                               _admin: bool = Depends(require_admin)):
    if not await _verify_admin_password(payload.old_password):
        raise HTTPException(401, "Current password is incorrect")
    new_pw = (payload.new_password or "")
    if len(new_pw) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    if new_pw == payload.old_password:
        raise HTTPException(400, "New password must differ from current password")
    await _store_admin_password(new_pw)
    # Invalidate ALL admin sessions except the caller so any other logged-in device is signed out.
    tok = _extract_bearer(request, "x-admin-token")
    try:
        if tok:
            await db.admin_sessions.delete_many({"_id": {"$ne": tok}})
        else:
            await db.admin_sessions.delete_many({})
    except Exception:
        pass
    return {"ok": True, "message": "Password changed. Other devices have been signed out."}


@api_router.post("/auth/logout")
async def auth_logout(request: Request):
    tok = _extract_bearer(request, "x-admin-token")
    if tok:
        await db.admin_sessions.delete_one({"_id": tok})
    return {"ok": True}


class GuestSessionIn(BaseModel):
    name: str


@api_router.post("/auth/guest")
async def auth_guest_start(payload: GuestSessionIn, request: Request):
    """Register a guest with their full name. Requires public access to be OPEN."""
    open_, _ = await _get_public_access_state()
    if not open_:
        raise HTTPException(403, "Public access is not open. Please contact the admin.")
    name = (payload.name or "").strip()
    if len(name) < 2 or len(name) > 100:
        raise HTTPException(400, "Please enter your full name (2–100 chars).")
    # Very light sanity: must contain a space (full name)
    if " " not in name:
        raise HTTPException(400, "Please enter your FULL name (first name + last name).")
    token = secrets.token_urlsafe(32)
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")[:200]
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.guest_sessions.insert_one({
        "_id": token,
        "name": name,
        "ip": ip,
        "user_agent": ua,
        "started_at": now_iso,
        "last_seen_at": now_iso,
    })
    logger.info(f"GUEST session started: name='{name}' ip={ip}")
    return {"ok": True, "token": token, "name": name, "expires_in_seconds": GUEST_SESSION_TTL_SECONDS}


@api_router.get("/auth/state")
async def auth_state(request: Request):
    """Public endpoint — returns app-access state for the caller."""
    open_, expires_at_iso = await _get_public_access_state()
    admin_sess = await _admin_from_request(request)
    is_admin = admin_sess is not None
    guest_sess = None if is_admin else (await _guest_from_request(request))
    is_guest = guest_sess is not None
    admin_name = ADMIN_USERNAME if is_admin else None
    guest_name = guest_sess.get("name") if is_guest else None
    needs_guest_name = open_ and not is_admin and not is_guest
    requires_login = (not open_) and (not is_admin)
    return {
        "requires_login": requires_login,
        "public_access_open": open_,
        "public_access_expires_at": expires_at_iso,
        "is_admin": is_admin,
        "is_guest": is_guest,
        "guest_name": guest_name,
        "needs_guest_name": needs_guest_name,
        "admin_name": admin_name,
        "admin_display_name": ADMIN_USERNAME,   # shown in "Guest access via <name>" banner
        "session_ttl_seconds": ADMIN_SESSION_TTL_SECONDS,
    }


class PublicAccessIn(BaseModel):
    open: bool


@api_router.post("/auth/public-access", dependencies=[])
async def auth_toggle_public(payload: PublicAccessIn, request: Request):
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    if payload.open:
        expires_utc = _next_market_close_ist()
        await db.settings.update_one(
            {"_id": "public_access"},
            {"$set": {"open": True, "expires_at": expires_utc.isoformat()}},
            upsert=True,
        )
        return {"ok": True, "open": True, "expires_at": expires_utc.isoformat()}
    else:
        await db.settings.update_one(
            {"_id": "public_access"},
            {"$set": {"open": False, "expires_at": None}},
            upsert=True,
        )
        # Also drop all guest sessions so nobody remains authenticated after close.
        try:
            await db.guest_sessions.delete_many({})
        except Exception:
            pass
        return {"ok": True, "open": False, "expires_at": None}


@api_router.get("/auth/guests")
async def auth_list_guests(request: Request, since_hours: int = Query(24, ge=1, le=168),
                           _admin: bool = Depends(require_admin)):
    """Admin-only: list guests active in the last N hours (default 24h)."""
    since_dt = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    docs = await db.guest_sessions.find(
        {"started_at": {"$gte": since_dt.isoformat()}},
        {"_id": 0}
    ).sort("started_at", -1).to_list(length=500)
    # Also compute "active in last 5 min" flag.
    now = datetime.now(timezone.utc)
    for d in docs:
        try:
            ls = datetime.fromisoformat(d.get("last_seen_at") or d.get("started_at"))
            d["active"] = (now - ls).total_seconds() < 300
            d["idle_seconds"] = int((now - ls).total_seconds())
        except Exception:
            d["active"] = False
            d["idle_seconds"] = None
    return {"guests": docs, "count": len(docs), "since_hours": since_hours}


# ------------------- Telegram notifications -------------------
import notifier as _notifier
from market_hours import market_status as _market_status


@api_router.get("/telegram/status")
async def telegram_status():
    return {"configured": _notifier.is_configured()}


@api_router.get("/telegram/prefs")
async def telegram_prefs_get(_admin: bool = Depends(require_admin)):
    return await _notifier.get_prefs()


class TelegramPrefsIn(BaseModel):
    enabled: Optional[bool] = None
    indices: Optional[dict] = None
    types: Optional[dict] = None
    quiet_hours: Optional[dict] = None
    major_abs_threshold: Optional[float] = None


@api_router.post("/telegram/prefs")
async def telegram_prefs_set(payload: TelegramPrefsIn, _admin: bool = Depends(require_admin)):
    return await _notifier.save_prefs(payload.model_dump(exclude_none=True))


# Quick-preset endpoints (POST for idempotence + rate-limit friendliness)
_PRESETS = {
    "everything": {
        "enabled": True,
        "indices": {"NIFTY": True, "SENSEX": True, "BANKNIFTY": True},
        "types": {"oi_reversal": True, "huge_shift": True, "huge_shift_major_only": False,
                  "market_open": True, "market_close": True, "daily_digest": True,
                  "tracker_errors": True, "kite_token": True},
        "quiet_hours": {"enabled": False, "start": "09:00", "end": "10:30"},
    },
    "nifty_only": {
        "enabled": True,
        "indices": {"NIFTY": True, "SENSEX": False, "BANKNIFTY": False},
    },
    "sensex_only": {
        "enabled": True,
        "indices": {"NIFTY": False, "SENSEX": True, "BANKNIFTY": False},
    },
    "banknifty_only": {
        "enabled": True,
        "indices": {"NIFTY": False, "SENSEX": False, "BANKNIFTY": True},
    },
    "morning_only": {
        "enabled": True,
        "quiet_hours": {"enabled": True, "start": "09:00", "end": "10:30"},
    },
    "digest_only": {
        "enabled": True,
        "types": {"oi_reversal": False, "huge_shift": False, "market_open": False,
                  "market_close": True, "daily_digest": True, "tracker_errors": True,
                  "kite_token": True, "huge_shift_major_only": True},
    },
    "major_shifts_only": {
        "enabled": True,
        "types": {"oi_reversal": False, "huge_shift": True, "huge_shift_major_only": True,
                  "market_open": False, "market_close": False, "daily_digest": True,
                  "tracker_errors": True, "kite_token": True},
    },
    "off": {"enabled": False},
}


@api_router.post("/telegram/prefs/preset/{name}")
async def telegram_prefs_preset(name: str, _admin: bool = Depends(require_admin)):
    preset = _PRESETS.get(name)
    if not preset:
        raise HTTPException(400, f"Unknown preset '{name}'. Available: {list(_PRESETS.keys())}")
    return await _notifier.save_prefs(preset)


@api_router.post("/telegram/test")
async def telegram_test(_admin: bool = Depends(require_admin)):
    if not _notifier.is_configured():
        raise HTTPException(400, "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in backend/.env and restart.")
    ok = await _notifier.send_test_message()
    if not ok:
        raise HTTPException(502, "Telegram send failed — check bot token / chat id / network.")
    return {"ok": True, "sent": True}


class HugeShiftIn(BaseModel):
    index: str
    side: str          # 'CE' or 'PE'
    value: float
    direction: str     # 'build' or 'unwind'
    window: int
    price: Optional[float] = None
    atm: Optional[float] = None
    contributing: Optional[List[dict]] = None


@api_router.post("/telegram/huge-shift")
async def telegram_huge_shift(payload: HugeShiftIn, request: Request):
    """Called by the frontend when the HugeShiftModal fires — forwards to Telegram.
    Kept OPEN (no admin guard) because the browser tab that saw the popup fires it,
    but rate-limited by the middleware (see _RATE_LIMITED_PREFIXES)."""
    if not _notifier.is_configured():
        return {"ok": False, "reason": "telegram_not_configured"}
    try:
        await _notifier.alert_huge_shift(payload.model_dump())
    except Exception as e:
        raise HTTPException(502, f"Telegram send failed: {e}")
    return {"ok": True}


@api_router.post("/telegram/digest/preview")
async def telegram_digest_preview(_admin: bool = Depends(require_admin)):
    """Build (but do NOT send) today's digest — for UI preview / testing."""
    return await tracker.build_daily_digest()


@api_router.post("/telegram/digest/send")
async def telegram_digest_send(_admin: bool = Depends(require_admin)):
    """Manually send today's digest to Telegram now (useful for testing or if auto-send missed)."""
    if not _notifier.is_configured():
        raise HTTPException(400, "Telegram not configured.")
    digest = await tracker.build_daily_digest()
    ok = await _notifier.send_daily_digest(digest)
    return {"ok": True, "sent": ok, "digest": digest}


@api_router.get("/market/status")
async def market_status_endpoint():
    return _market_status()


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
async def get_positions(_admin: bool = Depends(require_admin)):
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

# --- Security: Trusted Host (prevent Host header attacks) ---
_trusted_hosts_env = os.environ.get('TRUSTED_HOSTS', '').strip()
if _trusted_hosts_env:
    _trusted_hosts = [h.strip() for h in _trusted_hosts_env.split(',') if h.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_trusted_hosts)

# --- Security: HTTP security headers ---
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # HSTS: enable only when served over HTTPS in production
        if os.environ.get('ENABLE_HSTS', 'true').lower() == 'true':
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# --- Security: Simple in-memory rate limiter for sensitive endpoints ---
_rate_buckets: dict = defaultdict(deque)
_RATE_LIMITED_PREFIXES = (
    "/api/credentials",
    "/api/kite/generate-session",
    "/api/kite/refresh",
    "/api/kite/vault",
    "/api/mode",
    "/api/telegram/huge-shift",
    "/api/auth/guest",
    "/api/auth/login",
)
_RATE_LIMIT_MAX = int(os.environ.get('RATE_LIMIT_MAX', '20'))       # requests
_RATE_LIMIT_WINDOW = int(os.environ.get('RATE_LIMIT_WINDOW', '60')) # seconds

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method in ("POST", "DELETE") and any(path.startswith(p) for p in _RATE_LIMITED_PREFIXES):
            ip = request.client.host if request.client else "unknown"
            key = f"{ip}:{path}"
            now = time.time()
            bucket = _rate_buckets[key]
            while bucket and now - bucket[0] > _RATE_LIMIT_WINDOW:
                bucket.popleft()
            if len(bucket) >= _RATE_LIMIT_MAX:
                return Response(
                    content='{"detail":"Too many requests. Please slow down."}',
                    status_code=429,
                    media_type="application/json",
                )
            bucket.append(now)
        return await call_next(request)

app.add_middleware(RateLimitMiddleware)

# --- CORS (restricted; wildcard only if explicitly set) ---
_cors_env = os.environ.get('CORS_ORIGINS', '*').strip()
_cors_origins = [o.strip() for o in _cors_env.split(',') if o.strip()]
_cors_regex = os.environ.get('CORS_ORIGIN_REGEX', '').strip() or None
_allow_credentials = True
if _cors_origins == ['*']:
    # Browser spec: wildcard + credentials is invalid; disable credentials in that case.
    _allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["*", "Authorization", "Content-Type", "X-Admin-Token", "X-Guest-Token"],
    expose_headers=["*"],
    max_age=600,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    # Ensure indexes for fast history / retention queries.
    try:
        await db.oi_snapshots.create_index([("index", 1), ("created_at", 1)])
        await db.oi_snapshots.create_index("created_at")
        await db.alerts.create_index([("index", 1), ("created_at", -1)])
    except Exception as e:
        logger.warning(f"index creation warn: {e}")

    await tracker.load_credentials()
    await tracker.load_settings()
    await tracker.start()

    # Report how much of today's session data we already have so operators
    # can immediately see whether continuity was preserved across a restart.
    try:
        from market_hours import IST
        today_ist = datetime.now(IST).date()
        start_utc = datetime.combine(today_ist, datetime.min.time()).replace(tzinfo=IST).astimezone(timezone.utc)
        today_count = await db.oi_snapshots.count_documents(
            {"created_at": {"$gte": start_utc.isoformat()}}
        )
        logger.info(
            f"OI Tracker started in {tracker.mode} mode | "
            f"today's snapshots already stored: {today_count} "
            f"(polling resumes immediately)"
        )
    except Exception:
        logger.info(f"OI Tracker started in {tracker.mode} mode")


@app.on_event("shutdown")
async def _shutdown():
    await tracker.stop()
    client.close()
