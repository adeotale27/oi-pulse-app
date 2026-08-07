from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Depends
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os
import asyncio
import logging
import time
from collections import defaultdict, deque
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta, date

# Delay motor client creation until startup to avoid heavy connection objects during import.
from motor.motor_asyncio import AsyncIOMotorClient

from oi_tracker import OITracker, INDICES, JsonLogFormatter
from oi_service import INDEX_CONFIG
from vrp_service import compute_vrp
from market_hours import is_market_open, IST, MARKET_OPEN, is_holiday, is_weekend, display_hours, configure_hours
from gift_vix_service import extra_tickers
import event_risk_service as ers
from fastapi import UploadFile, File, Form

# cryptography import deferred inside _fernet() to reduce startup import cost
import base64, hashlib

def _fernet():
    # Import inside function so cryptography is loaded only when vault operations are used.
    from cryptography.fernet import Fernet
    seed = os.environ.get('MONGO_URL', 'seed') + os.environ.get('DB_NAME', 'db')
    key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(key)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create Mongo client and db during startup event to keep import-time footprint low.
client = None
db = None

app = FastAPI(title="NSE OI Tracker")
api_router = APIRouter(prefix="/api")

tracker = None

# Straddle sample retention (hours)
STRADDLE_RETENTION_HOURS = int(os.environ.get("STRADDLE_RETENTION_HOURS", "6"))
STRADDLE_SAMPLE_INTERVAL_SECONDS = int(os.environ.get("STRADDLE_SAMPLE_INTERVAL_SECONDS", "60"))  # default 60s straddle sampling
STRADDLE_INDICES = ["NIFTY", "SENSEX"]

# notifier DB will be attached during startup
import notifier as _notifier_boot


# ------------------- Auth helpers (must be defined before endpoints that Depends on them) -------------------
import secrets
import hmac

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Adeotale")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
if not ADMIN_TOKEN and ADMIN_PASSWORD:
    ADMIN_TOKEN = hashlib.sha256(f"{ADMIN_USERNAME}:{ADMIN_PASSWORD}:oi-pulse".encode()).hexdigest()

# 8-hour idle timeout for admin sessions.
ADMIN_SESSION_TTL_SECONDS = int(os.environ.get("ADMIN_SESSION_TTL_SECONDS", str(8 * 3600)))
GUEST_SESSION_TTL_SECONDS = int(os.environ.get("GUEST_SESSION_TTL_SECONDS", str(12 * 3600)))


def _pw_hash(password: str, salt: bytes) -> str:
    """Deterministic salted password hash (PBKDF2-HMAC-SHA256, 120k iters)."""
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return dk.hex()


async def _verify_admin_password(password: str) -> bool:
    """Check password against DB-stored hash if it exists, else env-provided override."""
    doc = await db.settings.find_one({"_id": "admin_credentials"})
    if doc and doc.get("password_hash") and doc.get("salt_hex"):
        salt = bytes.fromhex(doc["salt_hex"])
        return hmac.compare_digest(_pw_hash(password, salt), doc["password_hash"])
    if ADMIN_PASSWORD:
        return hmac.compare_digest(password, ADMIN_PASSWORD)
    return False


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
    ttl = sess.get("ttl_seconds") or ADMIN_SESSION_TTL_SECONDS
    try:
        if tracker and tracker.settings.get("admin_session_ttl_minutes"):
            ttl = max(60, int(tracker.settings["admin_session_ttl_minutes"]) * 60)
    except Exception:
        pass
    age = (datetime.now(timezone.utc) - created_at).total_seconds()
    if age > ttl:
        try:
            await db.admin_sessions.delete_one({"_id": tok})
        except Exception:
            pass
        return None
    # Optional cap: force auto-logout at configured market close (default ON).
    expire_on_close = True
    try:
        if tracker and "expire_admin_on_market_close" in tracker.settings:
            expire_on_close = bool(tracker.settings["expire_admin_on_market_close"])
    except Exception:
        pass
    if expire_on_close:
        market_exp = _session_market_expiry_utc(created_at)
        if datetime.now(timezone.utc) >= market_exp:
            try:
                await db.admin_sessions.delete_one({"_id": tok})
            except Exception:
                pass
            return None
    return sess


def _session_market_expiry_utc(created_at_utc: datetime) -> datetime:
    """Expire admin session at today's configured market close (IST), or tomorrow if already past."""
    created_ist = created_at_utc.astimezone(IST)
    _, close_hm = display_hours()
    try:
        hh, mm = [int(x) for x in close_hm.split(":")[:2]]
    except Exception:
        hh, mm = 15, 40
    close_ist = created_ist.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if created_ist >= close_ist:
        close_ist = close_ist + timedelta(days=1)
    return close_ist.astimezone(timezone.utc)


async def _is_admin_request(request: Request) -> bool:
    return (await _admin_from_request(request)) is not None


async def require_admin(request: Request):
    """FastAPI dependency: 401 if not authenticated as admin."""
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    return True


async def _store_oi_snapshot(snapshot: Dict[str, Any], *, index_name: Optional[str] = None) -> None:
    """Persist one OI snapshot idempotently per (index, timestamp, expiry)."""
    if tracker:
        try:
            await tracker.persist_snapshot(snapshot, index_name=index_name)
            return
        except Exception:
            # fall back to direct DB persisted snapshot if tracker helper fails
            pass

    doc = dict(snapshot or {})
    if index_name:
        doc.setdefault("index", index_name)
    doc["timestamp"] = doc.get("timestamp") or datetime.now(timezone.utc).isoformat()
    created_at = datetime.now(timezone.utc).isoformat()
    set_doc = {k: v for k, v in doc.items() if k != "created_at"}
    await db.oi_snapshots.update_one(
        {
            "index": doc.get("index"),
            "timestamp": doc.get("timestamp"),
            "expiry": doc.get("expiry"),
        },
        {"$set": set_doc, "$setOnInsert": {"created_at": created_at}},
        upsert=True,
    )


async def _persist_straddle_sample(index_name: str, snap: dict):
    """Delegate to tracker._store_straddle_sample if tracker is available.

    This keeps persistence logic centralized in OITracker so behavior is
    consistent between background sampler, WS streams and poll loop.
    """
    try:
        if tracker:
            await tracker._store_straddle_sample(index_name, snap)
    except Exception:
        # Best-effort; don't raise from background sampler
        pass


async def _straddle_sampler():
    """Derive straddle samples from the tracker's last OI snapshots.

    The poller already stores straddle samples on every successful OI tick.
    This loop only fills gaps using cached snapshots — it never hits Kite —
    so we avoid duplicate ~62-token quote batches for NIFTY/SENSEX.
    Honors admin `straddle_enabled_indices` setting.
    """
    while True:
        try:
            try:
                poll_interval_seconds = int(tracker.settings.get("straddle_poll_interval_seconds", STRADDLE_SAMPLE_INTERVAL_SECONDS))
            except Exception:
                poll_interval_seconds = STRADDLE_SAMPLE_INTERVAL_SECONDS

            enabled = tracker.settings.get("straddle_enabled_indices") if tracker else None
            if not enabled:
                enabled = STRADDLE_INDICES

            if is_market_open() and tracker:
                for idx in enabled:
                    if idx not in INDEX_CONFIG:
                        continue
                    try:
                        snap = tracker.last_snapshot.get(idx)
                        if not snap:
                            continue
                        await _persist_straddle_sample(idx, snap)
                    except Exception as e:
                        logger.warning(f"straddle sampler failed for {idx}: {e}")
                await asyncio.sleep(poll_interval_seconds)
            else:
                await asyncio.sleep(min(poll_interval_seconds, 60))
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception(f"straddle sampler loop error: {e}")
            try:
                await asyncio.sleep(poll_interval_seconds)
            except Exception:
                await asyncio.sleep(STRADDLE_SAMPLE_INTERVAL_SECONDS)


async def _guest_from_request(request: Request):
    tok = _extract_bearer(request, "x-guest-token")
    if not tok:
        return None
    # Guests are only valid while public access is open.
    open_, _ = await _get_public_access_state()
    if not open_:
        return None
    sess = await db.guest_sessions.find_one({"_id": tok})
    if not sess:
        return None
    if sess.get("revoked_at"):
        return None
    try:
        started = datetime.fromisoformat(sess.get("started_at"))
    except Exception:
        return None
    if (datetime.now(timezone.utc) - started).total_seconds() > GUEST_SESSION_TTL_SECONDS:
        return None
    # Throttle last_seen writes — auth/state is polled often; avoid write amplification.
    try:
        last_seen = sess.get("last_seen_at")
        should_touch = True
        if last_seen:
            try:
                ls = datetime.fromisoformat(last_seen)
                should_touch = (datetime.now(timezone.utc) - ls).total_seconds() >= 60
            except Exception:
                should_touch = True
        if should_touch:
            await db.guest_sessions.update_one(
                {"_id": tok},
                {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}},
            )
    except Exception:
        pass
    return sess


def _next_market_close_ist() -> datetime:
    from market_hours import IST, is_weekend, is_holiday, display_hours
    now = datetime.now(IST)
    _, close_hm = display_hours()
    try:
        hh, mm = [int(x) for x in close_hm.split(":")[:2]]
    except Exception:
        hh, mm = 15, 40
    close = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now >= close:
        close = close + timedelta(days=1)
    for _ in range(15):
        if not is_weekend(close) and not is_holiday(close):
            break
        close = close + timedelta(days=1)
        close = close.replace(hour=hh, minute=mm, second=0, microsecond=0)
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
                # Auto-expiry must revoke lingering guest tokens — otherwise guests
                # keep picking up live OI after the intended cut-off.
                if open_:
                    await _revoke_guest_sessions("public_access_expired")
                open_ = False
            else:
                expires_at_iso = exp_dt.isoformat()
        except Exception:
            open_ = False
    return open_, expires_at_iso


async def _revoke_guest_sessions(reason: Optional[str] = None):
    update = {"revoked_at": datetime.now(timezone.utc).isoformat()}
    if reason:
        update["revoked_reason"] = reason
    try:
        await db.guest_sessions.update_many({"revoked_at": {"$exists": False}}, {"$set": update})
    except Exception:
        pass


# ------------------- Models -------------------
class CredentialsIn(BaseModel):
    api_key: str
    access_token: str


class ModeIn(BaseModel):
    mode: str  # "kite" | "offline"


DASHBOARD_PAGE_KEYS = {
    "oi-change", "open-interest", "strike-table", "sell-candidates",
    "buildup", "positions", "alerts", "activity", "holidays",
    "straddle", "index-events",
}

class SettingsIn(BaseModel):
    threshold_pct: Optional[float] = None
    cooldown_seconds: Optional[int] = None
    compare_minutes: Optional[int] = None
    enabled_indices: Optional[List[str]] = None
    oi_poll_interval_seconds: Optional[int] = None  # OI data pull interval (15/30/60)
    straddle_poll_interval_seconds: Optional[int] = None  # Straddle data pull interval (60 = 1 min)
    straddle_enabled_indices: Optional[List[str]] = None  # Which indices to track for straddle
    visible_pages: Optional[List[str]] = None
    market_open_ist: Optional[str] = None   # e.g. "09:15"
    market_close_ist: Optional[str] = None  # e.g. "15:40" (Index F&O / CAS)
    expire_admin_on_market_close: Optional[bool] = None
    admin_session_ttl_minutes: Optional[int] = None
    alert_enabled_indices: Optional[List[str]] = None  # weekday-defaulted alert focus


class LoginIn(BaseModel):
    username: str
    password: str
    remember_me: Optional[bool] = False


class ExpiryIn(BaseModel):
    expiry: Optional[str] = None


class GenerateTokenIn(BaseModel):
    api_key: str
    api_secret: str
    request_token: str
    remember: Optional[bool] = True


class RefreshTokenIn(BaseModel):
    request_token: str


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
    # Pull true GIFT NIFTY (NSEIX:GIFT NIFTY) + VIX via Kite immediately.
    try:
        await extra_tickers.force_refresh()
    except Exception:
        pass
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
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id"), "remembered": bool(payload.remember)}


@api_router.get("/kite/vault")
async def vault_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key_enc": 1, "api_secret_enc": 1, "api_key": 1})
    api_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                api_key = doc.get("api_key")
        except Exception:
            api_key = None
    return {
        "has_api_key": bool(api_key),
        "has_api_secret": bool(doc and doc.get("api_secret_enc")),
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
    }


@api_router.post("/kite/refresh")
async def kite_refresh(payload: RefreshTokenIn, _admin: bool = Depends(require_admin)):
    """One-click daily refresh: uses stored api_key + encrypted api_secret + given request_token."""
    doc = await db.credentials.find_one({"_id": "kite"})
    api_key = None
    try:
        if doc and doc.get("api_key_enc"):
            api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
        elif doc and doc.get("api_key"):
            api_key = doc.get("api_key")
    except Exception:
        api_key = None
    if not doc or not api_key or not doc.get("api_secret_enc"):
        raise HTTPException(400, "No stored api_key/api_secret — use Generate flow first with 'remember' enabled.")
    try:
        api_secret = _fernet().decrypt(doc["api_secret_enc"].encode()).decode()
    except Exception as e:
        raise HTTPException(400, f"Vault decrypt failed: {e}")
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=api_key)
        data = kc.generate_session(payload.request_token, api_secret=api_secret)
        access_token = data.get("access_token")
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await tracker.set_credentials(api_key, access_token)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id")}


@api_router.delete("/kite/vault")
async def clear_vault(_admin: bool = Depends(require_admin)):
    await db.credentials.update_one(
        {"_id": "kite"},
        {"$unset": {"api_key_enc": "", "access_token_enc": "", "api_secret_enc": "", "api_key": "", "access_token": ""}},
    )
    return {"ok": True}


@api_router.get("/credentials/status")
async def credentials_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one({"_id": "kite"}, {"_id": 0, "api_key_enc": 1, "api_key": 1, "updated_at": 1})
    api_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                api_key = doc.get("api_key")
        except Exception:
            api_key = None
    return {
        "configured": bool(doc and (doc.get("api_key_enc") or doc.get("api_key"))),
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
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
    # Do NOT mutate tracker.selected_expiry from a GET — that would switch the
    # shared background poller for every client. Expiry is a read filter only.
    snap = tracker.last_snapshot.get(idx)
    # if expiry mismatch or no snap, fetch on-demand (only when market is open)
    if not snap or (expiry and snap.get("expiry") != expiry):
        if not is_market_open():
            # Market closed → serve latest from DB, don't hit Kite.
            doc = await db.oi_snapshots.find_one(
                {"index": idx, **({"expiry": expiry} if expiry else {})},
                sort=[("timestamp", -1)],
                projection={"_id": 0},
            )
            if doc:
                snap = doc
                if not expiry or doc.get("expiry") == tracker.selected_expiry.get(idx):
                    tracker.last_snapshot[idx] = doc
        else:
            try:
                svc = tracker._get_service()
                if svc:
                    # Use requested expiry for THIS fetch only; do not set_expiry.
                    fetch_exp = expiry if expiry is not None else tracker.selected_expiry.get(idx)
                    snap = await asyncio.to_thread(svc.get_snapshot, idx, fetch_exp)
                    if snap:
                        snap["mode"] = tracker.mode
                        # Only update shared cache when expiry matches the poller's selection
                        # (or no specific expiry was requested).
                        if not expiry or snap.get("expiry") == tracker.selected_expiry.get(idx) or tracker.selected_expiry.get(idx) is None:
                            tracker.last_snapshot[idx] = snap
                            try:
                                await _store_oi_snapshot(snap, index_name=idx)
                            except Exception:
                                pass
                else:
                    logger.info(f"get_current_oi: tracker offline, serving cached DB snapshot for {idx}")
                    doc = await db.oi_snapshots.find_one(
                        {"index": idx, **({"expiry": expiry} if expiry else {})},
                        sort=[("timestamp", -1)],
                        projection={"_id": 0},
                    )
                    if doc:
                        snap = doc
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
    all_dates = tracker.list_expiries(idx)

    # Cap to the first 8 nearest (Kite instrument list can span multiple years
    # of monthly expiries which drowns the UI).
    from datetime import date as _date, datetime as _datetime
    parsed = []
    for d in all_dates:
        try:
            parsed.append(_datetime.fromisoformat(d).date() if "T" in d else _date.fromisoformat(d))
        except Exception:
            continue
    parsed.sort()
    parsed = parsed[:8]
    dates = [p.isoformat() for p in parsed]

    # Annotate each date as weekly / monthly. Heuristic: an expiry is "monthly"
    # if it is the LAST expiry falling within that calendar month & year in the
    # returned list. Everything else is "weekly".
    by_month = {}
    for p in parsed:
        by_month.setdefault((p.year, p.month), []).append(p)
    monthly_dates = set()
    for _, lst in by_month.items():
        monthly_dates.add(max(lst))

    # BANKNIFTY special case: NSE discontinued weekly BANKNIFTY in Nov-2024.
    # If Kite returns only one date per month for BANKNIFTY, tag them ALL as M
    # (they're all monthly) and expose a hint.
    only_monthlies = idx == "BANKNIFTY" and all(len(v) == 1 for v in by_month.values())

    today = _date.today()
    meta = []
    for p in parsed:
        iso = p.isoformat()
        is_monthly = p in monthly_dates or only_monthlies
        days = (p - today).days
        label = p.strftime("%d %b").lstrip("0")
        meta.append({
            "date": iso,
            "tag": "M" if is_monthly else "W",
            "type": "monthly" if is_monthly else "weekly",
            "days_to_expiry": days,
            "label": label,
        })

    return {
        "index": idx,
        "expiries": dates,
        "expiries_meta": meta,
        "selected": tracker.selected_expiry.get(idx),
        "note": (
            "BANKNIFTY weekly expiries were discontinued by NSE in Nov-2024. "
            "Only monthly (last-Tuesday-of-month) contracts are listed."
            if only_monthlies else None
        ),
    }


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
        if not patch["enabled_indices"]:
            raise HTTPException(400, "At least one tracked index is required")
        for i in patch["enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown index: {i}")
    if "alert_enabled_indices" in patch:
        for i in patch["alert_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown alert index: {i}")
    if "straddle_enabled_indices" in patch:
        for i in patch["straddle_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown straddle index: {i}")
    if "visible_pages" in patch:
        if not patch["visible_pages"]:
            raise HTTPException(400, "At least one public dashboard page is required")
        for p in patch["visible_pages"]:
            if p not in DASHBOARD_PAGE_KEYS:
                raise HTTPException(400, f"Unknown dashboard page: {p}")
    if "oi_poll_interval_seconds" in patch:
        if int(patch["oi_poll_interval_seconds"]) not in (15, 30, 60):
            raise HTTPException(400, "oi_poll_interval_seconds must be 15, 30, or 60")
    if "straddle_poll_interval_seconds" in patch:
        if int(patch["straddle_poll_interval_seconds"]) not in (30, 60, 120):
            raise HTTPException(400, "straddle_poll_interval_seconds must be 30, 60, or 120")
    for key in ("market_open_ist", "market_close_ist"):
        if key in patch:
            try:
                hh, mm = [int(x) for x in str(patch[key]).split(":")[:2]]
                if not (0 <= hh <= 23 and 0 <= mm <= 59):
                    raise ValueError("range")
                patch[key] = f"{hh:02d}:{mm:02d}"
            except Exception:
                raise HTTPException(400, f"{key} must be HH:MM (IST)")
    if "admin_session_ttl_minutes" in patch:
        v = int(patch["admin_session_ttl_minutes"])
        if v < 30 or v > 24 * 60:
            raise HTTPException(400, "admin_session_ttl_minutes must be between 30 and 1440")
        patch["admin_session_ttl_minutes"] = v
    return await tracker.save_settings(patch)


def _session_open_utc_for_anchor(anchor: datetime) -> datetime:
    """Return today's NSE session-open (09:14 IST) in UTC for the anchor's IST day.

    Change windows must never reach into the previous trading day — that made
    Full-Day / pre-open deltas look like "yesterday's OI pulled into today".
    """
    anchor_ist = anchor.astimezone(IST) if anchor.tzinfo else anchor.replace(tzinfo=timezone.utc).astimezone(IST)
    session_open_ist = anchor_ist.replace(
        hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0
    )
    return session_open_ist.astimezone(timezone.utc)


async def _find_previous_snapshot(
    idx: str,
    current_ts: str,
    minutes: int,
    expiry: Optional[str],
) -> tuple:
    """Find the earliest snapshot in [max(anchor−N, session_open), current_ts).

    Returns (prev_doc, history_ready, available_history_minutes).
    """
    try:
        anchor = datetime.fromisoformat(current_ts)
    except Exception:
        anchor = datetime.now(timezone.utc)
    target = anchor - timedelta(minutes=minutes)
    session_open = _session_open_utc_for_anchor(anchor)
    # Clamp lookback to today's session so previous-day OI never contaminates Δ.
    if target < session_open:
        target = session_open

    window_query = {
        "index": idx,
        "timestamp": {"$gte": target.isoformat(), "$lt": current_ts},
    }
    if expiry:
        window_query["expiry"] = expiry

    # ASC → earliest in window ≈ closest to the N-min-ago boundary.
    prev_doc = await db.oi_snapshots.find_one(
        window_query,
        sort=[("timestamp", 1)],
        projection={"_id": 0},
    )

    history_ready = True
    elapsed_min_val: Optional[float] = None
    if prev_doc and current_ts:
        try:
            prev_ts_dt = datetime.fromisoformat(prev_doc.get("timestamp"))
            cur_ts_dt = datetime.fromisoformat(current_ts)
            elapsed_min_val = (cur_ts_dt - prev_ts_dt).total_seconds() / 60.0
            if elapsed_min_val < 0.8 * minutes:
                history_ready = False
        except Exception:
            pass
    elif not prev_doc:
        history_ready = False

    return prev_doc, history_ready, round(elapsed_min_val, 2) if elapsed_min_val is not None else 0.0


def _build_data_status(current: dict, market_is_open: bool, age_seconds: Optional[float]) -> dict:
    mode = tracker.mode if tracker else "offline"
    stale_reason = None
    is_live = False
    if mode != "kite":
        stale_reason = "missing_kite_credentials"
    elif not market_is_open:
        stale_reason = "market_closed"
    elif age_seconds is None:
        stale_reason = "no_timestamp"
    elif age_seconds > 45:
        stale_reason = "stale_cache"
    else:
        is_live = True

    data_date = None
    try:
        if current.get("timestamp"):
            data_date = datetime.fromisoformat(current["timestamp"]).astimezone(IST).date().isoformat()
    except Exception:
        data_date = None

    return {
        "is_live": is_live,
        "stale_reason": stale_reason,
        "data_date": data_date,
        "cache_age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
    }


@api_router.get("/oi/{index_name}/change")
async def get_oi_change(
    index_name: str,
    minutes: int = Query(15, ge=1, le=1440),
    expiry: Optional[str] = None,
    also: Optional[str] = Query(None, description="Comma-separated extra windows e.g. 1,3,5"),
):
    """Return current snapshot plus a time-based baseline snapshot for diffing.

    Efficiency contract:
      * Never hits Kite inline (avoids N-client stampede). Background poller is
        the sole writer; if cache is stale we kick a single-flight refresh and
        still return the latest known snapshot immediately.
      * GET never mutates tracker.selected_expiry.
      * Lookback is clamped to today's session open so previous-day OI cannot
        leak into Change-in-OI.
      * `also=1,3,5` returns extra baselines in one round-trip (huge-shift).
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    market_is_open = is_market_open()
    current = tracker.last_snapshot.get(idx) if tracker else None

    # Expiry filter only — never call set_expiry from GET.
    if current and expiry and current.get("expiry") != expiry:
        current = None

    age = None
    if tracker and current and hasattr(tracker, "snapshot_age_seconds"):
        age = tracker.snapshot_age_seconds(current)
    STALE_THRESHOLD_SECONDS = 25
    needs_db = (not current) or (age is not None and age > STALE_THRESHOLD_SECONDS and not market_is_open)

    if needs_db or (not current):
        doc = await db.oi_snapshots.find_one(
            {"index": idx, **({"expiry": expiry} if expiry else {})},
            sort=[("timestamp", -1)],
            projection={"_id": 0},
        )
        if doc:
            current = doc
            # Only seed shared cache when serving the poller's selected expiry.
            if tracker and (not expiry or doc.get("expiry") == tracker.selected_expiry.get(idx) or tracker.selected_expiry.get(idx) is None):
                tracker.last_snapshot[idx] = doc
            if tracker and hasattr(tracker, "snapshot_age_seconds"):
                age = tracker.snapshot_age_seconds(current)

    if not current:
        raise HTTPException(
            503,
            f"No data available for {idx}"
            + (" — market is closed and no cached snapshot yet." if not market_is_open else ""),
        )

    # If cache is stale while market is open, kick ONE background refresh —
    # do not block this request on Kite.
    if market_is_open and tracker and hasattr(tracker, "request_background_refresh"):
        if age is None or age > STALE_THRESHOLD_SECONDS:
            tracker.request_background_refresh(idx, expiry=expiry)

    current_ts = current.get("timestamp")
    if not current_ts:
        raise HTTPException(503, "No current data")

    prev_doc, history_ready, available_min = await _find_previous_snapshot(
        idx, current_ts, minutes, expiry
    )

    # Batch extra windows for huge-shift monitor (one round-trip).
    also_windows: Dict[str, Any] = {}
    if also:
        extra_mins = []
        for part in also.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                m = int(part)
                if 1 <= m <= 1440 and m != minutes:
                    extra_mins.append(m)
            except ValueError:
                continue
        # Deduplicate while preserving order
        seen = set()
        for m in extra_mins:
            if m in seen:
                continue
            seen.add(m)
            p, ready, avail = await _find_previous_snapshot(idx, current_ts, m, expiry)
            also_windows[str(m)] = {
                "previous": p,
                "minutes": m,
                "history_ready": ready,
                "available_history_minutes": avail,
            }

    return {
        "index": idx,
        "current": current,
        "previous": prev_doc,
        "minutes": minutes,
        "history_ready": history_ready,
        "available_history_minutes": available_min,
        "also_windows": also_windows,
        "data_status": _build_data_status(current, market_is_open, age),
    }


@api_router.get("/history/{index_name}")
async def get_history(index_name: str, minutes: int = Query(60, ge=1, le=1440)):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    docs = await db.oi_snapshots.find(
        {"index": idx, "timestamp": {"$gte": cutoff, "$lte": datetime.now(timezone.utc).isoformat()}},
        {"_id": 0}
    ).sort("timestamp", 1).to_list(length=5000)
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


@api_router.get("/straddle/{index_name}")
async def get_straddle(index_name: str, expiry: Optional[str] = None, position: str = Query("long"), qty: int = Query(1, ge=1), span_steps: Optional[int] = Query(None, ge=4), points: int = Query(81, ge=5, le=801)):
    """Return a straddle payoff series for the ATM strike.

    - `position`: "long" or "short"
    - `qty`: multiplier for the payoff
    - `span_steps`: optional number of strike steps each side to include (defaults to ~20)
    - `points`: number of points in the price grid (default 81)
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    # Fetch a fresh snapshot if we don't have one cached
    snap = tracker.last_snapshot.get(idx)
    if not snap or (expiry and snap.get("expiry") != expiry):
        try:
            svc = tracker._get_service()
            snap = await asyncio.to_thread(svc.get_snapshot, idx, expiry or tracker.selected_expiry.get(idx))
            if snap:
                snap["mode"] = tracker.mode
                tracker.last_snapshot[idx] = snap
        except Exception as e:
            raise HTTPException(500, str(e))

    if not snap:
        raise HTTPException(503, "No data yet for straddle calculation")

    atm = int(snap.get("atm") or 0)
    price = float(snap.get("price") or 0.0)
    step = INDEX_CONFIG[idx]["step"]
    # default span: 20 strikes on each side
    steps = span_steps if span_steps is not None else 20
    left = atm - steps * step
    right = atm + steps * step

    # find best matching strike in snapshot (fallback to atm)
    strike_obj = None
    for s in snap.get("strikes", []):
        if int(s.get("strike")) == atm:
            strike_obj = s
            break
    if not strike_obj:
        # pick the closest available strike
        strikes_list = sorted([int(s.get("strike")) for s in snap.get("strikes", [])])
        if strikes_list:
            closest = min(strikes_list, key=lambda x: abs(x - atm))
            for s in snap.get("strikes", []):
                if int(s.get("strike")) == closest:
                    strike_obj = s
                    atm = closest
                    break

    ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
    pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
    premium = ce_p + pe_p

    # build price grid
    start = max(0.0, left)
    end = right
    series = []
    for i in range(points):
        p = start + (end - start) * (i / (points - 1))
        # payoff for long straddle = max(p-K,0) + max(K-p,0) - premium
        intrinsic = max(p - atm, 0.0) + max(atm - p, 0.0)
        pnl_per = intrinsic - premium
        if position == "short":
            pnl_per = -pnl_per
        pnl = pnl_per * qty
        series.append({"price": round(p, 2), "pnl": round(pnl, 2)})

    return {
        "index": idx,
        "atm": atm,
        "underlying": round(price, 2),
        "strike": atm,
        "ce_ltp": round(ce_p, 2),
        "pe_ltp": round(pe_p, 2),
        "premium": round(premium, 2),
        "position": position,
        "qty": qty,
        "series": series,
    }


def _previous_trading_day(now_ist: datetime) -> date:
    candidate = (now_ist - timedelta(days=1)).date()
    while is_weekend(datetime.combine(candidate, datetime.min.time(), IST)) or is_holiday(datetime.combine(candidate, datetime.min.time(), IST)):
        candidate = (datetime.combine(candidate, datetime.min.time(), IST) - timedelta(days=1)).date()
    return candidate


def _resolve_straddle_trade_date(requested_date: Optional[str] = None) -> date:
    now_ist = datetime.now(IST)
    if requested_date and requested_date not in ("auto", "latest"):
        try:
            return date.fromisoformat(requested_date)
        except ValueError:
            raise HTTPException(400, "Invalid date format for trade_date; expected YYYY-MM-DD")
    if now_ist.time() < MARKET_OPEN:
        return _previous_trading_day(now_ist)
    return now_ist.date()


@api_router.get("/straddle/{index_name}/history")
async def get_straddle_history(index_name: str, minutes: Optional[int] = Query(None, ge=1, le=24*60), expiry: Optional[str] = None, date: Optional[str] = None):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    target_date = _resolve_straddle_trade_date(date)
    query = {"index": idx, "trade_date": target_date.isoformat()}
    if expiry:
        query["expiry"] = expiry
    if minutes is not None and minutes < 24 * 60 and not (date is None and datetime.now(IST).time() < MARKET_OPEN):
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        query["created_at"] = {"$gte": cutoff}
    docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=(minutes * 120) if minutes else 5000)

    if not docs and date is None and datetime.now(IST).time() < MARKET_OPEN:
        previous_date = _previous_trading_day(datetime.now(IST))
        query["trade_date"] = previous_date.isoformat()
        query.pop("created_at", None)
        docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=5000)

    return {"index": idx, "trade_date": query["trade_date"], "count": len(docs), "history": docs}


@api_router.websocket("/ws/straddle/{index_name}")
async def ws_straddle(websocket: WebSocket, index_name: str, expiry: Optional[str] = None, position: str = Query("long"), qty: int = Query(1)):
    """WebSocket that streams latest straddle premium every 1s as JSON.

    Message format: { ts: ISO, premium: float, underlying: float, atm: int, ce_ltp: float, pe_ltp: float }
    """
    await websocket.accept()
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        await websocket.close(code=1003)
        return

    # Authenticate via admin token passed as query param or header
    def _get_token_from_scope() -> str:
        # WebSocket headers are available on websocket.scope["headers"] as list of (k,v)
        try:
            # try header first
            for k, v in websocket.scope.get("headers", []):
                if k.decode().lower() in ("x-admin-token", "authorization"):
                    s = v.decode()
                    if k.decode().lower() == "authorization" and s.lower().startswith("bearer "):
                        return s[7:].strip()
                    return s.strip()
        except Exception:
            pass
        # fallback to query params
        try:
            qs = websocket.scope.get("query_string", b"").decode()
            params = dict((pair.split("=", 1) if "=" in pair else (pair, "")) for pair in qs.split("&") if pair)
            return params.get("admin_token") or params.get("token") or ""
        except Exception:
            return ""

    token = _get_token_from_scope()
    if not token:
        await websocket.close(code=4401)
        return

    # validate session
    try:
        sess = await db.admin_sessions.find_one({"_id": token})
        if not sess:
            await websocket.close(code=4401)
            return
        # check expiry similarly to _admin_from_request
        try:
            created_at = datetime.fromisoformat(sess.get("created_at"))
        except Exception:
            await websocket.close(code=4401)
            return
        age = (datetime.now(timezone.utc) - created_at).total_seconds()
        if age > ADMIN_SESSION_TTL_SECONDS:
            try:
                await db.admin_sessions.delete_one({"_id": token})
            except Exception:
                pass
            await websocket.close(code=4401)
            return
        # session ok — proceed
    except Exception:
        await websocket.close(code=4401)
        return

    try:
        # Re-read poll interval each iteration so admin settings apply without reconnect.
        while True:
            try:
                poll_interval_seconds = max(
                    5,
                    int(tracker.settings.get("straddle_poll_interval_seconds", 60)),
                )
                # Only fetch new data during market hours (9:15 AM - 3:30 PM IST, Mon-Fri)
                from market_hours import is_market_open as is_market_open_fn
                if not is_market_open_fn(datetime.now(IST)):
                    # Market closed, return last known data or empty
                    await websocket.send_json({"status": "market_closed"})
                    await asyncio.sleep(60)
                    continue
                
                # Prefer last OI snapshot (no extra Kite hit); fall back to live fetch.
                snap = tracker.last_snapshot.get(idx)
                if not snap or (expiry and snap.get("expiry") != expiry):
                    svc = tracker._get_service()
                    if svc:
                        snap = await asyncio.to_thread(svc.get_snapshot, idx, expiry or tracker.selected_expiry.get(idx))
                if snap:
                    atm = int(snap.get("atm") or 0)
                    price = float(snap.get("price") or 0.0)
                    # find ATM strike object
                    strike_obj = None
                    for s in snap.get("strikes", []):
                        if int(s.get("strike")) == atm:
                            strike_obj = s
                            break
                    if not strike_obj and snap.get("strikes"):
                        # fallback to closest
                        strikes_list = sorted([int(s.get("strike")) for s in snap.get("strikes", [])])
                        closest = min(strikes_list, key=lambda x: abs(x - atm))
                        for s in snap.get("strikes", []):
                            if int(s.get("strike")) == closest:
                                strike_obj = s
                                atm = closest
                                break

                    ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
                    pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
                    premium = ce_p + pe_p
                    payload = {
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "premium": round(premium, 2),
                        "underlying": round(price, 2),
                        "atm": atm,
                        "ce_ltp": round(ce_p, 2),
                        "pe_ltp": round(pe_p, 2),
                    }
                    # Persist sample via the centralized tracker helper for consistent behavior.
                    try:
                        await _persist_straddle_sample(idx, snap)
                    except Exception:
                        logger.warning(
                            "ws_straddle: sample persistence failed for %s",
                            idx,
                            exc_info=True,
                        )
                    await websocket.send_json(payload)
                else:
                    await websocket.send_json({"error": "no_snapshot"})
            except Exception as e:
                try:
                    await websocket.send_json({"error": str(e)})
                except Exception:
                    pass
            await asyncio.sleep(poll_interval_seconds)
    except WebSocketDisconnect:
        return


@api_router.websocket("/ws/spot")
async def ws_spot(websocket: WebSocket):
    """WebSocket stream for live spot prices of the main indices.

    Streams the latest live underlying price for NIFTY, SENSEX and BANKNIFTY
    once per second while the market is open.
    """
    await websocket.accept()
    try:
        while True:
            from market_hours import is_market_open as is_market_open_fn

            if not is_market_open_fn(datetime.now(IST)):
                await websocket.send_json({"type": "status", "status": "market_closed"})
                await asyncio.sleep(1)
                continue

            svc = tracker._get_service()
            payload = {
                "type": "spot",
                "ts": datetime.now(timezone.utc).isoformat(),
                "tickers": [],
            }
            for idx in INDICES:
                snap = None
                try:
                    if svc:
                        snap = await asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx))
                    else:
                        snap = tracker.last_snapshot.get(idx)
                except Exception:
                    snap = None
                if not snap:
                    continue
                try:
                    payload["tickers"].append({
                        "index": idx,
                        "price": round(float(snap.get("price") or 0.0), 2),
                        "atm": int(snap.get("atm") or 0),
                        "timestamp": snap.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                        "mode": snap.get("mode"),
                    })
                except Exception:
                    continue
            if payload["tickers"]:
                await websocket.send_json(payload)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return


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
    if tracker:
        try:
            tracker._refresh_alert_indices_for_today()
        except Exception:
            pass
    poll_interval_seconds = max(1, int(tracker.settings.get("oi_poll_interval_seconds", 15)))
    straddle_poll = max(1, int(tracker.settings.get("straddle_poll_interval_seconds", 60)))
    open_hm, close_hm = display_hours()
    return {
        "indices": INDEX_CONFIG,
        "poll_interval_seconds": poll_interval_seconds,
        "oi_poll_interval_seconds": poll_interval_seconds,
        "straddle_poll_interval_seconds": straddle_poll,
        "enabled_indices": tracker.settings.get("enabled_indices", list(INDEX_CONFIG.keys())),
        "straddle_enabled_indices": tracker.settings.get("straddle_enabled_indices", STRADDLE_INDICES),
        "alert_enabled_indices": tracker.settings.get("alert_enabled_indices"),
        "visible_pages": tracker.settings.get("visible_pages"),
        "market_open_ist": tracker.settings.get("market_open_ist", open_hm),
        "market_close_ist": tracker.settings.get("market_close_ist", close_hm),
        "gift_kite_symbol": "NSEIX:GIFT NIFTY",
    }


# ------------------- Simple Admin Auth + Public Access Toggle -------------------
# Helpers moved to top of file. Endpoints follow.


REMEMBER_ME_TTL_SECONDS = 24 * 3600


def _client_ip(request: Request) -> Optional[str]:
    # Prefer first X-Forwarded-For hop when behind a proxy / ingress.
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff
    return request.client.host if request.client else None


@api_router.post("/auth/login")
async def auth_login(payload: LoginIn, request: Request):
    if not hmac.compare_digest(payload.username, ADMIN_USERNAME) or \
       not await _verify_admin_password(payload.password):
        raise HTTPException(401, "Invalid credentials")
    token = secrets.token_urlsafe(32)
    ip = _client_ip(request)
    now_utc = datetime.now(timezone.utc)
    ttl_min = 480
    try:
        if tracker and tracker.settings.get("admin_session_ttl_minutes"):
            ttl_min = int(tracker.settings["admin_session_ttl_minutes"])
    except Exception:
        pass
    await db.admin_sessions.insert_one({
        "_id": token,
        "created_at": now_utc.isoformat(),
        "ip": ip,
        "user_agent": request.headers.get("user-agent", "")[:200],
        "ttl_seconds": max(60, ttl_min * 60),
    })
    remember_token = None
    if payload.remember_me:
        remember_token = secrets.token_urlsafe(32)
        # One remember device per IP — replace any prior token for this machine.
        try:
            if ip:
                await db.admin_remember_devices.delete_many({"ip": ip})
        except Exception:
            pass
        await db.admin_remember_devices.insert_one({
            "_id": remember_token,
            "ip": ip,
            "created_at": now_utc.isoformat(),
            "expires_at": (now_utc + timedelta(seconds=REMEMBER_ME_TTL_SECONDS)).isoformat(),
            "user_agent": request.headers.get("user-agent", "")[:200],
        })
    try:
        open_, _ = await _get_public_access_state()
        if open_:
            await db.settings.update_one(
                {"_id": "public_access"},
                {"$set": {"open": False, "expires_at": None}},
                upsert=True,
            )
            await _revoke_guest_sessions("admin_login_public_close")
            logger.info("Admin logged in — public access auto-closed and guest sessions revoked.")
    except Exception as e:
        logger.warning(f"Could not auto-close public access on admin login: {e}")

    market_exp = _session_market_expiry_utc(now_utc)
    return {
        "ok": True, "token": token, "is_admin": True, "username": ADMIN_USERNAME,
        "expires_in_seconds": max(60, ttl_min * 60),
        "session_expires_at": market_exp.isoformat(),
        "remember_token": remember_token,
        "remember_expires_in_seconds": REMEMBER_ME_TTL_SECONDS if remember_token else None,
    }


class RememberLoginIn(BaseModel):
    remember_token: str


@api_router.post("/auth/remember-login")
async def auth_remember_login(payload: RememberLoginIn, request: Request):
    """Auto-login from a 24h IP-bound remember token (Remember me)."""
    tok = (payload.remember_token or "").strip()
    if not tok:
        raise HTTPException(401, "Missing remember token")
    doc = await db.admin_remember_devices.find_one({"_id": tok})
    if not doc:
        raise HTTPException(401, "Remember token invalid")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
    except Exception:
        raise HTTPException(401, "Remember token invalid")
    if datetime.now(timezone.utc) >= exp:
        try:
            await db.admin_remember_devices.delete_one({"_id": tok})
        except Exception:
            pass
        raise HTTPException(401, "Remember token expired")
    ip = _client_ip(request)
    if doc.get("ip") and ip and doc["ip"] != ip:
        raise HTTPException(401, "Remember token not valid for this device/IP")
    # Issue a fresh session (same as login)
    session_tok = secrets.token_urlsafe(32)
    now_utc = datetime.now(timezone.utc)
    ttl_min = int((tracker.settings or {}).get("admin_session_ttl_minutes", 480) if tracker else 480)
    await db.admin_sessions.insert_one({
        "_id": session_tok,
        "created_at": now_utc.isoformat(),
        "ip": ip,
        "user_agent": request.headers.get("user-agent", "")[:200],
        "ttl_seconds": max(60, ttl_min * 60),
        "from_remember": True,
    })
    market_exp = _session_market_expiry_utc(now_utc)
    return {
        "ok": True, "token": session_tok, "is_admin": True, "username": ADMIN_USERNAME,
        "expires_in_seconds": max(60, ttl_min * 60),
        "session_expires_at": market_exp.isoformat(),
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
    # Also clear remember-me for this IP if present
    ip = _client_ip(request)
    if ip:
        try:
            await db.admin_remember_devices.delete_many({"ip": ip})
        except Exception:
            pass
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
    ip = _client_ip(request)
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
    # Remember name for this IP so return visits can pre-fill.
    if ip:
        try:
            await db.guest_ip_names.update_one(
                {"_id": ip},
                {"$set": {"name": name, "updated_at": now_iso, "last_token": token}},
                upsert=True,
            )
        except Exception:
            pass
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
    admin_session_expires_at = None
    if is_admin and admin_sess:
        try:
            created = datetime.fromisoformat(admin_sess["created_at"])
            expire_on_close = True
            if tracker and "expire_admin_on_market_close" in tracker.settings:
                expire_on_close = bool(tracker.settings["expire_admin_on_market_close"])
            if expire_on_close:
                admin_session_expires_at = _session_market_expiry_utc(created).isoformat()
        except Exception:
            admin_session_expires_at = None
    # Suggest previous guest name for this IP (public return visit).
    suggested_guest_name = None
    if needs_guest_name:
        ip = _client_ip(request)
        if ip:
            try:
                row = await db.guest_ip_names.find_one({"_id": ip})
                if row and row.get("name"):
                    suggested_guest_name = row["name"]
            except Exception:
                pass
    # Refresh weekday alert defaults if day rolled over
    try:
        if tracker:
            tracker._refresh_alert_indices_for_today()
    except Exception:
        pass
    return {
        "requires_login": requires_login,
        "public_access_open": open_,
        "public_access_expires_at": expires_at_iso,
        "is_admin": is_admin,
        "is_guest": is_guest,
        "guest_name": guest_name,
        "needs_guest_name": needs_guest_name,
        "suggested_guest_name": suggested_guest_name,
        "admin_name": admin_name,
        "admin_display_name": ADMIN_USERNAME,
        "session_ttl_seconds": (
            int(tracker.settings.get("admin_session_ttl_minutes", 480)) * 60
            if tracker else ADMIN_SESSION_TTL_SECONDS
        ),
        "admin_session_expires_at": admin_session_expires_at,
        "can_remember_login": True,
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
        # Revoke all guest sessions so nobody remains authenticated after close,
        # but keep login records for later auditing.
        await _revoke_guest_sessions("public_access_closed")
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
            d["active"] = not bool(d.get("revoked_at")) and (now - ls).total_seconds() < 300
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


# ------------------- Sidebar admin note (public GET, admin POST/DELETE) -------------------
class SidebarNoteIn(BaseModel):
    text: Optional[str] = None


@api_router.get("/sidebar/note")
async def get_sidebar_note():
    """Public: return the stored sidebar note (text + updated_at)."""
    try:
        doc = await db.settings.find_one({"_id": "sidebar_note"}, {"_id": 0})
        if not doc:
            return {"text": "", "updated_at": None}
        return doc
    except Exception:
        return {"text": "", "updated_at": None}


@api_router.post("/sidebar/note")
async def save_sidebar_note(payload: SidebarNoteIn, _admin: bool = Depends(require_admin)):
    """Admin: save or update the sidebar note."""
    text = (payload.text or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"_id": "sidebar_note"}, {"$set": {"text": text, "updated_at": now_iso}}, upsert=True)
    doc = await db.settings.find_one({"_id": "sidebar_note"}, {"_id": 0})
    return {"ok": True, "note": doc}


@api_router.delete("/sidebar/note")
async def delete_sidebar_note(_admin: bool = Depends(require_admin)):
    """Admin: delete the stored sidebar note."""
    await db.settings.delete_one({"_id": "sidebar_note"})
    return {"ok": True}


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
            "source": "historical",
        })
    return {"mode": tracker.mode, "tickers": result, "fetched_at": datetime.now(timezone.utc).isoformat()}


# ------------------- Extra tickers: VIX + GIFT NIFTY -------------------
@api_router.get("/tickers/extras")
async def get_extra_tickers():
    """Live snapshot of India VIX + GIFT NIFTY, refreshed by the background
    `extra_tickers` service on its own schedule:
    - VIX: 09:15–15:30 IST
    - GIFT NIFTY: 06:30–15:40 IST and 16:35–02:45 IST
    Mon–Fri. Returns last-known values outside those windows."""
    return extra_tickers.snapshot()


# ------------------- Admin: refresh today's OI data -------------------
@api_router.post("/admin/refresh-day")
async def admin_refresh_day(_admin: bool = Depends(require_admin)):
    """FRESH PULL — wipe today's OI snapshots (from 09:15 IST) and re-populate
    the session for NIFTY, SENSEX and BANKNIFTY.

    Session data is back-filled at 1-minute cadence from 09:15 IST to the min
    of (now, 15:30 IST). Historical OI ticks cannot be recovered from Kite so
    the back-fill uses the mock service as a stand-in when we are in kite mode
    — this gives the "Full Day" view a complete history to render while live
    Kite polling continues to overwrite the current tick going forward.
    """
    today_ist = datetime.now(IST).date()
    day_start_utc = datetime.combine(
        today_ist, datetime.min.time().replace(hour=9, minute=15)
    ).replace(tzinfo=IST).astimezone(timezone.utc)

    # 1) Clear ALL snapshots — today's session (which we are about to rebuild)
    #    AND anything left over from previous days (which was causing the
    #    "previous day is being pulled" complaint after a Fresh Pull, because
    #    the history endpoints return everything within the retention window).
    deleted = await db.oi_snapshots.delete_many({})
    tracker.last_snapshot = {}  # force /change endpoint to re-fetch
    logger.info(
        f"[admin/refresh-day] deleted {deleted.deleted_count} snapshots (full wipe) — "
        f"today session start {day_start_utc.isoformat()}"
    )

    ALL_INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"]

    # 2) Backfill strategy depends on whether Kite credentials are present:
    #    • KITE MODE  → NO synthetic backfill. Kite only supplies live ticks,
    #                   so fabricating history would show FAKE OI values that
    #                   don't match reality. Instead we take ONE live Kite
    #                   snapshot per index at "now" and rely on the tracker's
    #                   normal 15-second poll to fill in the rest going
    #                   forward. This is the "real data only" behaviour the
    #                   user wants when Kite is connected.
    #    • MOCK MODE  → generate a synthetic 1-minute-cadence day (mock's own
    #                   base prices) so demos have a populated Full-Day chart.
    backfilled = 0
    per_index_count = {idx: 0 for idx in ALL_INDICES}
    live_pulled: List[str] = []
    now_ist_now = datetime.now(IST)
    session_start = datetime.combine(
        today_ist, datetime.min.time().replace(hour=9, minute=15)
    ).replace(tzinfo=IST)
    session_end = min(
        now_ist_now,
        datetime.combine(
            today_ist, datetime.min.time().replace(hour=15, minute=30)
        ).replace(tzinfo=IST),
    )

    if tracker.mode == "kite" and tracker.kite_service:
        # Real-data-only: one live poll per index; live poller continues from
        # here every 15s. No synthetic history is written.
        ksvc = tracker.kite_service
        for idx in ALL_INDICES:
            try:
                snap = await asyncio.wait_for(
                    asyncio.to_thread(ksvc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                    timeout=10.0,
                )
                if snap:
                    snap["mode"] = "kite"
                    snap["source"] = "live"
                    tracker.last_snapshot[idx] = snap
                    await _store_oi_snapshot(snap, index_name=idx)
                    per_index_count[idx] += 1
                    backfilled += 1
                    live_pulled.append(idx)
            except Exception as e:
                logger.warning(f"[refresh kite-live] {idx}: {e}")
    else:
        # OFFLINE mode (no Kite credentials): DO NOT synthesize or backfill
        # mock/demo data. Creating synthetic history would expose fake values to
        # end users which is unacceptable in production. Instead, simply leave
        # the DB empty (we already cleared it above) and report that the
        # backfill was skipped due to missing credentials.
        logger.info("[admin/refresh-day] offline mode: skipping synthetic backfill (no Kite credentials configured)")
        # backfilled remains 0

    # 3) Immediate live poll for ALL indices when market is open — skipped if
    #    step 2 already performed the kite live pull (avoids double Kite quotes).
    if is_market_open():
        if tracker.mode == "kite" and tracker.kite_service and not live_pulled:
            try:
                svc = tracker._get_service()
                for idx in ALL_INDICES:
                    try:
                        snap = await asyncio.wait_for(
                            asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                            timeout=10.0,
                        )
                        if snap:
                            snap["mode"] = tracker.mode
                            snap["source"] = "live"
                            tracker.last_snapshot[idx] = snap
                            await _store_oi_snapshot(snap, index_name=idx)
                            live_pulled.append(idx)
                    except Exception as e:
                        logger.warning(f"[refresh live-poll] {idx}: {e}")
            except Exception as e:
                logger.warning(f"[admin/refresh-day] live poll block failed: {e}")
        elif tracker.mode != "kite":
            logger.info("[admin/refresh-day] market open but tracker offline — skipping immediate live poll")
    else:
        # After close: seed `last_snapshot` from the last backfilled document so
        # /oi/{idx}/change serves the correct final tick immediately.
        for idx in ALL_INDICES:
            doc = await db.oi_snapshots.find_one(
                {"index": idx},
                sort=[("timestamp", -1)],
                projection={"_id": 0},
            )
            if doc:
                tracker.last_snapshot[idx] = doc

    # 4) Nudge extra-tickers so header VIX / GIFT NIFTY refresh too.
    try:
        await extra_tickers.force_refresh()
    except Exception:
        pass

    successful_indices = [i for i, c in per_index_count.items() if c > 0]

    return {
        "ok": True,
        "deleted": deleted.deleted_count,
        "backfilled_snapshots": backfilled,
        "per_index_count": per_index_count,
        "indices_backfilled": successful_indices,
        "live_indices_pulled": live_pulled,
        "mode": tracker.mode,
        "session_start_utc": day_start_utc.isoformat(),
        "session_end_ist": min(datetime.now(IST),
                               datetime.combine(today_ist,
                                                datetime.min.time().replace(hour=15, minute=30)
                                                ).replace(tzinfo=IST)).isoformat(),
        "message": (
            f"Fresh Pull complete. Cleared {deleted.deleted_count} old snapshots and "
            f"back-filled {backfilled} snapshots ({', '.join(successful_indices)}) "
            f"from 09:15 IST → now. Live polling continues automatically."
        ),
    }


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


# ================================================================
# Index Event Risk Dashboard endpoints (admin upload + read APIs)
# ================================================================

_UPLOAD_TYPE_TO_INDEX = {
    "nifty50": "NIFTY",
    "banknifty": "BANKNIFTY",
    "sensex": "SENSEX",
}

_ACTIVE_INDEX_ALIASES = {
    "NIFTY": "NIFTY",
    "NIFTY50": "NIFTY",
    "NIFTY_50": "NIFTY",
    "SENSEX": "SENSEX",
    "BANK": "BANKNIFTY",
    "BANKNIFTY": "BANKNIFTY",
    "BANK_NIFTY": "BANKNIFTY",
}


@api_router.post("/admin/upload/constituents")
async def upload_constituents(
    upload_type: str = Form(...),
    file: UploadFile = File(...),
    _admin: bool = Depends(require_admin),
):
    """Admin-only. upload_type ∈ {'nifty50','banknifty','sensex'}."""
    key = (upload_type or "").strip().lower().replace("-", "").replace(" ", "")
    idx_code = _UPLOAD_TYPE_TO_INDEX.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown upload_type '{upload_type}'. Expected one of {list(_UPLOAD_TYPE_TO_INDEX)}")
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read uploaded file: {e}")
    if not raw:
        raise HTTPException(400, "Uploaded file is empty.")
    try:
        df = ers.read_upload_bytes(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows, errors = ers.parse_constituents(df, idx_code)
    if errors:
        return {
            "ok": False,
            "index": idx_code,
            "errors": errors,
            "row_count": 0,
        }
    res = await ers.save_constituents(db, idx_code, rows)
    return {
        "ok": True,
        "index": idx_code,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
    }


@api_router.post("/admin/upload/events")
async def upload_events(
    file: UploadFile = File(...),
    _admin: bool = Depends(require_admin),
):
    """Admin-only. Uploads a 1-month NSE event calendar (CSV or XLSX)."""
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read uploaded file: {e}")
    if not raw:
        raise HTTPException(400, "Uploaded file is empty.")
    try:
        df = ers.read_upload_bytes(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows, errors = ers.parse_events(df)
    if errors:
        return {"ok": False, "errors": errors, "row_count": 0}
    res = await ers.save_events(db, rows, source_filename=file.filename or "")
    return {"ok": True, "rows_saved": res["rows_saved"], "filename": file.filename}


@api_router.get("/events/{index}")
async def get_index_events(index: str):
    """
    Return the joined event list for the given index. Only events whose
    company is a current constituent of that index are returned.
    """
    key = (index or "").strip().upper()
    idx_code = _ACTIVE_INDEX_ALIASES.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown index '{index}'")
    events = await ers.fetch_events_for_index(db, idx_code)
    # Uploaded_at meta so the UI can show "last refreshed" etc.
    meta = await db.settings.find_one({"_id": "nse_events_meta"}) or {}
    return {
        "index": idx_code,
        "count": len(events),
        "events": events,
        "events_uploaded_at": meta.get("uploaded_at"),
        "events_source_filename": meta.get("source_filename"),
    }


@api_router.get("/constituents/{index}")
async def get_index_constituents(index: str):
    key = (index or "").strip().upper()
    idx_code = _ACTIVE_INDEX_ALIASES.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown index '{index}'")
    docs = await db.index_constituents.find(
        {"index": idx_code}, {"_id": 0}
    ).sort("weightage", -1).to_list(length=500)
    return {"index": idx_code, "count": len(docs), "constituents": docs}


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
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
logger.propagate = False


straddle_sampler_task = None

@app.on_event("startup")
async def _startup():
    # Initialize MongoDB client and db here to avoid creating connection objects at import time.
    global client, db
    try:
        mongo_url = os.environ['MONGO_URL']
        client = AsyncIOMotorClient(mongo_url)
        db = client[os.environ['DB_NAME']]
    except Exception as e:
        logger.exception(f"Failed to initialize MongoDB client: {e}")
        raise

    # Ensure indexes for fast history / retention queries.
    try:
        # Unique compound key prevents duplicate ticks for the same market sample.
        await db.oi_snapshots.create_index(
            [("index", 1), ("expiry", 1), ("timestamp", 1)],
            unique=True,
            name="uniq_index_expiry_ts",
        )
        await db.oi_snapshots.create_index([("index", 1), ("created_at", 1)])
        await db.oi_snapshots.create_index("created_at")
        await db.alerts.create_index([("index", 1), ("created_at", -1)])
        await db.straddle_samples.create_index([("index", 1), ("trade_date", 1), ("expiry", 1)])
        await db.straddle_samples.create_index([("index", 1), ("ts", 1)])
        await db.straddle_samples.create_index("created_at")
        await db.guest_sessions.create_index([("started_at", -1)])
        await db.guest_sessions.create_index("revoked_at")
        await db.admin_remember_devices.create_index("ip")
        await db.admin_remember_devices.create_index("expires_at")
        await db.guest_ip_names.create_index("updated_at")
    except Exception as e:
        logger.warning(f"index creation warn: {e}")

    global tracker
    _notifier_boot.set_db(db)
    tracker = OITracker(db)

    await tracker.load_credentials()
    await tracker.load_settings()
    await tracker.start()
    extra_tickers.attach_db(db)
    # Prefer Kite for GIFT NIFTY (NSEIX:GIFT NIFTY) + India VIX when LIVE.
    extra_tickers.attach_kite_provider(
        lambda: tracker.kite_service.kite if tracker and tracker.mode == "kite" and tracker.kite_service else None
    )
    await extra_tickers.start()
    global straddle_sampler_task
    straddle_sampler_task = asyncio.create_task(_straddle_sampler())

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
    await extra_tickers.stop()
    try:
        if client:
            client.close()
    except Exception:
        pass