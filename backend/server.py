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
import math
import time
from collections import defaultdict, deque
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta, date, time as dtime

# Delay motor client creation until startup to avoid heavy connection objects during import.
from motor.motor_asyncio import AsyncIOMotorClient

from oi_tracker import OITracker, INDICES, JsonLogFormatter
from oi_service import INDEX_CONFIG
from vrp_service import compute_vrp
from market_hours import (
    is_market_open, IST, MARKET_OPEN, is_holiday, is_weekend, display_hours, configure_hours,
    session_anchor_date, session_window_utc, previous_trading_day, now_ist,
)
from gift_vix_service import extra_tickers
from fii_dii_service import fii_dii
import event_risk_service as ers
from fastapi import UploadFile, File, Form

# cryptography import deferred inside _fernet() to reduce startup import cost
import base64, hashlib

def _fernet():
    # Import inside function so cryptography is loaded only when vault operations are used.
    # Prefer dedicated CREDENTIALS_FERNET_KEY / OI_VAULT_KEY (Fernet key or passphrase).
    # Fallback keeps legacy Mongo-derived key so existing vault rows still decrypt.
    from cryptography.fernet import Fernet
    explicit = (os.environ.get("CREDENTIALS_FERNET_KEY") or os.environ.get("OI_VAULT_KEY") or "").strip()
    if explicit:
        try:
            return Fernet(explicit.encode() if isinstance(explicit, str) else explicit)
        except Exception:
            key = base64.urlsafe_b64encode(hashlib.sha256(explicit.encode()).digest())
            return Fernet(key)
    seed = os.environ.get("MONGO_URL", "seed") + os.environ.get("DB_NAME", "db")
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
STRADDLE_SAMPLE_INTERVAL_SECONDS = int(os.environ.get("STRADDLE_SAMPLE_INTERVAL_SECONDS", "15"))  # dense chart default
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
# Guest sessions expire at next 06:00 IST (not a rolling hour TTL).
GUEST_DAILY_EXPIRY_HOUR_IST = int(os.environ.get("GUEST_DAILY_EXPIRY_HOUR_IST", "6"))
# Legacy env kept only as an absolute safety cap (default 36h).
GUEST_SESSION_TTL_SECONDS = int(os.environ.get("GUEST_SESSION_TTL_SECONDS", str(36 * 3600)))


def _next_6am_ist_utc(now_utc: Optional[datetime] = None) -> datetime:
    """Next 06:00 Asia/Kolkata as UTC. If already past today's 06:00, use tomorrow."""
    now = now_utc or datetime.now(timezone.utc)
    now_ist = now.astimezone(IST)
    target = now_ist.replace(
        hour=GUEST_DAILY_EXPIRY_HOUR_IST, minute=0, second=0, microsecond=0
    )
    if now_ist >= target:
        target = target + timedelta(days=1)
    return target.astimezone(timezone.utc)


def _guest_expiry_from_start(started: datetime) -> datetime:
    """First 06:00 IST strictly after session start (UTC-aware)."""
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    started_ist = started.astimezone(IST)
    target = started_ist.replace(
        hour=GUEST_DAILY_EXPIRY_HOUR_IST, minute=0, second=0, microsecond=0
    )
    if started_ist >= target:
        target = target + timedelta(days=1)
    return target.astimezone(timezone.utc)


def _guest_seconds_remaining(expires_at: datetime, now_utc: Optional[datetime] = None) -> int:
    now = now_utc or datetime.now(timezone.utc)
    return max(60, int((expires_at - now).total_seconds()))


BLOCKED_IP_MESSAGE = "Unable to process request at this moment"


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
    # Optional cap: force auto-logout at configured market close (DEFAULT OFF).
    expire_on_close = False
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


async def require_desk_user(request: Request):
    """Admin or approved guest — blocks fully anonymous callers."""
    if await _is_admin_request(request):
        return "admin"
    guest = await _guest_from_request(request)
    if guest:
        return "guest"
    raise HTTPException(401, "Sign in required")


def _sanitize_public_error(err: Optional[str]) -> Optional[str]:
    """Never echo raw Kite/API exceptions (may include key/token fragments) to guests."""
    if not err:
        return None
    low = str(err).lower()
    if any(k in low for k in ("token", "api_key", "api key", "secret", "unauthorized", "forbidden", "incorrect", "signature")):
        return "Kite authentication issue — admin must reconnect"
    return "Data feed temporarily unavailable"


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
    """Dense ATM straddle sampler for the intraday chart (FinanceDeft-style).

    Uses a lightweight 3-instrument quote (spot + ATM CE + PE) so we can sample
    every ~15s without re-pulling the full OI chain. Falls back to last OI
    snapshot when Kite is offline.
    """
    while True:
        try:
            try:
                poll_interval_seconds = int(
                    tracker.settings.get(
                        "straddle_poll_interval_seconds", STRADDLE_SAMPLE_INTERVAL_SECONDS
                    )
                )
            except Exception:
                poll_interval_seconds = STRADDLE_SAMPLE_INTERVAL_SECONDS
            poll_interval_seconds = max(5, min(30, int(poll_interval_seconds)))

            enabled = tracker.settings.get("straddle_enabled_indices") if tracker else None
            if not enabled:
                enabled = STRADDLE_INDICES

            if is_market_open() and tracker:
                svc = tracker._get_service() if hasattr(tracker, "_get_service") else None
                for idx in enabled:
                    if idx not in INDEX_CONFIG:
                        continue
                    try:
                        snap = None
                        exp = tracker.selected_expiry.get(idx)
                        if svc and hasattr(svc, "get_atm_straddle_quote"):
                            snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
                        if not snap:
                            snap = tracker.last_snapshot.get(idx)
                        if snap:
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


async def _market_day_poll_watchdog():
    """Keep OI Change / Open Interest / straddle DB writes alive on market days.

    Independent of any browser session — restarts a dead poller and forces a
    warm poll when the last successful tick exceeds the dynamic STALE window.
    """
    while True:
        try:
            if tracker:
                await tracker.ensure_market_day_polling()
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("market-day poll watchdog error: %s", e)
            await asyncio.sleep(30)


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
    ip = _client_ip(request)
    if await _is_ip_blocked(ip) or (sess.get("ip") and await _is_ip_blocked(sess.get("ip"))):
        try:
            await db.guest_sessions.update_one(
                {"_id": tok},
                {"$set": {
                    "revoked_at": datetime.now(timezone.utc).isoformat(),
                    "revoked_reason": "ip_blocked",
                }},
            )
        except Exception:
            pass
        return None
    try:
        started = datetime.fromisoformat(sess.get("started_at"))
    except Exception:
        return None
    now_utc = datetime.now(timezone.utc)
    # Prefer stored daily expiry (next 06:00 IST); legacy sessions fall back.
    expires_at = None
    raw_exp = sess.get("expires_at")
    if raw_exp:
        try:
            expires_at = datetime.fromisoformat(raw_exp)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        except Exception:
            expires_at = None
    if expires_at is None:
        try:
            expires_at = _guest_expiry_from_start(started)
        except Exception:
            expires_at = None
    if expires_at is not None and now_utc >= expires_at:
        return None
    # Absolute safety cap for very old sessions.
    if (now_utc - started).total_seconds() > GUEST_SESSION_TTL_SECONDS:
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


async def _is_ip_blocked(ip: Optional[str]) -> bool:
    if not ip:
        return False
    try:
        doc = await db.blocked_ips.find_one({"_id": ip})
        return bool(doc)
    except Exception:
        return False


async def _revoke_guests_for_ip(ip: str, reason: str = "ip_blocked"):
    if not ip:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        r = await db.guest_sessions.update_many(
            {"ip": ip, "revoked_at": {"$exists": False}},
            {"$set": {"revoked_at": now_iso, "revoked_reason": reason}},
        )
        return int(getattr(r, "modified_count", 0) or 0)
    except Exception:
        return 0


async def _pending_access_count() -> int:
    try:
        return int(await db.access_requests.count_documents({"status": "pending"}))
    except Exception:
        return 0


async def _create_guest_session(name: str, ip: Optional[str], ua: str, *, request_id: Optional[str] = None) -> dict:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires_at = _next_6am_ist_utc(now)
    expires_iso = expires_at.isoformat()
    doc = {
        "_id": token,
        "name": name,
        "ip": ip,
        "user_agent": ua,
        "started_at": now_iso,
        "last_seen_at": now_iso,
        "expires_at": expires_iso,
    }
    if request_id:
        doc["access_request_id"] = request_id
    await db.guest_sessions.insert_one(doc)
    if ip:
        try:
            await db.guest_ip_names.update_one(
                {"_id": ip},
                {
                    "$set": {
                        "name": name,
                        "updated_at": now_iso,
                        "last_token": token,
                        "opted_out": False,
                        "ever_approved": True,
                        "requires_reapproval": False,
                    },
                    "$unset": {"opted_out_at": ""},
                },
                upsert=True,
            )
        except Exception:
            pass
    return {
        "token": token,
        "name": name,
        "expires_in_seconds": _guest_seconds_remaining(expires_at, now),
        "expires_at": expires_iso,
        "started_at": now_iso,
    }


# ------------------- Models -------------------
class CredentialsIn(BaseModel):
    api_key: str
    access_token: str


class AccessTokenOnlyIn(BaseModel):
    access_token: str


class ModeIn(BaseModel):
    mode: str  # "kite" | "offline"


DASHBOARD_PAGE_KEYS = {
    "oi-change", "open-interest", "strike-table", "sell-candidates",
    "buildup", "positions", "alerts", "activity", "holidays",
    "straddle", "index-events", "cas",
}

class SettingsIn(BaseModel):
    threshold_pct: Optional[float] = None
    cooldown_seconds: Optional[int] = None
    compare_minutes: Optional[int] = None
    enabled_indices: Optional[List[str]] = None
    oi_poll_interval_seconds: Optional[int] = None  # OI data pull interval (15/30/60)
    straddle_poll_interval_seconds: Optional[int] = None  # Straddle data pull interval (60 = 1 min)
    positions_poll_interval_seconds: Optional[int] = None  # Positions desk auto-refresh (5–3600s)
    straddle_enabled_indices: Optional[List[str]] = None  # Which indices to track for straddle
    visible_pages: Optional[List[str]] = None
    market_open_ist: Optional[str] = None   # e.g. "09:15"
    market_close_ist: Optional[str] = None  # e.g. "15:40" (Index F&O / CAS)
    second_session_ist: Optional[str] = None  # e.g. "12:00" BigClock 2nd-session notify
    expire_admin_on_market_close: Optional[bool] = None
    admin_session_ttl_minutes: Optional[int] = None
    alert_enabled_indices: Optional[List[str]] = None  # weekday-defaulted alert focus
    show_strike_range: Optional[bool] = None  # sidebar Strike Range steppers
    show_writer_defense: Optional[bool] = None  # Writer Defense map on Open Interest tab
    show_suggestion: Optional[bool] = None  # Suggestion window under right panel
    show_chart_signals: Optional[bool] = None  # Gamma wall / institution CE·PE chips under OI Change chart


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


class VaultIn(BaseModel):
    """Persist or clear long-lived Kite API key / secret (Fernet-encrypted)."""
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    clear_api_key: Optional[bool] = False
    clear_api_secret: Optional[bool] = False


@api_router.get("/")
async def root():
    return {"message": "NSE OI Tracker API", "indices": list(INDEX_CONFIG.keys())}


@api_router.get("/status")
async def get_status(request: Request):
    # Best-effort bulletin probe (cached, non-blocking) so maintenance surfaces in-app.
    async def _probe_bulletin():
        try:
            from kite_maintenance import fetch_bulletin_notice, merge_maintenance

            bulletin = await asyncio.to_thread(fetch_bulletin_notice)
            tracker.kite_maintenance = merge_maintenance(
                tracker.kite_maintenance,
                bulletin=bulletin,
            )
        except Exception:
            pass

    try:
        asyncio.create_task(_probe_bulletin())
    except Exception:
        pass
    status = await tracker.get_status()
    # Guests / anonymous never receive raw Kite exception text (may contain key fragments).
    if not await _is_admin_request(request):
        status = dict(status)
        status["last_error"] = _sanitize_public_error(status.get("last_error"))
        status.pop("metrics", None)
        # Kite user id is admin-only (shows on Kite API button).
        status.pop("kite_user_id", None)
    return status


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


@api_router.post("/credentials/access-token")
async def set_access_token_only(payload: AccessTokenOnlyIn, _admin: bool = Depends(require_admin)):
    """Update daily access_token using the Fernet-vaulted api_key (no re-entry)."""
    doc = await db.credentials.find_one({"_id": "kite"})
    api_key = None
    try:
        if doc and doc.get("api_key_enc"):
            api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
        elif doc and doc.get("api_key"):
            api_key = doc.get("api_key")
    except Exception:
        api_key = None
    if not api_key:
        raise HTTPException(400, "No stored API key — enter api_key once, then paste access_token.")
    token = str(payload.access_token or "").strip()
    if not token:
        raise HTTPException(400, "access_token required")
    try:
        await tracker.set_credentials(api_key, token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    # Always vault key + secret (Fernet) so daily login needs only request_token.
    if payload.remember is not False:
        enc_secret = _fernet().encrypt(payload.api_secret.encode()).decode()
        enc_key = _fernet().encrypt(payload.api_key.encode()).decode()
        uid = data.get("user_id")
        await db.credentials.update_one(
            {"_id": "kite"},
            {
                "$set": {
                    "api_secret_enc": enc_secret,
                    "api_key_enc": enc_key,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    **({"kite_user_id": str(uid)} if uid else {}),
                },
                "$unset": {"api_key": "", "access_token": ""},
            },
            upsert=True,
        )
    if data.get("user_id"):
        tracker.kite_user_id = str(data.get("user_id"))
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id"), "remembered": payload.remember is not False}


@api_router.get("/kite/vault")
async def vault_status(_admin: bool = Depends(require_admin)):
    """Vault status for the credentials modal — never returns plaintext secret."""
    doc = await db.credentials.find_one(
        {"_id": "kite"},
        {"_id": 0, "api_key_enc": 1, "api_secret_enc": 1, "api_key": 1, "updated_at": 1},
    )
    api_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                api_key = doc.get("api_key")
        except Exception:
            api_key = None
    has_secret = bool(doc and doc.get("api_secret_enc"))
    # Login URL is built server-side (admin-only). Secret never leaves the vault.
    login_url = (
        f"https://kite.zerodha.com/connect/login?v=3&api_key={api_key}"
        if api_key
        else None
    )
    return {
        "has_api_key": bool(api_key),
        "has_api_secret": has_secret,
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
        "api_secret_hint": "••••••••" if has_secret else None,
        "login_url": login_url,
        "updated_at": doc.get("updated_at") if doc else None,
        "storage": "fernet",
    }


@api_router.post("/kite/vault")
async def vault_save(payload: VaultIn, _admin: bool = Depends(require_admin)):
    """Save or clear long-lived api_key / api_secret (Fernet ciphertext in Mongo).

    Rotating api_key invalidates the stored access_token — a token is bound to
    the app key that issued it. Keeping the old token with a new key produces
    TokenException: Incorrect api_key or access_token on every Kite call.
    """
    unset: dict = {}
    sets: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    needs_reauth = False

    doc = await db.credentials.find_one({"_id": "kite"})
    old_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                old_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                old_key = doc.get("api_key")
        except Exception:
            old_key = None

    if payload.clear_api_key:
        unset["api_key_enc"] = ""
        unset["api_key"] = ""
        unset["access_token_enc"] = ""
        unset["access_token"] = ""
        needs_reauth = True
    elif payload.api_key is not None:
        key = str(payload.api_key).strip()
        if not key:
            raise HTTPException(400, "api_key cannot be empty")
        sets["api_key_enc"] = _fernet().encrypt(key.encode()).decode()
        unset["api_key"] = ""
        if old_key and key != old_key:
            # New app key cannot use the previous access_token.
            unset["access_token_enc"] = ""
            unset["access_token"] = ""
            needs_reauth = True

    if payload.clear_api_secret:
        unset["api_secret_enc"] = ""
    elif payload.api_secret is not None:
        secret = str(payload.api_secret).strip()
        if not secret:
            raise HTTPException(400, "api_secret cannot be empty")
        sets["api_secret_enc"] = _fernet().encrypt(secret.encode()).decode()

    if len(sets) == 1 and not unset:
        raise HTTPException(400, "Nothing to update")

    update: dict = {"$set": sets}
    if unset:
        update["$unset"] = unset
    await db.credentials.update_one({"_id": "kite"}, update, upsert=True)

    if needs_reauth and tracker is not None:
        tracker.kite_service = None
        tracker.mode = "offline"
        tracker.offline_sticky = True
        tracker.last_error = (
            "API key updated — complete Kite login (request_token) or paste a "
            "fresh access_token to go live."
        )

    status = await vault_status(_admin=True)
    status["needs_reauth"] = needs_reauth
    return status


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
        raise HTTPException(400, "No stored api_key/api_secret — save them once in Credentials first.")
    try:
        api_secret = _fernet().decrypt(doc["api_secret_enc"].encode()).decode()
    except Exception:
        raise HTTPException(400, "Stored api_secret could not be decrypted — re-enter API secret.")
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=api_key)
        data = kc.generate_session(payload.request_token, api_secret=api_secret)
        access_token = data.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned by Kite")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await tracker.set_credentials(api_key, access_token)
    except Exception as e:
        raise HTTPException(400, str(e))
    if data.get("user_id"):
        tracker.kite_user_id = str(data.get("user_id"))
        try:
            await db.credentials.update_one(
                {"_id": "kite"},
                {"$set": {"kite_user_id": tracker.kite_user_id}},
                upsert=True,
            )
        except Exception:
            pass
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id")}


@api_router.delete("/kite/vault")
async def clear_vault(_admin: bool = Depends(require_admin)):
    """Sign out of the broker — wipe vaulted Kite credentials and go offline."""
    await db.credentials.update_one(
        {"_id": "kite"},
        {
            "$unset": {
                "api_key_enc": "",
                "access_token_enc": "",
                "api_secret_enc": "",
                "api_key": "",
                "access_token": "",
                "kite_user_id": "",
            }
        },
    )
    if tracker is not None:
        tracker.kite_service = None
        tracker.mode = "offline"
        tracker.kite_user_id = None
        tracker.kite_maintenance = None
        tracker.offline_sticky = True
        tracker.last_error = "Kite signed out — connect again to go live."
    return {"ok": True, "mode": "offline"}


@api_router.get("/credentials/status")
async def credentials_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one(
        {"_id": "kite"},
        {"_id": 0, "api_key_enc": 1, "api_key": 1, "api_secret_enc": 1, "updated_at": 1},
    )
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
        "has_api_secret": bool(doc and doc.get("api_secret_enc")),
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
        "updated_at": doc.get("updated_at") if doc else None,
        "storage": "fernet",
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
                logger.exception("get_current_oi live fetch failed for %s", idx)
                raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")
    if not snap:
        raise HTTPException(503, "No data yet")
    return snap


@api_router.get("/expiries/{index_name}")
async def get_expiries(index_name: str):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    # Best-effort: roll past selections + refresh instruments once/day.
    try:
        await tracker.ensure_instruments_fresh()
    except Exception:
        pass
    all_dates = tracker.list_expiries(idx)

    # Cap to the first 8 nearest unexpired (Kite instrument list can span
    # multiple years of monthlies which drowns the UI).
    from datetime import date as _date, datetime as _datetime
    today = now_ist().date()
    parsed = []
    for d in all_dates:
        try:
            parsed.append(
                _datetime.fromisoformat(d).date()
                if "T" in str(d)
                else _date.fromisoformat(str(d)[:10])
            )
        except Exception:
            continue
    parsed = sorted({p for p in parsed if p >= today})[:8]
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

    selected = tracker.selected_expiry.get(idx)
    # If tracker still points at a past / missing expiry, surface the nearest live one.
    if selected not in dates:
        selected = dates[0] if dates else None
        if selected:
            try:
                tracker.set_expiry(idx, selected)
            except Exception:
                pass

    return {
        "index": idx,
        "expiries": dates,
        "expiries_meta": meta,
        "selected": selected,
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
    # Keep weekday alert focus in sync (same as /config) so the desk never
    # reads a stale/null alert_enabled_indices and suppresses toasts.
    try:
        tracker._refresh_alert_indices_for_today()
    except Exception:
        pass
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
        if not patch["alert_enabled_indices"]:
            raise HTTPException(400, "At least one alert index is required")
        for i in patch["alert_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown alert index: {i}")
    if "straddle_enabled_indices" in patch:
        for i in patch["straddle_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown straddle index: {i}")
    if "visible_pages" in patch:
        admin_only = {"positions", "sell-candidates", "index-events"}
        pages = [p for p in (patch["visible_pages"] or []) if p not in admin_only]
        if not pages:
            raise HTTPException(400, "At least one public dashboard page is required")
        for p in pages:
            if p not in DASHBOARD_PAGE_KEYS:
                raise HTTPException(400, f"Unknown dashboard page: {p}")
        patch["visible_pages"] = pages
    if "oi_poll_interval_seconds" in patch:
        if int(patch["oi_poll_interval_seconds"]) not in (15, 30, 60):
            raise HTTPException(400, "oi_poll_interval_seconds must be 15, 30, or 60")
    if "straddle_poll_interval_seconds" in patch:
        if int(patch["straddle_poll_interval_seconds"]) not in (15, 30, 60, 120):
            raise HTTPException(400, "straddle_poll_interval_seconds must be 15, 30, 60, or 120")
    if "positions_poll_interval_seconds" in patch:
        v = int(patch["positions_poll_interval_seconds"])
        if v < 5 or v > 3600:
            raise HTTPException(400, "positions_poll_interval_seconds must be between 5 and 3600")
        patch["positions_poll_interval_seconds"] = v
    for key in ("market_open_ist", "market_close_ist", "second_session_ist"):
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


def _session_elapsed_minutes(current_ts: str) -> int:
    """Minutes from session open (clamped) to the snapshot timestamp — for whole-day bias."""
    try:
        anchor = datetime.fromisoformat(current_ts)
    except Exception:
        anchor = datetime.now(timezone.utc)
    session_open = _session_open_utc_for_anchor(anchor)
    elapsed = max(1.0, (anchor - session_open).total_seconds() / 60.0)
    return min(1440, int(math.ceil(elapsed)))


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


def _stale_threshold_seconds() -> int:
    """Dynamic STALE threshold from poll cadence (avoids false STALE between ticks)."""
    try:
        if tracker and hasattr(tracker, "stale_after_seconds"):
            return int(tracker.stale_after_seconds())
    except Exception:
        pass
    return 90


def _build_data_status(current: dict, market_is_open: bool, age_seconds: Optional[float]) -> dict:
    """Truth layer for clients: LIVE vs LAST SESSION vs OFFLINE — never ambiguous."""
    mode = tracker.mode if tracker else "offline"
    thr = _stale_threshold_seconds()
    stale_reason = None
    is_live = False
    if mode != "kite":
        stale_reason = "missing_kite_credentials"
    elif not market_is_open:
        stale_reason = "market_closed"
    elif age_seconds is None:
        stale_reason = "no_timestamp"
    elif age_seconds > thr:
        stale_reason = "stale_cache"
    else:
        is_live = True

    data_date = None
    as_of = None
    as_of_ist = None
    try:
        if current and current.get("timestamp"):
            as_of = current["timestamp"]
            ts = datetime.fromisoformat(current["timestamp"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            ist_ts = ts.astimezone(IST)
            data_date = ist_ts.date().isoformat()
            as_of_ist = ist_ts.strftime("%H:%M:%S")
    except Exception:
        data_date = None
        as_of_ist = None

    if is_live:
        label = "LIVE"
    elif mode != "kite":
        label = "OFFLINE"
    elif not market_is_open:
        label = "LAST_SESSION"
    else:
        label = "STALE"

    return {
        "is_live": is_live,
        "stale_reason": stale_reason,
        "data_date": data_date,
        "cache_age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "stale_after_seconds": thr,
        "as_of": as_of,
        "as_of_ist": as_of_ist,
        "label": label,
        "market_open": bool(market_is_open),
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
    # Also accepts the token "session" → lookback from today's session open
    # (whole-day bias for the sentiment bar — independent of the UI timeframe pill).
    also_windows: Dict[str, Any] = {}
    if also:
        extra_mins = []
        want_session = False
        for part in also.split(","):
            part = part.strip()
            if not part:
                continue
            if part.lower() == "session":
                want_session = True
                continue
            try:
                m = int(part)
                if 1 <= m <= 1440 and m != minutes:
                    extra_mins.append(m)
            except ValueError:
                continue
        if want_session:
            sess_m = _session_elapsed_minutes(current_ts)
            if sess_m != minutes:
                extra_mins.append(sess_m)
            # Always expose under stable key "session" for the frontend.
            p, ready, avail = await _find_previous_snapshot(idx, current_ts, sess_m, expiry)
            also_windows["session"] = {
                "previous": p,
                "minutes": sess_m,
                "history_ready": ready,
                "available_history_minutes": avail,
                "label": "session",
            }
        # Deduplicate while preserving order
        seen = set()
        for m in extra_mins:
            if m in seen:
                continue
            seen.add(m)
            # Skip if we already stored this as session with same minutes
            if also_windows.get("session", {}).get("minutes") == m:
                continue
            p, ready, avail = await _find_previous_snapshot(idx, current_ts, m, expiry)
            also_windows[str(m)] = {
                "previous": p,
                "minutes": m,
                "history_ready": ready,
                "available_history_minutes": avail,
            }

    # If caller didn't ask for session, still attach it — cheap (one extra DB read)
    # and keeps whole-day bias available on every change response.
    if "session" not in also_windows:
        sess_m = _session_elapsed_minutes(current_ts)
        p, ready, avail = await _find_previous_snapshot(idx, current_ts, sess_m, expiry)
        also_windows["session"] = {
            "previous": p,
            "minutes": sess_m,
            "history_ready": ready,
            "available_history_minutes": avail,
            "label": "session",
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
    """Return OI snapshot history for Replay.

    While the market is open: last `minutes` of wall-clock time.
    When closed (post-close / weekend / holiday / pre-open): serve the
    last trading session (session_anchor_date), optionally trimmed to the
    last `minutes` of that session so weekend users still see Friday's data.
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    now_utc = datetime.now(timezone.utc)
    market_open = is_market_open()

    if market_open:
        cutoff = (now_utc - timedelta(minutes=minutes)).isoformat()
        docs = await db.oi_snapshots.find(
            {"index": idx, "timestamp": {"$gte": cutoff, "$lte": now_utc.isoformat()}},
            {"_id": 0},
        ).sort("timestamp", 1).to_list(length=5000)
        return {
            "index": idx,
            "count": len(docs),
            "history": docs,
            "session_anchor_date": session_anchor_date().isoformat(),
            "source": "live_window",
        }

    # Closed: resolve last trading session and serve that day's ticks.
    anchor = session_anchor_date()
    start_utc, end_utc = session_window_utc(anchor)
    # If post-close same day, end at now (final tick may be slightly after display close).
    if end_utc > now_utc:
        end_utc = now_utc
    query = {
        "index": idx,
        "timestamp": {"$gte": start_utc.isoformat(), "$lte": end_utc.isoformat()},
    }
    docs = await db.oi_snapshots.find(query, {"_id": 0}).sort("timestamp", 1).to_list(length=5000)

    # Trim to last N minutes of the session if requested window is shorter than the full day.
    if docs and minutes < 24 * 60:
        try:
            last_ts = datetime.fromisoformat(docs[-1]["timestamp"].replace("Z", "+00:00"))
            trim_from = (last_ts - timedelta(minutes=minutes)).isoformat()
            docs = [d for d in docs if d.get("timestamp", "") >= trim_from]
        except Exception:
            pass

    # Absolute fallback: most recent snapshots in retention window.
    if not docs:
        cutoff = (now_utc - timedelta(hours=96)).isoformat()
        docs = await db.oi_snapshots.find(
            {"index": idx, "timestamp": {"$gte": cutoff}},
            {"_id": 0},
        ).sort("timestamp", 1).to_list(length=5000)

    return {
        "index": idx,
        "count": len(docs),
        "history": docs,
        "session_anchor_date": anchor.isoformat(),
        "source": "last_session",
    }


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


@api_router.get("/straddle/{index_name}/tick")
async def get_straddle_tick(index_name: str, expiry: Optional[str] = None):
    """Lightweight ATM straddle tick for the intraday chart (spot + CE + PE)."""
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    try:
        interval = max(5, min(30, int(tracker.settings.get("straddle_poll_interval_seconds", 15))))
    except Exception:
        interval = 15

    # Prefer sampler cache when fresh — avoids N clients × Kite quotes.
    cached_q = getattr(tracker, "last_straddle_quote", {}).get(idx)
    if cached_q:
        ts = _parse_straddle_ts(cached_q.get("ts"))
        age = (datetime.now(timezone.utc) - ts).total_seconds() if ts else 9999
        if age <= interval + 2 and (not expiry or cached_q.get("expiry") == expiry):
            return {
                "index": idx,
                "ts": cached_q.get("ts") or datetime.now(timezone.utc).isoformat(),
                "atm": cached_q.get("atm"),
                "underlying": cached_q.get("underlying"),
                "strike": cached_q.get("atm"),
                "ce_ltp": cached_q.get("ce_ltp"),
                "pe_ltp": cached_q.get("pe_ltp"),
                "premium": cached_q.get("premium"),
                "expiry": cached_q.get("expiry"),
                "cached": True,
            }

    snap = None
    try:
        svc = tracker._get_service()
        exp = expiry or tracker.selected_expiry.get(idx)
        if svc and hasattr(svc, "get_atm_straddle_quote"):
            snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
        if not snap:
            cached = tracker.last_snapshot.get(idx)
            if cached and (not expiry or cached.get("expiry") == expiry):
                snap = cached
    except Exception as e:
        logger.exception("get_straddle_tick failed for %s", idx)
        raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")

    if not snap:
        raise HTTPException(503, "No data yet for straddle")

    atm = int(snap.get("atm") or 0)
    price = float(snap.get("price") or 0.0)
    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None:
        ce_p = float(snap.get("ce_ltp") or 0)
        pe_p = float(snap.get("pe_ltp") or 0)
    else:
        strike_obj = None
        for s in snap.get("strikes", []):
            if int(s.get("strike")) == atm:
                strike_obj = s
                break
        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
    premium = round(ce_p + pe_p, 2)
    try:
        await _persist_straddle_sample(idx, {
            **snap,
            "atm": atm,
            "price": price,
            "ce_ltp": ce_p,
            "pe_ltp": pe_p,
            "premium": premium,
        })
    except Exception:
        pass
    return {
        "index": idx,
        "ts": datetime.now(timezone.utc).isoformat(),
        "atm": atm,
        "underlying": round(price, 2),
        "strike": atm,
        "ce_ltp": round(ce_p, 2),
        "pe_ltp": round(pe_p, 2),
        "premium": premium,
        "expiry": snap.get("expiry"),
    }


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
            if not svc:
                # Fall back to DB cache when offline / no live client.
                doc = await db.oi_snapshots.find_one(
                    {"index": idx, **({"expiry": expiry} if expiry else {})},
                    sort=[("timestamp", -1)],
                    projection={"_id": 0},
                )
                if doc:
                    snap = doc
                else:
                    raise HTTPException(503, "No data yet for straddle calculation")
            else:
                # Prefer lightweight ATM quote for premium; fall back to full chain.
                if hasattr(svc, "get_atm_straddle_quote"):
                    snap = await asyncio.to_thread(
                        svc.get_atm_straddle_quote, idx, expiry or tracker.selected_expiry.get(idx)
                    )
                if not snap:
                    snap = await asyncio.to_thread(svc.get_snapshot, idx, expiry or tracker.selected_expiry.get(idx))
                if snap:
                    snap["mode"] = tracker.mode
                    if snap.get("strikes") and len(snap.get("strikes") or []) > 1:
                        tracker.last_snapshot[idx] = snap
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("get_straddle live fetch failed for %s", idx)
            raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")

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
        strikes_list = sorted([int(s.get("strike")) for s in snap.get("strikes", []) if s.get("strike") is not None])
        if strikes_list:
            closest = min(strikes_list, key=lambda x: abs(x - atm))
            for s in snap.get("strikes", []):
                if int(s.get("strike")) == closest:
                    strike_obj = s
                    atm = closest
                    break

    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None and not strike_obj:
        ce_p = float(snap.get("ce_ltp") or 0)
        pe_p = float(snap.get("pe_ltp") or 0)
    else:
        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else snap.get("ce_ltp") or 0)
        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else snap.get("pe_ltp") or 0)
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
    return previous_trading_day(now_ist)


def _resolve_straddle_trade_date(requested_date: Optional[str] = None) -> date:
    now = datetime.now(IST)
    if requested_date and requested_date not in ("auto", "latest"):
        try:
            return date.fromisoformat(requested_date)
        except ValueError:
            raise HTTPException(400, "Invalid date format for trade_date; expected YYYY-MM-DD")
    # Weekend / holiday / pre-open → last completed session.
    # Open or post-close on a trading day → today.
    return session_anchor_date(now)


def _parse_straddle_ts(value) -> Optional[datetime]:
    """Parse a straddle sample timestamp into an aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # ms vs seconds heuristic
        ts = float(value)
        if ts > 1e12:
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _filter_straddle_session_docs(docs: list, trade_date: date) -> list:
    """Keep only samples inside the NSE session (09:15–15:40 IST) for trade_date.

    Drops overnight / prior-close points that would otherwise draw a diagonal
    gap on the intraday straddle chart. Allows a 1-minute pre-open poll tick
    (09:14) and clamps it to 09:15 so the series starts at market open.
    """
    start_utc, end_utc = session_window_utc(trade_date)
    # session_window_utc end is close-1min from poll close; prefer explicit 15:40 display close.
    end_utc = datetime.combine(trade_date, dtime(15, 40), IST).astimezone(timezone.utc)
    preopen_utc = start_utc - timedelta(minutes=1)
    out = []
    for doc in docs or []:
        ts = _parse_straddle_ts(doc.get("ts") or doc.get("created_at"))
        if ts is None:
            continue
        if ts < preopen_utc or ts > end_utc:
            continue
        if ts < start_utc:
            clamped = dict(doc)
            clamped["ts"] = start_utc.isoformat()
            out.append(clamped)
        else:
            out.append(doc)
    return out


@api_router.get("/straddle/{index_name}/history")
async def get_straddle_history(index_name: str, minutes: Optional[int] = Query(None, ge=1, le=24*60), expiry: Optional[str] = None, date: Optional[str] = None):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    target_date = _resolve_straddle_trade_date(date)
    query = {"index": idx, "trade_date": target_date.isoformat()}
    if expiry:
        query["expiry"] = expiry
    # Only apply a rolling wall-clock minutes filter while the market is open.
    # On weekends/holidays/post-close, return the full last-session samples.
    if minutes is not None and minutes < 24 * 60 and is_market_open():
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        query["created_at"] = {"$gte": cutoff}
    docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=(minutes * 120) if minutes else 5000)

    # Expiry mismatch (UI pin vs sampler) — still return today's series so the
    # chart is not empty / 2-point sparse while ATM rolls.
    if not docs and expiry:
        relaxed = {k: v for k, v in query.items() if k != "expiry"}
        docs = await db.straddle_samples.find(relaxed, {"_id": 0}).sort("ts", 1).to_list(length=5000)

    # If empty (weekend/holiday after 09:14, or missing samples), fall back to previous trading day.
    if not docs and date is None:
        previous_date = _previous_trading_day(datetime.now(IST))
        if previous_date.isoformat() != query.get("trade_date"):
            query["trade_date"] = previous_date.isoformat()
            query.pop("created_at", None)
            docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=5000)
            if not docs and expiry:
                relaxed = {k: v for k, v in query.items() if k != "expiry"}
                docs = await db.straddle_samples.find(relaxed, {"_id": 0}).sort("ts", 1).to_list(length=5000)
            target_date = previous_date

    # Intraday chart only — never return overnight / prior-close points.
    docs = _filter_straddle_session_docs(docs, target_date)

    return {"index": idx, "trade_date": target_date.isoformat(), "count": len(docs), "history": docs}


@api_router.websocket("/ws/straddle/{index_name}")
async def ws_straddle(websocket: WebSocket, index_name: str, expiry: Optional[str] = None, position: str = Query("long"), qty: int = Query(1)):
    """Public WebSocket streaming ATM straddle premium for the intraday chart.

    Message format: { ts, premium, underlying, atm, ce_ltp, pe_ltp }
    No credentials in payloads. Optional admin_token is accepted but not required
    — straddle is a public page (same as FinanceDeft).
    """
    await websocket.accept()
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        await websocket.close(code=1003)
        return

    # Optional session bump (admin); guests/anonymous still get the public feed.
    try:
        qs = websocket.scope.get("query_string", b"").decode()
        params = dict((pair.split("=", 1) if "=" in pair else (pair, "")) for pair in qs.split("&") if pair)
        token = (params.get("admin_token") or params.get("token") or "").strip()
        if token:
            sess = await db.admin_sessions.find_one({"_id": token})
            if sess:
                try:
                    await db.admin_sessions.update_one(
                        {"_id": token},
                        {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}},
                    )
                except Exception:
                    pass
    except Exception:
        pass

    try:
        while True:
            try:
                poll_interval_seconds = max(
                    5,
                    min(30, int(tracker.settings.get("straddle_poll_interval_seconds", 15))),
                )
                from market_hours import is_market_open as is_market_open_fn
                if not is_market_open_fn(datetime.now(IST)):
                    await websocket.send_json({"status": "market_closed"})
                    await asyncio.sleep(60)
                    continue

                snap = None
                svc = tracker._get_service()
                exp = expiry or tracker.selected_expiry.get(idx)
                # Prefer fresh sampler cache — one Kite quote path for all WS clients.
                cached_q = getattr(tracker, "last_straddle_quote", {}).get(idx)
                if cached_q:
                    ts = _parse_straddle_ts(cached_q.get("ts"))
                    age = (datetime.now(timezone.utc) - ts).total_seconds() if ts else 9999
                    if age <= poll_interval_seconds + 2 and (not expiry or cached_q.get("expiry") == expiry):
                        await websocket.send_json({
                            "ts": cached_q.get("ts") or datetime.now(timezone.utc).isoformat(),
                            "premium": cached_q.get("premium"),
                            "underlying": cached_q.get("underlying"),
                            "atm": cached_q.get("atm"),
                            "ce_ltp": cached_q.get("ce_ltp"),
                            "pe_ltp": cached_q.get("pe_ltp"),
                            "expiry": cached_q.get("expiry"),
                        })
                        await asyncio.sleep(poll_interval_seconds)
                        continue

                if svc and hasattr(svc, "get_atm_straddle_quote"):
                    try:
                        snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
                    except Exception:
                        snap = None
                if not snap or (expiry and snap.get("expiry") != expiry):
                    cached = tracker.last_snapshot.get(idx)
                    if cached and (not expiry or cached.get("expiry") == expiry):
                        snap = cached

                if snap:
                    atm = int(snap.get("atm") or 0)
                    price = float(snap.get("price") or 0.0)
                    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None:
                        ce_p = float(snap.get("ce_ltp") or 0)
                        pe_p = float(snap.get("pe_ltp") or 0)
                    else:
                        strike_obj = None
                        for s in snap.get("strikes", []):
                            if int(s.get("strike")) == atm:
                                strike_obj = s
                                break
                        if not strike_obj and snap.get("strikes"):
                            strikes_list = sorted(
                                [int(s.get("strike")) for s in snap.get("strikes", []) if s.get("strike") is not None]
                            )
                            if strikes_list:
                                closest = min(strikes_list, key=lambda x: abs(x - atm))
                                for s in snap.get("strikes", []):
                                    if int(s.get("strike")) == closest:
                                        strike_obj = s
                                        atm = closest
                                        break
                        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
                        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
                    premium = round(ce_p + pe_p, 2)
                    payload = {
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "premium": premium,
                        "underlying": round(price, 2),
                        "atm": atm,
                        "ce_ltp": round(ce_p, 2),
                        "pe_ltp": round(pe_p, 2),
                        "expiry": snap.get("expiry"),
                    }
                    try:
                        await _persist_straddle_sample(idx, {
                            **snap,
                            "atm": atm,
                            "price": price,
                            "ce_ltp": ce_p,
                            "pe_ltp": pe_p,
                            "premium": premium,
                        })
                    except Exception:
                        logger.warning("ws_straddle: sample persistence failed for %s", idx, exc_info=True)
                    await websocket.send_json(payload)
                else:
                    await websocket.send_json({"error": "no_snapshot"})
            except Exception:
                try:
                    await websocket.send_json({"error": "temporarily_unavailable"})
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
    """Return alerts for the active board session only.

    Uses session_anchor_date so weekend/holiday views stay on the last session,
    and a new trading day no longer surfaces prior-day alerts.
    Filtered to the current admin alert-focus indices when set.
    """
    try:
        anchor = session_anchor_date()
        start_utc, _ = session_window_utc(anchor)
        query = {"created_at": {"$gte": start_utc.isoformat()}}
        try:
            if tracker:
                tracker._refresh_alert_indices_for_today()
                focus = tracker.settings.get("alert_enabled_indices") or []
                if isinstance(focus, str):
                    focus = [focus]
                elif not isinstance(focus, (list, tuple)):
                    focus = []
                focus = [str(x) for x in focus if x]
                if not focus:
                    # Never treat blank focus as "alert nobody".
                    from market_hours import default_alert_indices_for_today
                    focus = list(default_alert_indices_for_today() or [])
                if focus:
                    query["index"] = {"$in": focus}
        except Exception:
            pass
        docs = await db.alerts.find(
            query,
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=limit)
    except Exception:
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
    positions_poll = max(1, int(tracker.settings.get("positions_poll_interval_seconds", 30)))
    open_hm, close_hm = display_hours()
    return {
        "indices": INDEX_CONFIG,
        "poll_interval_seconds": poll_interval_seconds,
        "oi_poll_interval_seconds": poll_interval_seconds,
        "straddle_poll_interval_seconds": straddle_poll,
        "positions_poll_interval_seconds": positions_poll,
        "enabled_indices": tracker.settings.get("enabled_indices", list(INDEX_CONFIG.keys())),
        "straddle_enabled_indices": tracker.settings.get("straddle_enabled_indices", STRADDLE_INDICES),
        "alert_enabled_indices": tracker.settings.get("alert_enabled_indices"),
        "visible_pages": tracker.settings.get("visible_pages"),
        "market_open_ist": tracker.settings.get("market_open_ist", open_hm),
        "market_close_ist": tracker.settings.get("market_close_ist", close_hm),
        "second_session_ist": tracker.settings.get("second_session_ist", "12:00"),
        "show_strike_range": bool(tracker.settings.get("show_strike_range", False)),
        "show_writer_defense": bool(tracker.settings.get("show_writer_defense", True)),
        "show_suggestion": bool(tracker.settings.get("show_suggestion", True)),
        "show_chart_signals": bool(tracker.settings.get("show_chart_signals", False)),
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
    # Do NOT auto-close public access on admin login — that silently undid the
    # admin's Public access toggle and made "Continue as guest" fail with
    # "Ask Admin to give access" even when they had just turned it ON.

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
        # Soft-fail: keep the remember token (IP can change on mobile/CGNAT).
        # Only reject this attempt — do not delete the device record.
        ua = (request.headers.get("user-agent") or "")[:200]
        stored_ua = (doc.get("user_agent") or "")[:200]
        if not stored_ua or stored_ua != ua:
            raise HTTPException(401, "Remember token not valid for this device/IP")
        # UA matches → allow (IP drifted but same browser profile)
        logger.info("remember-login: IP changed (%s → %s) but UA matched — allowing", doc.get("ip"), ip)
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
    """Guest access entry.

    • New IP/name → pending until admin approves.
    • Returning guest (same IP + name already approved) → mint session immediately
      (no second approval), unless admin explicitly removed them (requires_reapproval).
    • Blocked IP → soft refusal message.
    """
    open_, _ = await _get_public_access_state()
    if not open_:
        raise HTTPException(403, "Public access is not open. Please ask the admin to give access.")
    name = (payload.name or "").strip()
    if len(name) < 2 or len(name) > 100:
        raise HTTPException(400, "Please enter your full name (2–100 chars).")
    if " " not in name:
        raise HTTPException(400, "Please enter your FULL name (first name + last name).")
    ip = _client_ip(request)
    if await _is_ip_blocked(ip):
        raise HTTPException(403, BLOCKED_IP_MESSAGE)
    ua = request.headers.get("user-agent", "")[:200]
    now_iso = datetime.now(timezone.utc).isoformat()

    # Returning guest: IP + name already known/approved → admit without queue.
    if ip:
        row = await db.guest_ip_names.find_one({"_id": ip})
        stored_name = (row or {}).get("name") or ""
        needs_reapproval = bool((row or {}).get("requires_reapproval"))
        name_matches = stored_name.strip().lower() == name.lower()
        ever_ok = bool((row or {}).get("ever_approved"))
        prior = None
        if name_matches and not needs_reapproval:
            prior = await db.access_requests.find_one(
                {
                    "ip": ip,
                    "status": {"$in": ["approved", "consumed"]},
                },
                sort=[("decided_at", -1)],
            )
            if prior and prior.get("name") and prior["name"].strip().lower() != name.lower():
                # Prefer matching name when possible; fall back to ever_approved flag.
                prior_match = await db.access_requests.find_one(
                    {
                        "ip": ip,
                        "status": {"$in": ["approved", "consumed"]},
                        "name": name,
                    },
                    sort=[("decided_at", -1)],
                )
                prior = prior_match or (prior if ever_ok else None)
            if prior or ever_ok:
                try:
                    await db.access_requests.update_many(
                        {"ip": ip, "status": "pending"},
                        {"$set": {
                            "status": "consumed",
                            "decided_at": now_iso,
                            "decided_reason": "returning_auto",
                            "consumed_at": now_iso,
                        }},
                    )
                except Exception:
                    pass
                guest = await _create_guest_session(
                    name, ip, ua, request_id=(prior or {}).get("_id")
                )
                logger.info(f"ACCESS returning guest auto-admit: name='{name}' ip={ip}")
                return {
                    "ok": True,
                    "status": "approved",
                    "token": guest["token"],
                    "name": name,
                    "expires_in_seconds": guest["expires_in_seconds"],
                    "expires_at": guest.get("expires_at"),
                    "source": "returning",
                    "message": "Welcome back",
                }

    # Explicit request: clear Exit opt-out only. Keep requires_reapproval until approve.
    if ip:
        try:
            await db.guest_ip_names.update_one(
                {"_id": ip},
                {
                    "$set": {"name": name, "updated_at": now_iso, "opted_out": False},
                    "$unset": {"opted_out_at": ""},
                },
                upsert=True,
            )
        except Exception:
            pass

    # One pending request per IP — reuse instead of flooding the admin queue.
    if ip:
        existing = await db.access_requests.find_one({"ip": ip, "status": "pending"})
        if existing:
            await db.access_requests.update_one(
                {"_id": existing["_id"]},
                {"$set": {"name": name, "user_agent": ua, "updated_at": now_iso}},
            )
            return {
                "ok": True,
                "status": "pending",
                "request_id": existing["_id"],
                "name": name,
                "message": "Waiting for admin approval",
            }

    req_id = secrets.token_urlsafe(16)
    await db.access_requests.insert_one({
        "_id": req_id,
        "name": name,
        "ip": ip,
        "user_agent": ua,
        "status": "pending",
        "created_at": now_iso,
        "updated_at": now_iso,
    })
    logger.info(f"ACCESS REQUEST pending: name='{name}' ip={ip} id={req_id}")
    try:
        import notifier as _n
        await _n.send_message(
            f"🛂 <b>Access request</b>\n{name}\nIP: <code>{ip or '—'}</code>",
            dedupe_key=f"access_req:{req_id}",
            cooldown_seconds=0,
        )
    except Exception:
        pass
    return {
        "ok": True,
        "status": "pending",
        "request_id": req_id,
        "name": name,
        "message": "Waiting for admin approval",
    }


@api_router.get("/auth/access-request/{request_id}")
async def auth_access_request_status(request_id: str, request: Request):
    """Guest polls this while waiting for admin approve/reject."""
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    # Bind poll to originating IP when known (stops token fishing).
    ip = _client_ip(request)
    if doc.get("ip") and ip and doc["ip"] != ip:
        raise HTTPException(403, "Request not valid for this device")
    out = {
        "request_id": doc["_id"],
        "status": doc.get("status"),
        "name": doc.get("name"),
        "created_at": doc.get("created_at"),
        "decided_at": doc.get("decided_at"),
    }
    if doc.get("status") == "approved" and doc.get("guest_token"):
        out["token"] = doc["guest_token"]
        out["expires_in_seconds"] = _guest_seconds_remaining(_next_6am_ist_utc())
        out["expires_at"] = _next_6am_ist_utc().isoformat()
        # Prefer the minted session's stored expiry when available.
        try:
            sess = await db.guest_sessions.find_one({"_id": doc["guest_token"]})
            if sess and sess.get("expires_at"):
                exp = datetime.fromisoformat(sess["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                out["expires_at"] = exp.isoformat()
                out["expires_in_seconds"] = _guest_seconds_remaining(exp)
        except Exception:
            pass
        out["status"] = "approved"
        # Hand off once — subsequent polls see "consumed" so the token isn't
        # endlessly re-exposed. Client must persist the token on first receipt.
        try:
            await db.access_requests.update_one(
                {"_id": request_id, "status": "approved"},
                {"$set": {
                    "status": "consumed",
                    "consumed_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        except Exception:
            pass
    elif doc.get("status") == "consumed":
        # Token already handed off — tell client to use stored session / re-enter name.
        out["status"] = "consumed"
    return out


async def _try_auto_guest_for_ip(ip: Optional[str], request: Request) -> Optional[dict]:
    """If this IP was previously approved under a known name, re-admit without a click.

    Order:
      1) Revive a still-valid last_token session
      2) Else mint a fresh session when a prior approved request exists for this IP

    Skipped when the guest explicitly Exit'd (opted_out) until they request again.
    """
    if not ip:
        return None
    if await _is_ip_blocked(ip):
        return None
    open_, _ = await _get_public_access_state()
    if not open_:
        return None
    row = await db.guest_ip_names.find_one({"_id": ip})
    if not row or not row.get("name"):
        return None
    if row.get("opted_out"):
        return None
    # Admin explicitly removed this guest — they must request + be approved again.
    if row.get("requires_reapproval"):
        return None
    name = row["name"]
    # 1) Live session still good?
    tok = row.get("last_token")
    if tok:
        sess = await db.guest_sessions.find_one({"_id": tok})
        if sess and not sess.get("revoked_at"):
            try:
                started = datetime.fromisoformat(sess.get("started_at"))
                now_utc = datetime.now(timezone.utc)
                exp = None
                if sess.get("expires_at"):
                    exp = datetime.fromisoformat(sess["expires_at"])
                    if exp.tzinfo is None:
                        exp = exp.replace(tzinfo=timezone.utc)
                else:
                    exp = _guest_expiry_from_start(started)
                if now_utc < exp and (now_utc - started).total_seconds() <= GUEST_SESSION_TTL_SECONDS:
                    return {
                        "token": tok,
                        "name": sess.get("name") or name,
                        "expires_in_seconds": _guest_seconds_remaining(exp, now_utc),
                        "expires_at": exp.isoformat(),
                        "source": "revive",
                    }
            except Exception:
                pass
    # 2) Previously approved on this IP → mint without another admin click
    prior = await db.access_requests.find_one(
        {
            "ip": ip,
            "status": {"$in": ["approved", "consumed"]},
            "name": name,
        },
        sort=[("decided_at", -1)],
    )
    if not prior:
        # Any prior approval for this IP (name may have been edited slightly)
        prior = await db.access_requests.find_one(
            {"ip": ip, "status": {"$in": ["approved", "consumed"]}},
            sort=[("decided_at", -1)],
        )
        if prior and prior.get("name"):
            name = prior["name"]
    if not prior:
        return None
    ua = request.headers.get("user-agent", "")[:200]
    guest = await _create_guest_session(name, ip, ua, request_id=prior.get("_id"))
    guest["source"] = "reissue"
    return guest


@api_router.post("/auth/guest/logout")
async def auth_guest_logout(request: Request):
    """Guest Exit — revoke this session and opt the IP out of auto-re-admit.

    Without opt-out, AuthGate would immediately mint a new guest session for the
    same IP (returning-guest auto-admit), so Exit appeared broken.
    """
    tok = _extract_bearer(request, "x-guest-token")
    ip = _client_ip(request)
    now_iso = datetime.now(timezone.utc).isoformat()
    if tok:
        try:
            await db.guest_sessions.update_one(
                {"_id": tok, "revoked_at": {"$exists": False}},
                {"$set": {"revoked_at": now_iso, "revoked_reason": "guest_logout"}},
            )
        except Exception:
            pass
    if ip:
        try:
            await db.guest_ip_names.update_one(
                {"_id": ip},
                {
                    "$set": {
                        "opted_out": True,
                        "opted_out_at": now_iso,
                        "last_token": None,
                        "updated_at": now_iso,
                    }
                },
                upsert=True,
            )
        except Exception:
            pass
    return {"ok": True}


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
            expire_on_close = False
            if tracker and "expire_admin_on_market_close" in tracker.settings:
                expire_on_close = bool(tracker.settings["expire_admin_on_market_close"])
            if expire_on_close:
                admin_session_expires_at = _session_market_expiry_utc(created).isoformat()
        except Exception:
            admin_session_expires_at = None
    # Suggest previous guest name + auto-admit returning guests on the same IP.
    suggested_guest_name = None
    auto_guest_token = None
    auto_guest_name = None
    auto_guest_expires_in = None
    auto_guest_expires_at = None
    guest_expires_at = None
    if is_guest and guest_sess:
        guest_expires_at = guest_sess.get("expires_at")
        if not guest_expires_at:
            try:
                started = datetime.fromisoformat(guest_sess.get("started_at"))
                guest_expires_at = _guest_expiry_from_start(started).isoformat()
            except Exception:
                guest_expires_at = _next_6am_ist_utc().isoformat()
    ip = _client_ip(request)
    if needs_guest_name and ip:
        try:
            row = await db.guest_ip_names.find_one({"_id": ip})
            if row and row.get("name"):
                suggested_guest_name = row["name"]
        except Exception:
            pass
        try:
            auto = await _try_auto_guest_for_ip(ip, request)
            if auto and auto.get("token"):
                auto_guest_token = auto["token"]
                auto_guest_name = auto.get("name") or suggested_guest_name
                auto_guest_expires_in = auto.get("expires_in_seconds")
                auto_guest_expires_at = auto.get("expires_at")
                # Reflect admitted state immediately for this response shape
                # (client will store the token and re-fetch).
                suggested_guest_name = auto_guest_name or suggested_guest_name
        except Exception as e:
            logger.warning(f"auto guest for IP failed: {e}")
    pending_access_count = 0
    if is_admin:
        pending_access_count = await _pending_access_count()
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
        "needs_guest_name": needs_guest_name and not auto_guest_token,
        "suggested_guest_name": suggested_guest_name,
        "auto_guest_token": auto_guest_token,
        "auto_guest_name": auto_guest_name,
        "auto_guest_expires_in": auto_guest_expires_in,
        "auto_guest_expires_at": auto_guest_expires_at,
        "guest_expires_at": guest_expires_at,
        "admin_name": admin_name,
        "admin_display_name": ADMIN_USERNAME,
        "session_ttl_seconds": (
            int(tracker.settings.get("admin_session_ttl_minutes", 480)) * 60
            if tracker else ADMIN_SESSION_TTL_SECONDS
        ),
        "admin_session_expires_at": admin_session_expires_at,
        "expire_admin_on_market_close": bool(
            (tracker.settings or {}).get("expire_admin_on_market_close", False) if tracker else False
        ),
        "can_remember_login": True,
        "pending_access_count": pending_access_count,
        "ip_blocked": await _is_ip_blocked(ip) if not is_admin else False,
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
        # Auto-reject lingering pending requests.
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.access_requests.update_many(
                {"status": "pending"},
                {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "public_access_closed"}},
            )
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
    ).sort("started_at", -1).to_list(length=500)
    now = datetime.now(timezone.utc)
    out = []
    for d in docs:
        row = {
            "token": d.get("_id"),
            "name": d.get("name"),
            "ip": d.get("ip"),
            "user_agent": d.get("user_agent"),
            "started_at": d.get("started_at"),
            "last_seen_at": d.get("last_seen_at"),
            "revoked_at": d.get("revoked_at"),
            "revoked_reason": d.get("revoked_reason"),
        }
        try:
            ls = datetime.fromisoformat(d.get("last_seen_at") or d.get("started_at"))
            row["active"] = not bool(d.get("revoked_at")) and (now - ls).total_seconds() < 300
            row["idle_seconds"] = int((now - ls).total_seconds())
        except Exception:
            row["active"] = False
            row["idle_seconds"] = None
        out.append(row)
    return {"guests": out, "count": len(out), "since_hours": since_hours}


@api_router.post("/auth/guests/{token}/revoke")
async def auth_revoke_guest(token: str, _admin: bool = Depends(require_admin)):
    """Kick a single guest session immediately."""
    tok = (token or "").strip()
    if not tok:
        raise HTTPException(400, "Missing guest token")
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await db.guest_sessions.find_one({"_id": tok})
    if not existing:
        raise HTTPException(404, "Guest session not found")
    await db.guest_sessions.update_one(
        {"_id": tok, "revoked_at": {"$exists": False}},
        {"$set": {"revoked_at": now_iso, "revoked_reason": "admin_kick"}},
    )
    # Stop same-IP auto-re-admit until they request access again.
    ip = existing.get("ip")
    if ip:
        try:
            await db.guest_ip_names.update_one(
                {"_id": ip},
                {
                    "$set": {
                        "opted_out": True,
                        "opted_out_at": now_iso,
                        "requires_reapproval": True,
                        "last_token": None,
                        "updated_at": now_iso,
                    }
                },
            )
        except Exception:
            pass
    return {"ok": True, "token": tok, "revoked": True}


@api_router.get("/auth/access-requests")
async def auth_list_access_requests(
    status: Optional[str] = Query(None),
    _admin: bool = Depends(require_admin),
):
    """Admin queue: pending (default) + recent decided requests."""
    q = {}
    if status in ("pending", "approved", "rejected", "consumed"):
        q["status"] = status
    else:
        # Default: pending first, plus recent decisions (last 24h)
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        q = {"$or": [
            {"status": "pending"},
            {"decided_at": {"$gte": since}},
            {"created_at": {"$gte": since}},
        ]}
    docs = await db.access_requests.find(q).sort("created_at", -1).to_list(length=200)
    rows = []
    for d in docs:
        rows.append({
            "request_id": d.get("_id"),
            "name": d.get("name"),
            "ip": d.get("ip"),
            "status": d.get("status"),
            "created_at": d.get("created_at"),
            "decided_at": d.get("decided_at"),
            "decided_reason": d.get("decided_reason"),
        })
    pending = sum(1 for r in rows if r["status"] == "pending")
    return {"requests": rows, "pending_count": pending}


@api_router.post("/auth/access-requests/{request_id}/approve")
async def auth_approve_access(request_id: str, request: Request, _admin: bool = Depends(require_admin)):
    open_, _ = await _get_public_access_state()
    if not open_:
        raise HTTPException(400, "Turn Public Access ON before approving guests.")
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    if doc.get("status") not in ("pending",):
        raise HTTPException(400, f"Request is already {doc.get('status')}")
    if doc.get("ip") and await _is_ip_blocked(doc["ip"]):
        raise HTTPException(400, "This IP is blocked. Unblock it first.")
    ua = doc.get("user_agent") or ""
    guest = await _create_guest_session(doc["name"], doc.get("ip"), ua, request_id=request_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.access_requests.update_one(
        {"_id": request_id},
        {"$set": {
            "status": "approved",
            "decided_at": now_iso,
            "decided_reason": "admin_approve",
            "guest_token": guest["token"],
        }},
    )
    logger.info(f"ACCESS APPROVED: name='{doc['name']}' ip={doc.get('ip')} id={request_id}")
    return {"ok": True, "request_id": request_id, "status": "approved", "guest_name": doc["name"]}


@api_router.post("/auth/access-requests/{request_id}/reject")
async def auth_reject_access(request_id: str, _admin: bool = Depends(require_admin)):
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    if doc.get("status") != "pending":
        raise HTTPException(400, f"Request is already {doc.get('status')}")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.access_requests.update_one(
        {"_id": request_id},
        {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "admin_reject"}},
    )
    return {"ok": True, "request_id": request_id, "status": "rejected"}


class BlockIpIn(BaseModel):
    ip: str
    reason: Optional[str] = None


@api_router.get("/auth/blocked-ips")
async def auth_list_blocked_ips(_admin: bool = Depends(require_admin)):
    docs = await db.blocked_ips.find({}).sort("blocked_at", -1).to_list(length=200)
    rows = [{
        "ip": d.get("_id"),
        "reason": d.get("reason"),
        "blocked_at": d.get("blocked_at"),
        "name_hint": d.get("name_hint"),
    } for d in docs]
    return {"blocked": rows, "count": len(rows)}


@api_router.post("/auth/blocked-ips")
async def auth_block_ip(payload: BlockIpIn, _admin: bool = Depends(require_admin)):
    ip = (payload.ip or "").strip()
    if not ip or len(ip) > 64:
        raise HTTPException(400, "Invalid IP")
    now_iso = datetime.now(timezone.utc).isoformat()
    name_hint = None
    try:
        g = await db.guest_sessions.find_one({"ip": ip}, sort=[("started_at", -1)])
        if g:
            name_hint = g.get("name")
    except Exception:
        pass
    await db.blocked_ips.update_one(
        {"_id": ip},
        {"$set": {
            "reason": (payload.reason or "admin_block")[:200],
            "blocked_at": now_iso,
            "name_hint": name_hint,
        }},
        upsert=True,
    )
    kicked = await _revoke_guests_for_ip(ip, "ip_blocked")
    try:
        await db.guest_ip_names.update_one(
            {"_id": ip},
            {"$set": {
                "requires_reapproval": True,
                "opted_out": True,
                "opted_out_at": now_iso,
                "last_token": None,
                "updated_at": now_iso,
            }},
            upsert=True,
        )
    except Exception:
        pass
    # Reject pending requests from this IP
    try:
        await db.access_requests.update_many(
            {"ip": ip, "status": "pending"},
            {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "ip_blocked"}},
        )
    except Exception:
        pass
    return {"ok": True, "ip": ip, "sessions_revoked": kicked}


@api_router.delete("/auth/blocked-ips/{ip}")
async def auth_unblock_ip(ip: str, _admin: bool = Depends(require_admin)):
    ip = (ip or "").strip()
    if not ip:
        raise HTTPException(400, "Invalid IP")
    await db.blocked_ips.delete_one({"_id": ip})
    return {"ok": True, "ip": ip, "unblocked": True}


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
async def telegram_huge_shift(
    payload: HugeShiftIn,
    request: Request,
    _who: str = Depends(require_desk_user),
):
    """Forward Huge OI shift alerts to Telegram. Requires admin or guest session
    (blocks fully anonymous spam). Rate-limited by middleware."""
    if not _notifier.is_configured():
        return {"ok": False, "reason": "telegram_not_configured"}
    # Respect admin Alert Settings index focus (same gate as OI reversal alerts).
    try:
        if tracker:
            tracker._refresh_alert_indices_for_today()
            focus = tracker.settings.get("alert_enabled_indices") or []
            if payload.index not in focus:
                return {"ok": False, "reason": "index_not_in_alert_focus"}
    except Exception as e:
        # Fail closed — never send Telegram for an unverified focus check.
        logging.getLogger(__name__).warning("telegram_huge_shift focus check failed: %s", e)
        return {"ok": False, "reason": "alert_focus_check_failed"}
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
    Falls back to last DB snapshot when Kite isn't connected."""
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

    # Fallback: use the tracker's last_snapshot (seeded from DB on boot).
    # Never invent random prev_close — that misleads weekend/holiday viewers.
    for internal, _symbol, label in symbols:
        snap = tracker.last_snapshot.get(internal)
        if not snap:
            try:
                snap = await db.oi_snapshots.find_one(
                    {"index": internal},
                    sort=[("timestamp", -1)],
                    projection={"_id": 0, "price": 1, "atm": 1, "timestamp": 1},
                )
            except Exception:
                snap = None
        snap = snap or {}
        ltp = float(snap.get("price") or snap.get("atm") or 0)
        prev = ltp  # unknown prev_close offline — show flat rather than fake %
        result.append({
            "index": internal, "label": label,
            "ltp": round(ltp, 2), "prev_close": round(prev, 2),
            "day_open": round(prev, 2),
            "day_high": round(ltp, 2), "day_low": round(ltp, 2),
            "change": 0.0, "change_pct": 0.0,
            "source": "historical",
            "as_of": snap.get("timestamp"),
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


# ------------------- FII / DII (NSE cash market, EOD) -------------------
@api_router.get("/market/fii-dii")
async def get_fii_dii():
    """Latest provisional FII/FPI & DII cash activity (₹ crores).

    Pulled from NSE `fiidiiTradeReact` around 19:31 IST on trading days.
    """
    return fii_dii.snapshot()


@api_router.post("/admin/fii-dii/refresh")
async def admin_refresh_fii_dii(_admin: bool = Depends(require_admin)):
    """Admin force-refresh of NSE FII/DII (useful if the evening pull missed)."""
    return await fii_dii.refresh(reason="admin")


class RefreshDayIn(BaseModel):
    force: Optional[bool] = False


# ------------------- Admin: refresh today's OI data -------------------
@api_router.post("/admin/refresh-day")
async def admin_refresh_day(
    payload: RefreshDayIn = RefreshDayIn(),
    _admin: bool = Depends(require_admin),
):
    """FRESH PULL — wipe OI snapshots and live-pull every ENABLED index in one click.

    Uses admin `enabled_indices` (falls back to all known indices). Historical
    OI ticks cannot be recovered from Kite, so there is no synthetic backfill:
    we take one live snapshot per enabled index (in parallel) when Kite mode is
    active, then normal polling continues. Offline mode only clears the DB.

    On weekend/holiday requires force=true (second admin confirmation in UI).
    """
    force = bool(getattr(payload, "force", False))
    if (is_weekend(datetime.now(IST)) or is_holiday(datetime.now(IST))) and not force:
        raise HTTPException(
            400,
            "Fresh Pull is disabled on weekends/holidays so the last trading "
            "session remains available for review. Confirm again to force, or "
            "try again on the next trading day.",
        )
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

    from oi_service import INDEX_CONFIG
    from market_hours import display_hours

    enabled = [
        i for i in (tracker.settings.get("enabled_indices") or list(INDEX_CONFIG.keys()))
        if i in INDEX_CONFIG
    ]
    if not enabled:
        enabled = list(INDEX_CONFIG.keys())

    # 2) Backfill strategy depends on whether Kite credentials are present:
    #    • KITE MODE  → NO synthetic backfill. Kite only supplies live ticks,
    #                   so fabricating history would show FAKE OI values that
    #                   don't match reality. Instead we take ONE live Kite
    #                   snapshot per enabled index at "now" and rely on the
    #                   tracker's normal poll to fill in the rest going forward.
    #    • OFFLINE    → skip synthetic backfill (no fake data).
    backfilled = 0
    per_index_count = {idx: 0 for idx in enabled}
    live_pulled: List[str] = []
    now_ist_now = datetime.now(IST)
    session_start = datetime.combine(
        today_ist, datetime.min.time().replace(hour=9, minute=15)
    ).replace(tzinfo=IST)
    _, close_hm = display_hours()
    try:
        ch, cm = [int(x) for x in close_hm.split(":")[:2]]
    except Exception:
        ch, cm = 15, 40
    session_end = min(
        now_ist_now,
        datetime.combine(
            today_ist, datetime.min.time().replace(hour=ch, minute=cm)
        ).replace(tzinfo=IST),
    )

    if tracker.mode == "kite" and tracker.kite_service:
        # Real-data-only: one live poll per ENABLED index in parallel.
        ksvc = tracker.kite_service

        async def _pull(idx: str):
            try:
                snap = await asyncio.wait_for(
                    asyncio.to_thread(ksvc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                    timeout=15.0,
                )
                return idx, snap, None
            except Exception as e:
                return idx, None, e

        results = await asyncio.gather(*[_pull(idx) for idx in enabled])
        for idx, snap, err in results:
            if err is not None:
                logger.warning(f"[refresh kite-live] {idx}: {err}")
                continue
            if snap:
                snap["mode"] = "kite"
                snap["source"] = "live"
                tracker.last_snapshot[idx] = snap
                await _store_oi_snapshot(snap, index_name=idx)
                per_index_count[idx] += 1
                backfilled += 1
                live_pulled.append(idx)
    else:
        # OFFLINE mode (no Kite credentials): DO NOT synthesize or backfill
        # mock/demo data. Creating synthetic history would expose fake values to
        # end users which is unacceptable in production. Instead, simply leave
        # the DB empty (we already cleared it above) and report that the
        # backfill was skipped due to missing credentials.
        logger.info("[admin/refresh-day] offline mode: skipping synthetic backfill (no Kite credentials configured)")
        # backfilled remains 0

    # 3) Immediate live poll for ALL enabled indices when market is open — skipped if
    #    step 2 already performed the kite live pull (avoids double Kite quotes).
    if is_market_open():
        if tracker.mode == "kite" and tracker.kite_service and not live_pulled:
            try:
                svc = tracker._get_service()

                async def _live(idx: str):
                    try:
                        snap = await asyncio.wait_for(
                            asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                            timeout=15.0,
                        )
                        return idx, snap, None
                    except Exception as e:
                        return idx, None, e

                for idx, snap, err in await asyncio.gather(*[_live(idx) for idx in enabled]):
                    if err is not None:
                        logger.warning(f"[refresh live-poll] {idx}: {err}")
                        continue
                    if snap:
                        snap["mode"] = tracker.mode
                        snap["source"] = "live"
                        tracker.last_snapshot[idx] = snap
                        await _store_oi_snapshot(snap, index_name=idx)
                        live_pulled.append(idx)
            except Exception as e:
                logger.warning(f"[admin/refresh-day] live poll block failed: {e}")
        elif tracker.mode != "kite":
            logger.info("[admin/refresh-day] market open but tracker offline — skipping immediate live poll")
    else:
        # After close: seed `last_snapshot` from the last backfilled document so
        # /oi/{idx}/change serves the correct final tick immediately.
        for idx in enabled:
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
        "enabled_indices": enabled,
        "mode": tracker.mode,
        "session_start_ist": session_start.isoformat(),
        "session_end_ist": session_end.isoformat(),
        "message": (
            f"Fresh Pull complete. Cleared {deleted.deleted_count} old snapshots and "
            f"pulled live ticks for {', '.join(live_pulled) or 'none'} "
            f"(enabled: {', '.join(enabled)}). Live polling continues automatically."
        ),
    }


# ------------------- Zerodha positions -------------------
@api_router.get("/positions")
async def get_positions(_admin: bool = Depends(require_admin)):
    """Fetch F&O positions from the user's Kite account (net + day).

    Includes:
      • Open legs (net quantity ≠ 0)
      • Same-day exited / squared-off legs (net quantity = 0 but buy/sell qty > 0)
        — Zerodha keeps these in `positions().net` until EOD with realised PnL

    Admin-only — never expose the live broker book to guests.
    Also returns equity funds (read-only margins) for the seller desk tile."""
    # Prefer the live Kite client — do not drop Positions just because the OI
    # poller mode flag briefly flipped offline.
    if not tracker.kite_service:
        return {
            "mode": tracker.mode,
            "positions": [],
            "funds": None,
            "error": "Kite not connected. Add API key + access token in Credentials.",
            "kite_connected": False,
            "transient": False,
            "token_issue": True,
        }
    # Respect intentional offline — do not auto-heal mode back to kite.
    if tracker.mode != "kite":
        if getattr(tracker, "offline_sticky", False):
            return {
                "mode": tracker.mode,
                "positions": [],
                "funds": None,
                "error": "Kite is offline. Switch to LIVE (or reconnect) to pull positions.",
                "kite_connected": False,
                "transient": False,
                "token_issue": False,
            }
        # Brief mode flap with credentials still loaded — use client without flipping mode.
        pass

    try:
        kite = tracker.kite_service.kite
        raw = await asyncio.to_thread(kite.positions)
        net = raw.get("net", []) if isinstance(raw, dict) else (raw or [])
        day = raw.get("day", []) if isinstance(raw, dict) else []
        # Successful Kite call — drop sticky TokenException so the banner clears.
        err_low = (tracker.last_error or "").lower()
        if any(
            k in err_low
            for k in (
                "tokenexception",
                "invalid token",
                "incorrect `api_key`",
                "incorrect api_key",
                "access_token",
            )
        ):
            tracker.last_error = None
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        low = msg.lower()
        tokenish = any(
            k in low
            for k in (
                "tokenexception",
                "invalid token",
                "access_token",
                "incorrect `api_key`",
                "incorrect api_key",
                "unauthorized",
                "forbidden",
            )
        )
        if tokenish:
            tracker.last_error = msg
        try:
            from kite_maintenance import notice_from_error, merge_maintenance

            note = notice_from_error(msg)
            if note:
                tracker.kite_maintenance = merge_maintenance(
                    tracker.kite_maintenance, api_error=msg
                )
            elif not tokenish:
                # Successful non-maintenance path clears sticky API maintenance later.
                pass
        except Exception:
            pass
        maint = tracker.kite_maintenance if isinstance(tracker.kite_maintenance, dict) else None
        err_out = f"Kite error: {msg}"
        if maint and maint.get("active") and maint.get("message"):
            err_out = f"Zerodha maintenance: {maint.get('message')}"
        return {
            "mode": tracker.mode,
            "positions": [],
            "funds": None,
            "error": err_out,
            "kite_connected": True,
            "transient": not tokenish,
            "token_issue": tokenish,
            "maintenance": bool(maint and maint.get("active")),
        }

    # Successful book fetch clears sticky API maintenance flags.
    if isinstance(tracker.kite_maintenance, dict) and tracker.kite_maintenance.get("source") == "kite_api":
        tracker.kite_maintenance = None

    # Read-only funds snapshot (never places trades).
    funds = None
    try:
        # Prefer equity segment directly — F&O cash lives here.
        try:
            eq = await asyncio.to_thread(kite.margins, "equity")
        except TypeError:
            eq = None
        except Exception:
            eq = None
        if not isinstance(eq, dict) or not eq:
            margins = await asyncio.to_thread(kite.margins)
            eq = (margins or {}).get("equity") or {}
        avail = eq.get("available") or {}
        util = eq.get("utilised") or {}
        # IMPORTANT: never reuse the name `net` — that holds positions().net above.
        funds_net = eq.get("net")
        if funds_net is None:
            funds_net = avail.get("live_balance")
        if funds_net is None:
            funds_net = avail.get("cash")
        funds = {
            "net": funds_net,
            "cash": avail.get("cash"),
            "live_balance": avail.get("live_balance"),
            "opening_balance": avail.get("opening_balance"),
            "collateral": avail.get("collateral"),
            "utilised_debits": util.get("debits"),
            "span": util.get("span"),
            "exposure": util.get("exposure"),
            "option_premium": util.get("option_premium"),
            "m2m_unrealised": util.get("m2m_unrealised"),
            "m2m_realised": util.get("m2m_realised"),
        }
    except Exception as e:
        logger.warning("kite.margins failed: %s", e)

    from fno_symbol import (
        booked_pnl_from_kite_row,
        format_fno_option_label,
        parse_fno_option_symbol,
    )
    from kite_positions import merge_kite_net_day

    # Net quantity is authoritative for open vs exited. Day rows only enrich
    # buy/sell stats — never resurrect a flat net as an open leg.
    try:
        merged = merge_kite_net_day(net, day)
    except Exception as e:
        logger.exception("positions merge failed: %s", e)
        return {
            "mode": tracker.mode,
            "positions": [],
            "funds": funds,
            "error": f"Positions merge error: {type(e).__name__}: {e}",
            "kite_connected": True,
            "transient": True,
            "token_issue": False,
        }

    out = []
    for p in merged:
        qty = int(p.get("quantity", 0) or 0)
        buy_qty = int(p.get("buy_quantity", 0) or 0)
        sell_qty = int(p.get("sell_quantity", 0) or 0)
        # Skip untouched / empty rows. Keep same-day exits (flat but traded today).
        if qty == 0 and buy_qty == 0 and sell_qty == 0:
            continue
        exited = qty == 0 and (buy_qty > 0 or sell_qty > 0)
        ts = p.get("tradingsymbol", "")
        parsed = parse_fno_option_symbol(ts) or {}
        buy_price = float(p.get("buy_price", 0) or 0)
        sell_price = float(p.get("sell_price", 0) or 0)
        avg = float(p.get("average_price", 0) or 0)
        buy_value = float(p.get("buy_value", 0) or 0)
        sell_value = float(p.get("sell_value", 0) or 0)
        last_price = float(p.get("last_price", 0) or 0)
        multiplier = float(p.get("multiplier", 1) or 1) or 1.0
        pnl_bits = booked_pnl_from_kite_row(
            qty=qty,
            buy_qty=buy_qty,
            sell_qty=sell_qty,
            buy_price=buy_price,
            sell_price=sell_price,
            pnl=float(p.get("pnl", 0) or 0),
            realised=float(p.get("realised", 0) or 0),
            unrealised=float(p.get("unrealised", 0) or 0),
            exited=exited,
            buy_value=buy_value,
            sell_value=sell_value,
            last_price=last_price,
            multiplier=multiplier,
        )
        # Direction hint for exited shorts/longs (qty is 0): compare buy vs sell volume.
        side_bias = None
        if exited:
            if sell_qty > buy_qty:
                side_bias = "short"
            elif buy_qty > sell_qty:
                side_bias = "long"
            else:
                side_bias = "squared"
        display_name = format_fno_option_label(ts, parsed=parsed or None)
        # Mirror Kite Positions: flat legs show Qty 0 / Avg 0.00 with Closed tag.
        out.append({
            "tradingsymbol": ts,
            "display_name": display_name,
            "exchange": p.get("exchange"),
            "product": p.get("product"),
            "quantity": 0 if exited else qty,
            "overnight_quantity": int(p.get("overnight_quantity", 0) or 0),
            "day_quantity": int(p.get("day_quantity", 0) or 0) if p.get("day_quantity") is not None else None,
            "average_price": 0.0 if exited else avg,
            "average_price_raw": avg,
            "last_price": last_price,
            "pnl": pnl_bits["pnl"],
            "unrealised": pnl_bits["unrealised"],
            "realised": pnl_bits["realised"],
            "booked_pnl": pnl_bits["booked_pnl"],
            "pnl_source": pnl_bits["pnl_source"],
            "buy_quantity": buy_qty,
            "sell_quantity": sell_qty,
            "buy_price": buy_price,
            "sell_price": sell_price,
            "buy_value": buy_value or None,
            "sell_value": sell_value or None,
            "multiplier": multiplier,
            "exited": exited,
            "is_exited": exited,
            "position_state": "closed" if exited else "open",
            "status": "Closed" if exited else None,
            "side_bias": side_bias,
            **parsed,
        })

    # Open legs first, then same-day exits (stable by symbol).
    out.sort(key=lambda r: (1 if r.get("exited") else 0, str(r.get("tradingsymbol") or "")))

    # Per-index spot: ALWAYS refresh from Kite quote for every index in the book
    # so NIFTY/SENSEX legs never inherit whichever dashboard tab is open.
    # Snapshot used only as secondary atm/OI context.
    idx_spot = {}
    oi_by_index = {}
    indices_needed = []
    for pos in out:
        idx = pos.get("index")
        if idx and idx in INDEX_CONFIG and idx not in indices_needed:
            indices_needed.append(idx)

    quotes = {}
    if indices_needed and tracker.kite_service:
        try:
            keys = [INDEX_CONFIG[i]["quote_symbol"] for i in indices_needed]
            quotes = await asyncio.to_thread(kite.quote, keys) or {}
        except Exception as e:
            logger.warning("positions per-index kite.quote failed: %s", e)
            quotes = {}

    for idx in indices_needed:
        qkey = INDEX_CONFIG[idx]["quote_symbol"]
        q = quotes.get(qkey) or {}
        lp = q.get("last_price") or (q.get("ohlc") or {}).get("close")
        try:
            lp_f = float(lp) if lp is not None else None
        except (TypeError, ValueError):
            lp_f = None

        snap = tracker.last_snapshot.get(idx) or {}
        snap_price = None
        try:
            snap_price = float(snap["price"]) if snap.get("price") is not None else None
        except (TypeError, ValueError):
            snap_price = None

        price_f = lp_f if (lp_f and lp_f > 0) else snap_price
        atm = snap.get("atm")
        try:
            atm_f = float(atm) if atm is not None else None
        except (TypeError, ValueError):
            atm_f = None
        if price_f and price_f > 0:
            idx_spot[idx] = {
                "price": price_f,
                "atm": atm_f if (atm_f and atm_f > 0) else price_f,
                "source": "kite_quote" if (lp_f and lp_f > 0) else "snapshot",
                "vix": snap.get("vix"),
            }
        # Compact OI chain for Analyze overlay (read-only, from in-memory snapshot)
        strikes = snap.get("strikes") or []
        if strikes:
            oi_by_index[idx] = {
                "price": price_f or snap_price,
                "atm": atm_f,
                "vix": snap.get("vix"),
                "expiry": snap.get("expiry"),
                "strikes": [
                    {
                        "strike": s.get("strike"),
                        "ce_oi": s.get("ce_oi") or 0,
                        "pe_oi": s.get("pe_oi") or 0,
                    }
                    for s in strikes
                    if s.get("strike") is not None
                ],
            }

    open_n = sum(1 for r in out if not r.get("exited"))
    exited_n = sum(1 for r in out if r.get("exited"))
    # Today P&L: open legs use Kite net pnl (includes day realised on partials);
    # same-day exits use booked/realised. Sum must match Kite "Total P&L".
    def _row_day_pnl(r: dict) -> float:
        if r.get("exited"):
            for key in ("booked_pnl", "realised", "pnl"):
                try:
                    v = float(r.get(key))
                except (TypeError, ValueError):
                    continue
                if v == v:  # not NaN
                    return v
            return 0.0
        try:
            return float(r.get("pnl") or 0)
        except (TypeError, ValueError):
            return 0.0

    open_pnl = round(sum(_row_day_pnl(r) for r in out if not r.get("exited")), 2)
    exited_pnl = round(sum(_row_day_pnl(r) for r in out if r.get("exited")), 2)
    return {
        "mode": tracker.mode,
        "positions": out,
        "open_count": open_n,
        "exited_count": exited_n,
        "pnl_today": {
            "open": open_pnl,
            "exited": exited_pnl,
            "total": round(open_pnl + exited_pnl, 2),
        },
        "spot": idx_spot,
        "oi": oi_by_index,
        "funds": funds,
        "kite_connected": True,
        "transient": False,
        "token_issue": False,
    }


def _ist_today_ymd() -> str:
    from datetime import datetime, timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d")


@api_router.get("/positions/brokerage-day")
async def get_brokerage_day(_admin: bool = Depends(require_admin)):
    """Day's brokerage via Kite virtual contract note (read-only).

    Prefers kite.trades() fills (reliable prices) then COMPLETE orders.
    Never returns API keys, secrets, or access tokens. Admin-only.
    """
    from kite_charges import (
        aggregate_contract_notes,
        empty_charges_payload,
        resolve_charge_params,
    )

    if tracker.mode != "kite" or not tracker.kite_service:
        if not tracker.kite_service or getattr(tracker, "offline_sticky", False):
            return {
                "ok": False,
                "brokerage": None,
                "charges_total": None,
                "order_count": 0,
                "error": "Kite not connected." if not tracker.kite_service else "Kite is offline.",
            }
        # Credentials present + non-sticky offline flap — use client without flipping mode.
        pass
    try:
        kite = tracker.kite_service.kite
    except Exception as e:
        err = f"Kite client: {type(e).__name__}: {e}"
        err = _sanitize_public_error(err) or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": 0,
            "error": err,
        }

    orders = []
    trades = []
    orders_err = None
    trades_err = None
    try:
        orders = await asyncio.to_thread(kite.orders) or []
    except Exception as e:
        orders_err = f"{type(e).__name__}: {e}"
        logger.warning("kite.orders for charges failed: %s", orders_err)
    try:
        trades = await asyncio.to_thread(kite.trades) or []
    except Exception as e:
        trades_err = f"{type(e).__name__}: {e}"
        logger.warning("kite.trades for charges failed: %s", trades_err)

    if orders_err and trades_err:
        err = _sanitize_public_error(f"Kite orders/trades: {orders_err}") or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": 0,
            "error": err,
        }

    today = _ist_today_ymd()
    params, book_stats = resolve_charge_params(orders, trades, today_ymd=today)
    book_stats["orders_fetched"] = len(orders) if isinstance(orders, list) else 0
    book_stats["trades_fetched"] = len(trades) if isinstance(trades, list) else 0
    book_stats["as_of"] = today

    if not params:
        payload = empty_charges_payload(
            order_count=0,
            note=(
                "No priced fills in kite.trades()/orders() for today — "
                "charges appear after executions clear on the exchange."
            ),
        )
        payload["book"] = book_stats
        payload["skipped_zero_price"] = book_stats.get("skipped_zero_price", 0)
        if orders_err:
            payload["orders_warning"] = orders_err
        if trades_err:
            payload["trades_warning"] = trades_err
        return payload

    # Cap + chunk — one bad row / oversized batch must not blank the chip.
    params = params[:500]
    notes: list = []
    chunk_errors: list[str] = []
    chunk_size = 50
    for i in range(0, len(params), chunk_size):
        chunk = params[i : i + chunk_size]
        try:
            part = await asyncio.to_thread(kite.get_virtual_contract_note, chunk)
            if isinstance(part, list):
                notes.extend(part)
            elif isinstance(part, dict) and isinstance(part.get("data"), list):
                notes.extend(part["data"])
            elif part:
                notes.append(part)
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            logger.warning("get_virtual_contract_note chunk %s failed: %s", i // chunk_size, msg)
            chunk_errors.append(msg)

    if not notes and chunk_errors:
        err = _sanitize_public_error(f"Charges API: {chunk_errors[0]}") or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": len(params),
            "book": book_stats,
            "error": err,
        }

    payload = aggregate_contract_notes(notes)
    payload.update({
        "order_count": len(params),
        "source": f"kite_virtual_contract:{book_stats.get('source') or 'trades'}",
        "book": book_stats,
        "skipped_zero_price": book_stats.get("skipped_zero_price", 0),
    })
    if chunk_errors:
        payload["warning"] = f"{len(chunk_errors)} charge chunk(s) failed; totals may be partial."
    return payload


# ------------------- CAS Rule Expiry (paper / live) -------------------
class CasSettingsIn(BaseModel):
    lots: Optional[int] = None
    ce_otm_steps: Optional[int] = None
    pe_otm_steps: Optional[int] = None
    product: Optional[str] = None
    live_trading: Optional[bool] = None
    paper_any_day: Optional[bool] = None
    debug_mode: Optional[bool] = None
    watch_indexes: Optional[List[str]] = None


class CasActivateIn(BaseModel):
    confirm_live: bool = False


class CasBacktestIn(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    lots: Optional[int] = None
    capital: Optional[float] = None
    indexes: Optional[List[str]] = None


@api_router.get("/cas/status")
async def cas_status(role: str = Depends(require_desk_user)):
    """CAS desk status — admin + guest (read-only for guests)."""
    import cas_bridge

    try:
        status = await asyncio.to_thread(cas_bridge.get_status, tracker)
    except Exception as e:
        logger.warning("cas status failed: %s", e, exc_info=True)
        raise HTTPException(500, "CAS status unavailable")
    # Guests never see raw kite errors that might leak broker details
    if role == "guest":
        plain = status.get("plain") or {}
        if plain.get("last_error"):
            plain = {**plain, "last_error": _sanitize_public_error(plain.get("last_error"))}
        state = status.get("state") or {}
        status = {
            "plain": plain,
            "day": status.get("day"),
            "settings": {
                "lots": (status.get("settings") or {}).get("lots"),
                "live_trading": (status.get("settings") or {}).get("live_trading"),
                "debug_mode": (status.get("settings") or {}).get("debug_mode"),
                "watch_indexes": (status.get("settings") or {}).get("watch_indexes"),
            },
            "config": {
                "lots": (status.get("config") or {}).get("lots"),
                "live_trading": (status.get("config") or {}).get("live_trading"),
                "debug_mode": (status.get("config") or {}).get("debug_mode"),
                "watch_indexes": (status.get("config") or {}).get("watch_indexes"),
                "product": (status.get("config") or {}).get("product"),
                "watch_start": (status.get("config") or {}).get("watch_start"),
                "watch_end": (status.get("config") or {}).get("watch_end"),
                "move_window_start": (status.get("config") or {}).get("move_window_start"),
                "move_window_end": (status.get("config") or {}).get("move_window_end"),
                "has_token": (status.get("config") or {}).get("has_token"),
            },
            "state": {
                "activated": state.get("activated"),
                "fired_indexes": state.get("fired_indexes"),
                "fills": state.get("fills") or [],
                "timings": state.get("timings") or [],
                "last_ltp": state.get("last_ltp") or {},
                "baseline_close": state.get("baseline_close") or {},
                "last_index_move_at": state.get("last_index_move_at") or {},
                "last_close": state.get("last_close") or {},
                "ws_connected": state.get("ws_connected"),
                "ticks_seen": state.get("ticks_seen"),
            },
            "ws": status.get("ws") or {},
            "market_closed": status.get("market_closed"),
            "live_readiness": status.get("live_readiness"),
            "role": "guest",
        }
    else:
        status = {**status, "role": "admin"}
    return status


@api_router.post("/cas/settings")
async def cas_settings(payload: CasSettingsIn, _admin: bool = Depends(require_admin)):
    """Update CAS lots / paper-live — admin only."""
    import cas_bridge

    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        return await asyncio.to_thread(
            cas_bridge.update_settings, patch, tracker, allow_live=True
        )
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("cas settings failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not update CAS settings")


@api_router.post("/cas/activate")
async def cas_activate(payload: CasActivateIn = CasActivateIn(), _admin: bool = Depends(require_admin)):
    """Arm the CAS window. Live mode requires confirm_live=true."""
    import cas_bridge

    try:
        return await asyncio.to_thread(
            cas_bridge.activate,
            tracker,
            by="admin",
            # Always pass the client's confirm flag; activate() re-checks live after sync.
            require_live_confirm=bool(payload.confirm_live),
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("cas activate failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not activate CAS")


@api_router.post("/cas/deactivate")
async def cas_deactivate(_admin: bool = Depends(require_admin)):
    import cas_bridge

    try:
        return await asyncio.to_thread(cas_bridge.deactivate, tracker, by="admin")
    except Exception as e:
        logger.warning("cas deactivate failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not deactivate CAS")


@api_router.post("/cas/reset")
async def cas_reset(_admin: bool = Depends(require_admin)):
    import cas_bridge

    try:
        return await asyncio.to_thread(cas_bridge.reset_day, tracker)
    except Exception as e:
        logger.warning("cas reset failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not reset CAS day state")


@api_router.post("/cas/backtest")
async def cas_backtest(payload: CasBacktestIn, role: str = Depends(require_desk_user)):
    """Run CAS expiry-day backtest (no live orders)."""
    import cas_bridge

    try:
        result = await asyncio.to_thread(
            cas_bridge.run_backtest,
            tracker,
            start=payload.start,
            end=payload.end,
            lots=payload.lots,
            capital=payload.capital,
            indexes=payload.indexes,
        )
        return {"ok": True, "role": role, "result": result}
    except Exception as e:
        logger.warning("cas backtest failed: %s", e, exc_info=True)
        raise HTTPException(500, f"Backtest failed: {type(e).__name__}")


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
    res = await ers.save_constituents(
        db, idx_code, rows, source_filename=file.filename or ""
    )
    return {
        "ok": True,
        "index": idx_code,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
        "uploaded_at": res.get("uploaded_at"),
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
    return {
        "ok": True,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
        "uploaded_at": res.get("uploaded_at"),
    }


@api_router.get("/upload/meta")
async def get_upload_meta():
    """Last successful upload stamp for each Upload category (public read)."""
    return await ers.fetch_upload_meta(db)


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
    meta = await ers.fetch_upload_meta(db)
    events_meta = meta.get("events") or {}
    idx_key = {"NIFTY": "nifty50", "BANKNIFTY": "banknifty", "SENSEX": "sensex"}.get(idx_code)
    constituents_meta = meta.get(idx_key) or {} if idx_key else {}
    return {
        "index": idx_code,
        "count": len(events),
        "events": events,
        "events_uploaded_at": events_meta.get("uploaded_at"),
        "events_source_filename": events_meta.get("source_filename"),
        "constituents_uploaded_at": constituents_meta.get("uploaded_at"),
        "constituents_source_filename": constituents_meta.get("source_filename"),
        "upload_meta": meta,
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
    meta = await ers.fetch_upload_meta(db)
    idx_key = {"NIFTY": "nifty50", "BANKNIFTY": "banknifty", "SENSEX": "sensex"}.get(idx_code)
    cmeta = meta.get(idx_key) or {} if idx_key else {}
    return {
        "index": idx_code,
        "count": len(docs),
        "constituents": docs,
        "uploaded_at": cmeta.get("uploaded_at"),
        "source_filename": cmeta.get("source_filename"),
    }


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
poll_watchdog_task = None

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
        await db.guest_sessions.create_index("ip")
        await db.admin_remember_devices.create_index("ip")
        await db.admin_remember_devices.create_index("expires_at")
        await db.guest_ip_names.create_index("updated_at")
        await db.access_requests.create_index([("status", 1), ("created_at", -1)])
        await db.access_requests.create_index([("ip", 1), ("status", 1)])
        await db.blocked_ips.create_index("blocked_at")
    except Exception as e:
        logger.warning(f"index creation warn: {e}")

    global tracker
    _notifier_boot.set_db(db)
    tracker = OITracker(db)

    await tracker.load_credentials()
    await tracker.load_settings()
    await tracker.start()
    # Seed in-memory last_snapshot from DB so weekend/holiday/cold-restart
    # serves Friday (or last session) immediately without waiting for a poll.
    try:
        enabled = tracker.settings.get("enabled_indices") or list(INDEX_CONFIG.keys())
        for idx in enabled:
            if idx in tracker.last_snapshot:
                continue
            doc = await db.oi_snapshots.find_one(
                {"index": idx},
                sort=[("timestamp", -1)],
                projection={"_id": 0},
            )
            if doc:
                tracker.last_snapshot[idx] = doc
        logger.info(
            "Seeded last_snapshot for %s indices from DB (session anchor %s)",
            len(tracker.last_snapshot),
            session_anchor_date().isoformat(),
        )
    except Exception as e:
        logger.warning(f"last_snapshot seed skipped: {e}")
    extra_tickers.attach_db(db)
    # Prefer Kite for GIFT NIFTY (NSEIX:GIFT NIFTY) + India VIX when LIVE.
    extra_tickers.attach_kite_provider(
        lambda: tracker.kite_service.kite if tracker and tracker.mode == "kite" and tracker.kite_service else None
    )
    await extra_tickers.start()
    fii_dii.attach_db(db)
    await fii_dii.start()
    global straddle_sampler_task, poll_watchdog_task
    straddle_sampler_task = asyncio.create_task(_straddle_sampler())
    poll_watchdog_task = asyncio.create_task(_market_day_poll_watchdog())
    logger.info(
        "Started browser-independent OI/straddle writers + market-day poll watchdog"
    )

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
    await fii_dii.stop()
    for task_name in ("straddle_sampler_task", "poll_watchdog_task"):
        task = globals().get(task_name)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
    try:
        if client:
            client.close()
    except Exception:
        pass