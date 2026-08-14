"""
Background OI tracker - polls Kite every N seconds, stores snapshots in Mongo,
and evaluates alert rules for OI reversal spikes.

Browser-independent: on working market days with live Kite credentials the poller
keeps writing OI Change / Open Interest / straddle samples to the DB whether or
not any client has the app open.

Polls ONLY during NSE market hours (default open 09:15 / Index F&O close 15:40 IST,
Mon–Fri, excl. holidays; configurable in Admin Settings) when FORCE_ALWAYS_POLL=false.
Retains 24 h of snapshots so any timeframe from 5 min – 4 h has data available.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from oi_service import INDEX_CONFIG, KiteService
# Import MockService only in development when explicitly enabled so production
# deployments never accidentally import demo generators.
try:
    if os.environ.get("ENABLE_DEV_MOCK", "false").lower() == "true":
        from dev.mock_service import MockService
    else:
        MockService = None
except Exception:
    MockService = None
from market_hours import (
    is_market_open, market_status, now_ist, configure_hours,
    default_alert_indices_for_today, is_holiday, is_trading_day,
    session_window_utc, IST,
)
import notifier
class JsonLogFormatter(logging.Formatter):
    """Structured JSON logger for OI tracker events."""

    def format(self, record: logging.LogRecord) -> str:
        record_dict = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "func": record.funcName,
            "line": record.lineno,
        }
        if record.exc_info:
            record_dict["exception"] = self.formatException(record.exc_info)

        for key, value in record.__dict__.items():
            if key in {
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "message",
                "level",
                "timestamp",
            }:
                continue
            if key.startswith("_"):
                continue
            if key not in record_dict:
                try:
                    json.dumps(value, default=str)
                    record_dict[key] = value
                except TypeError:
                    record_dict[key] = str(value)

        return json.dumps(record_dict, default=str)


logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
logger.propagate = False


def _fernet():
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


def _encrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except Exception:
        return None


POLL_INTERVAL_SECONDS = 15
INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"]

# Data retention: keep ≥96h so Friday's session survives the weekend and
# is still available Monday pre-open. Long weekends (Fri holiday → Tue) still
# fit. Override with SNAPSHOT_RETENTION_HOURS / STRADDLE_RETENTION_HOURS.
SNAPSHOT_RETENTION_HOURS = int(os.environ.get("SNAPSHOT_RETENTION_HOURS", "96"))
STRADDLE_RETENTION_HOURS = int(os.environ.get("STRADDLE_RETENTION_HOURS", "96"))

# When true, poll 24/7 (dev / mock). When false, poll only inside NSE hours.
FORCE_ALWAYS_POLL = os.environ.get("FORCE_ALWAYS_POLL", "false").lower() == "true"

# Sleep interval when market is closed — check every 60s if window has opened.
CLOSED_MARKET_SLEEP_SECONDS = 60

def resolve_desk_ai(settings: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
    """One Desk AI flag for the whole desk. Radar/Positions remain extra surfaces."""
    s = settings or {}
    if "desk_ai_show" in s:
        show = bool(s.get("desk_ai_show"))
        admin = show
        public = show
    else:
        admin = bool(s.get("desk_ai_admin", False))
        public = bool(s.get("desk_ai_public", False))
        show = admin or public
    ask = True if show else bool(s.get("desk_ai_ask", True))
    positions = bool(s.get("desk_ai_positions", False))
    radar = bool(s.get("desk_ai_radar", False))
    carry = bool(s.get("desk_ai_carry", False))
    return {
        "desk_ai_show": show,
        "desk_ai_ask": ask,
        "desk_ai_positions": positions,
        "desk_ai_radar": radar,
        "desk_ai_carry": carry,
        "desk_ai_admin": admin,
        "desk_ai_public": public,
    }


DEFAULT_SETTINGS = {
    "threshold_pct": 15.0,      # % OI change to trigger alert
    "cooldown_seconds": 120,    # per-index alert cooldown
    "compare_minutes": 3,       # compare with snapshot from N minutes ago
    "enabled_indices": ["NIFTY", "SENSEX", "BANKNIFTY"],  # which indices to poll
    "oi_poll_interval_seconds": 15,  # OI data pull interval (15/30/60 seconds)
    "straddle_poll_interval_seconds": 15,  # Dense straddle chart samples (FinanceDeft-style)
    "positions_poll_interval_seconds": 30,  # Positions desk auto-refresh (admin)
    "straddle_enabled_indices": ["NIFTY", "SENSEX"],  # Which indices to track for straddle
    "visible_pages": ["oi-change", "open-interest", "strike-table", "buildup", "positions", "alerts", "activity", "holidays", "straddle", "index-events"],
    # Admin's own dashboard tabs (independent of guest visibility)
    "admin_visible_pages": [
        "oi-change", "open-interest", "strike-table", "sell-candidates", "buildup",
        "positions", "alerts", "activity", "holidays", "straddle", "index-events", "cas",
    ],
    # Sidebar Strike Range steppers — off by default (ATM quick-picks cover most use)
    "show_strike_range": False,
    # Writer Defense map on Open Interest tab (admin-togglable)
    "show_writer_defense": True,
    # Suggestion posture card under the right panel (admin-togglable)
    "show_suggestion": True,
    # Desk AI — one header on/off for the whole desk. Radar stays a Positions tick.
    "desk_ai_ask": True,
    "desk_ai_positions": False,
    "desk_ai_radar": False,
    "desk_ai_carry": False,
    "desk_ai_admin": False,
    "desk_ai_public": False,
    # Gamma-wall / institution / velocity chips under OI Change chart (off by default)
    "show_chart_signals": False,
    # Index F&O / CAS: poll through 15:40 (configurable in Admin Settings)
    "market_open_ist": "09:15",
    "market_close_ist": "15:40",
    "second_session_ist": "12:00",  # BigClock 2nd-session notify (configurable)
    "expire_admin_on_market_close": False,  # stay signed in past market close (Remember me / long sessions)
    "admin_session_ttl_minutes": 480,
    # Alert focus indices — weekday defaults applied unless user overrides today
    "alert_enabled_indices": None,  # filled on load from weekday default
    "alert_indices_override_date": None,  # IST date string when user last overrode
}


class OITracker:
    def __init__(self, db):
        self.db = db
        self.kite_service: Optional[KiteService] = None
        # Do not enable demo/mock fallback in production. When no Kite
        # credentials are present the tracker enters OFFLINE mode and serves
        # historical DB snapshots only. This prevents synthetic/demo data being
        # shown to end users accidentally.
        self.mock_service = None
        self.mode = "offline"  # 'kite' or 'offline'
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.last_error: Optional[str] = None
        self.kite_user_id: Optional[str] = None
        self.kite_maintenance: Optional[Dict[str, Any]] = None
        # When True, admin intentionally set offline / signed out — Positions must not heal.
        self.offline_sticky: bool = False
        self.last_snapshot: Dict[str, Dict[str, Any]] = {}
        self.last_updated_at: Optional[str] = None
        self._instruments_loaded_at: Optional[datetime] = None
        self.settings: Dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.selected_expiry: Dict[str, Optional[str]] = {i: None for i in INDICES}
        # Throttle straddle history to ~1 sample per straddle_poll_interval (default 15s).
        self._last_straddle_sample_at: Dict[str, datetime] = {}
        self.last_straddle_quote: Dict[str, Dict[str, Any]] = {}
        self._last_successful_poll_at: Optional[datetime] = None
        
        self.metrics = Counter({
            "poll_cycles": 0,
            "poll_timeouts": 0,
            "snapshot_fetch_errors": 0,
            "snapshot_missing_count": 0,
            "snapshot_upsert_errors": 0,
            "retention_prune_errors": 0,
            "straddle_store_errors": 0,
            "alert_eval_errors": 0,
            "successful_snapshots": 0,
            "single_flight_refreshes": 0,
        })
        # Per-index single-flight refresh locks so /change never stampedes Kite.
        self._refresh_locks: Dict[str, asyncio.Lock] = {i: asyncio.Lock() for i in INDICES}
        self._refresh_tasks: Dict[str, Optional[asyncio.Task]] = {i: None for i in INDICES}
        # Track which IST trading date we already purged prior-day alerts for.
        self._alerts_purged_for: Optional[str] = None

    async def load_settings(self):
        doc = await self.db.settings.find_one({"_id": "alerts"})
        if doc:
            self.settings.update({k: v for k, v in doc.items() if k != "_id"})
        # Product default: do NOT kick admin at market close. Persist so UI +
        # /auth/state stay consistent after upgrades from the old True default.
        if self.settings.get("expire_admin_on_market_close") is True:
            self.settings["expire_admin_on_market_close"] = False
            try:
                await self.db.settings.update_one(
                    {"_id": "alerts"},
                    {"$set": {"expire_admin_on_market_close": False}},
                    upsert=True,
                )
                logger.info("Migrated expire_admin_on_market_close → False (admin stays signed in past close)")
            except Exception as e:
                logger.warning("Could not persist expire_admin_on_market_close=False: %s", e)
        # Apply market hours + weekday alert defaults
        self._apply_market_hours()
        self._refresh_alert_indices_for_today()

    def _apply_market_hours(self):
        try:
            configure_hours(
                self.settings.get("market_open_ist", "09:15"),
                self.settings.get("market_close_ist", "15:40"),
            )
        except Exception as e:
            logger.warning("configure_hours failed: %s", e)

    def _refresh_alert_indices_for_today(self):
        """Reset alert focus to weekday defaults unless user overrode today.

        Day change clears yesterday's override. Persistence to Mongo is best-effort
        so GET /settings stays consistent across restarts without blocking alerts.
        """
        today = now_ist().date().isoformat()
        override_date = self.settings.get("alert_indices_override_date")
        if override_date == today and self.settings.get("alert_enabled_indices"):
            return  # keep today's explicit choice
        defaults = default_alert_indices_for_today()
        prev = self.settings.get("alert_enabled_indices")
        prev_override = self.settings.get("alert_indices_override_date")
        self.settings["alert_enabled_indices"] = defaults
        self.settings["alert_indices_override_date"] = None
        if prev != defaults or prev_override:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.db.settings.update_one(
                    {"_id": "alerts"},
                    {"$set": {
                        "alert_enabled_indices": defaults,
                        "alert_indices_override_date": None,
                    }},
                    upsert=True,
                ))
            except Exception:
                pass

    async def save_settings(self, patch: Dict[str, Any]):
        allowed = {
            "threshold_pct", "cooldown_seconds", "compare_minutes", "enabled_indices",
            "oi_poll_interval_seconds", "straddle_poll_interval_seconds",
            "positions_poll_interval_seconds",
            "straddle_enabled_indices", "visible_pages", "admin_visible_pages",
            "market_open_ist", "market_close_ist", "second_session_ist",
            "expire_admin_on_market_close", "admin_session_ttl_minutes",
            "alert_enabled_indices", "alert_indices_override_date",
            "show_strike_range", "show_writer_defense", "show_suggestion",
            "show_chart_signals",
            "desk_ai_show", "desk_ai_ask", "desk_ai_positions", "desk_ai_radar",
            "desk_ai_carry",
            "desk_ai_admin", "desk_ai_public",
        }
        clean = {k: v for k, v in patch.items() if k in allowed}
        if "desk_ai_show" in clean:
            show = bool(clean["desk_ai_show"])
            clean["desk_ai_admin"] = show
            clean["desk_ai_public"] = show
        # Explicit alert-index change → mark as today's override
        if "alert_enabled_indices" in clean:
            clean["alert_indices_override_date"] = now_ist().date().isoformat()
        self.settings.update(clean)
        await self.db.settings.update_one(
            {"_id": "alerts"}, {"$set": clean}, upsert=True
        )
        if "market_open_ist" in clean or "market_close_ist" in clean:
            self._apply_market_hours()
        if "enabled_indices" in clean:
            try:
                await self.seed_default_expiries()
            except Exception as e:
                logger.warning("seed_default_expiries after settings save failed: %s", e)
        return self.settings

    def list_expiries(self, index_name: str):
        svc = self._get_service()
        try:
            return svc.list_expiries(index_name)
        except Exception as e:
            logger.error(f"list_expiries failed: {e}")
            return []

    def set_expiry(self, index_name: str, expiry: Optional[str]):
        self.selected_expiry[index_name] = expiry

    async def persist_snapshot(self, snapshot: Dict[str, Any], *, index_name: Optional[str] = None):
        """Persist one OI snapshot idempotently per (index, timestamp, expiry)."""
        doc = dict(snapshot or {})
        if index_name:
            doc.setdefault("index", index_name)
        doc["timestamp"] = doc.get("timestamp") or datetime.now(timezone.utc).isoformat()
        # Never rewrite created_at on re-upsert — keep first-seen time for retention/debug.
        created_at = datetime.now(timezone.utc).isoformat()
        set_doc = {k: v for k, v in doc.items() if k != "created_at"}
        try:
            await self.db.oi_snapshots.update_one(
                {
                    "index": doc.get("index"),
                    "timestamp": doc.get("timestamp"),
                    "expiry": doc.get("expiry"),
                },
                {"$set": set_doc, "$setOnInsert": {"created_at": created_at}},
                upsert=True,
            )
        except Exception as e:
            self.metrics["snapshot_upsert_errors"] += 1
            logger.warning(
                "[persist_snapshot] failed to upsert snapshot for %s: %s",
                index_name or doc.get("index"),
                e,
                exc_info=True,
                extra={"metrics": dict(self.metrics)},
            )
            raise

    def snapshot_age_seconds(self, snap: Optional[Dict[str, Any]]) -> Optional[float]:
        if not snap or not snap.get("timestamp"):
            return None
        try:
            ts = datetime.fromisoformat(snap["timestamp"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - ts).total_seconds()
        except Exception:
            return None

    def poll_interval_seconds(self) -> int:
        return max(1, int(self.settings.get("oi_poll_interval_seconds", POLL_INTERVAL_SECONDS)))

    def stale_after_seconds(self) -> int:
        """Age before UI marks STALE while market is open.

        Must exceed one full poll cadence with headroom so a 60s interval does
        not false-STALE between successful ticks (old hard-coded 45s did).
        """
        return max(90, self.poll_interval_seconds() * 3)

    def request_background_refresh(self, index_name: str, expiry: Optional[str] = None) -> None:
        """Kick a single-flight background Kite refresh without blocking callers.

        Used by /change when the in-memory cache is stale. Only one refresh runs
        per index at a time; additional callers reuse the same task.
        """
        idx = index_name.upper()
        if idx not in INDICES:
            return
        if self.mode != "kite" or not self.kite_service:
            return
        if not (FORCE_ALWAYS_POLL or is_market_open()):
            return
        existing = self._refresh_tasks.get(idx)
        if existing and not existing.done():
            return

        async def _do_refresh():
            async with self._refresh_locks[idx]:
                age = self.snapshot_age_seconds(self.last_snapshot.get(idx))
                if age is not None and age <= 15:
                    return
                exp = expiry if expiry is not None else self.selected_expiry.get(idx)
                try:
                    self.metrics["single_flight_refreshes"] += 1
                    snap = await asyncio.wait_for(
                        asyncio.to_thread(self.kite_service.get_snapshot, idx, exp),
                        timeout=10.0,
                    )
                    if snap:
                        snap["mode"] = self.mode
                        self.last_snapshot[idx] = snap
                        try:
                            await self.persist_snapshot(snap, index_name=idx)
                        except Exception:
                            pass
                except Exception as e:
                    logger.warning("[request_background_refresh] %s failed: %s", idx, e)

        self._refresh_tasks[idx] = asyncio.create_task(_do_refresh())

    async def load_credentials(self):
        """Load saved kite credentials from DB and initialize KiteService if present.

        Bootstrap fallback: if the DB has no Kite credentials but KITE_API_KEY /
        KITE_ACCESS_TOKEN env vars are present, seed the DB (encrypted) from
        those and initialize the KiteService. This lets a fresh deploy come
        online in LIVE mode without requiring the user to open the credentials
        modal on every boot.
        """
        doc = await self.db.credentials.find_one({"_id": "kite"})
        api_key = _decrypt_secret(doc.get("api_key_enc")) if doc else None
        access_token = _decrypt_secret(doc.get("access_token_enc")) if doc else None
        if not api_key and doc and doc.get("api_key"):
            api_key = doc.get("api_key")
        if not access_token and doc and doc.get("access_token"):
            access_token = doc.get("access_token")
        # Env-var bootstrap: only used when DB has NOTHING stored yet, so that
        # subsequent in-app updates from the credentials modal take precedence.
        if not (api_key and access_token):
            env_key = (os.environ.get("KITE_API_KEY") or "").strip()
            env_tok = (os.environ.get("KITE_ACCESS_TOKEN") or "").strip()
            if env_key and env_tok:
                api_key = api_key or env_key
                access_token = access_token or env_tok
                try:
                    await self.db.credentials.update_one(
                        {"_id": "kite"},
                        {"$set": {
                            "api_key_enc": _encrypt_secret(api_key),
                            "access_token_enc": _encrypt_secret(access_token),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                            "source": "env_bootstrap",
                        }},
                        upsert=True,
                    )
                    logger.info("Seeded Kite credentials from KITE_API_KEY / KITE_ACCESS_TOKEN env vars.")
                except Exception as e:
                    logger.warning(f"env-var Kite credentials seed failed: {e}")
        if doc and (doc.get("api_key") or doc.get("access_token")) and not (doc.get("api_key_enc") and doc.get("access_token_enc")):
            try:
                await self.db.credentials.update_one(
                    {"_id": "kite"},
                    {
                        "$set": {
                            "api_key_enc": _encrypt_secret(api_key),
                            "access_token_enc": _encrypt_secret(access_token),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                        "$unset": {"api_key": "", "access_token": ""},
                    },
                    upsert=True,
                )
                logger.warning("Migrated legacy plaintext Kite credentials to encrypted storage.")
            except Exception as e:
                logger.warning(f"Failed to migrate plaintext Kite credentials: {e}")
        if doc and doc.get("kite_user_id"):
            self.kite_user_id = str(doc.get("kite_user_id"))
        if api_key and access_token:
            try:
                self.kite_service = KiteService(api_key, access_token)
                self.mode = "kite"
                self.last_error = None
                self.offline_sticky = False
                logger.info("KiteService initialized from stored credentials.")
                # Refresh profile identity when missing (admin UI shows user id).
                if not self.kite_user_id:
                    try:
                        profile = await asyncio.wait_for(
                            asyncio.to_thread(self.kite_service.kite.profile),
                            timeout=8,
                        )
                        uid = profile.get("user_id") if isinstance(profile, dict) else None
                        if uid:
                            self.kite_user_id = str(uid)
                            await self.db.credentials.update_one(
                                {"_id": "kite"},
                                {"$set": {"kite_user_id": self.kite_user_id}},
                                upsert=True,
                            )
                    except Exception as e:
                        logger.warning("kite profile bootstrap failed: %s", e)
                return True
            except Exception as e:
                self.last_error = f"Kite init failed: {e}"
                self.kite_service = None
                self.mode = "offline"
                logger.error(self.last_error)
                return False
        # No credentials configured: go to OFFLINE mode. Do not enable a demo
        # synthetic mode in production.
        self.mode = "offline"
        return False

    async def set_credentials(self, api_key: str, access_token: str):
        # Surface the actual Kite error to the user for easier debugging.
        try:
            svc = KiteService(api_key, access_token)
        except Exception as e:
            raise RuntimeError(f"Kite SDK init failed: {type(e).__name__}: {e}")
        try:
            profile = svc.kite.profile()
            logger.info(f"Kite profile loaded for user: {profile.get('user_id')}")
        except Exception as e:
            # Common causes: expired access_token (daily), wrong api_key, wrong secret used to compute token
            hint = ""
            msg = str(e).lower()
            if "token" in msg or "api_key" in msg or "signature" in msg:
                hint = " (Tip: access_token expires every trading day around 6 AM IST — regenerate via the Kite login flow.)"
            raise RuntimeError(f"{type(e).__name__}: {e}{hint}")
        uid = None
        if isinstance(profile, dict) and profile.get("user_id"):
            uid = str(profile.get("user_id"))
        await self.db.credentials.update_one(
            {"_id": "kite"},
            {"$set": {
                "api_key_enc": _encrypt_secret(api_key),
                "access_token_enc": _encrypt_secret(access_token),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                **({"kite_user_id": uid} if uid else {}),
            }, "$unset": {"api_key": "", "access_token": ""}},
            upsert=True,
        )
        self.kite_service = svc
        self.mode = "kite"
        self.last_error = None
        self.kite_user_id = uid or self.kite_user_id
        self.kite_maintenance = None
        self.offline_sticky = False
        try:
            if self.kite_service:
                self.kite_service.reload_instruments(force=True)
                self._instruments_loaded_at = datetime.now(timezone.utc)
        except Exception as e:
            logger.warning("instruments reload after set_credentials failed: %s", e)
        try:
            await self.seed_default_expiries()
        except Exception as e:
            logger.warning("seed_default_expiries after set_credentials failed: %s", e)
        # Browser-independent: keep the market-day poller running once creds are live.
        try:
            await self.start()
        except Exception as e:
            logger.warning("tracker.start after set_credentials failed: %s", e)
        if FORCE_ALWAYS_POLL or is_market_open():
            try:
                asyncio.create_task(self._poll_once())
            except Exception:
                pass

    async def set_mode(self, mode: str):
        # Supported modes: 'kite' (live) and 'offline' (no live polling).
        if mode not in ("kite", "offline"):
            raise ValueError("mode must be 'kite' or 'offline'")
        if mode == "kite" and self.kite_service is None:
            raise RuntimeError("No Kite credentials configured")
        self.mode = mode
        if mode == "offline":
            self.offline_sticky = True
        else:
            self.offline_sticky = False
            try:
                await self.start()
            except Exception as e:
                logger.warning("tracker.start after set_mode(kite) failed: %s", e)
            if FORCE_ALWAYS_POLL or is_market_open():
                try:
                    asyncio.create_task(self._poll_once())
                except Exception:
                    pass

    def _get_service(self):
        # Only return Kite service when in LIVE mode. Do not return a mock/demo
        # service — production must not expose synthetic data to end users.
        if self.mode == "kite" and self.kite_service:
            return self.kite_service
        return None

    async def seed_default_expiries(self, *, force_roll: bool = False):
        """Lock nearest unexpired expiry for every enabled index.

        Re-seeds when missing, when force_roll=True (morning / after instrument
        reload), or when the currently selected expiry is already past.
        """
        if self.mode != "kite" or not self.kite_service:
            return
        today = now_ist().date()
        enabled = self.settings.get("enabled_indices", INDICES)
        for idx in enabled:
            if idx not in INDICES:
                continue
            current = self.selected_expiry.get(idx)
            need = force_roll or not current
            if current and not need:
                try:
                    from datetime import date as _date, datetime as _datetime
                    d = (
                        _datetime.fromisoformat(current).date()
                        if "T" in str(current)
                        else _date.fromisoformat(str(current)[:10])
                    )
                    if d < today:
                        need = True
                except Exception:
                    need = True
            if not need:
                continue
            try:
                dates = await asyncio.wait_for(
                    asyncio.to_thread(self.kite_service.list_expiries, idx),
                    timeout=15,
                )
                if dates:
                    self.selected_expiry[idx] = dates[0]
                    logger.info("Seeded default expiry for %s → %s", idx, dates[0])
            except Exception as e:
                logger.warning("seed_default_expiries(%s) failed: %s", idx, e)

    async def ensure_instruments_fresh(self) -> None:
        """Reload Kite instruments at most once per IST trading day (expiry roll)."""
        if self.mode != "kite" or not self.kite_service:
            return
        now = datetime.now(timezone.utc)
        loaded = self._instruments_loaded_at
        # Reload if never loaded today (IST calendar day).
        ist_today = now_ist().date()
        need = loaded is None
        if loaded is not None:
            try:
                loaded_ist = loaded.astimezone(IST).date() if loaded.tzinfo else loaded.date()
                need = loaded_ist < ist_today
            except Exception:
                need = True
        if not need:
            # Still roll expiries that went past.
            await self.seed_default_expiries(force_roll=False)
            return
        try:
            self.kite_service.reload_instruments(force=True)
            self._instruments_loaded_at = now
            await self.seed_default_expiries(force_roll=True)
            logger.info("Reloaded Kite instruments + rolled default expiries for %s", ist_today)
        except Exception as e:
            logger.warning("ensure_instruments_fresh failed: %s", e)

    async def start(self):
        if self.running and self._task is not None and not self._task.done():
            return
        self.running = True
        self._task = asyncio.create_task(self._loop())
        # Expiry seed hits kite.instruments() (huge) — never block API bind / k8s ready.
        asyncio.create_task(self._seed_expiries_safe())
        logger.info("OI tracker started (browser-independent DB writer)")

    async def _seed_expiries_safe(self):
        try:
            await asyncio.wait_for(self.seed_default_expiries(), timeout=20)
        except Exception as e:
            logger.warning("seed_default_expiries on start failed: %s", e)

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("OI tracker stopped")

    async def ensure_market_day_polling(self) -> None:
        """Watchdog: keep OI/straddle DB writes alive on trading days with live creds.

        Called periodically from the server lifespan task so a dead loop or a
        long gap without successful polls is healed even with zero browsers open.
        """
        if self.mode != "kite" or not self.kite_service:
            return
        if not (FORCE_ALWAYS_POLL or is_market_open()):
            return

        if not self.running or self._task is None or self._task.done():
            logger.warning(
                "OI poller not running on market day — restarting (browser-independent)."
            )
            self.running = False
            self._task = None
            await self.start()
            return

        thr = float(self.stale_after_seconds())
        age: Optional[float] = None
        if self._last_successful_poll_at is not None:
            last = self._last_successful_poll_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - last.astimezone(timezone.utc)).total_seconds()
        else:
            ages = [
                a for a in (self.snapshot_age_seconds(s) for s in self.last_snapshot.values())
                if a is not None
            ]
            # No success yet this process — treat seeded/old cache as stalled so we force a warm poll.
            age = max(ages) if ages else thr + 1.0

        if age is not None and age <= thr:
            return

        logger.warning(
            "OI poller stalled (%.0fs since last success, threshold %ss) — forcing poll.",
            age if age is not None else -1,
            int(thr),
        )
        try:
            await self._poll_once()
        except Exception as e:
            logger.error("watchdog forced poll failed: %s", e)

    def _seconds_until_next_poll_boundary(self, interval_seconds: int) -> float:
        """Return the fractional delay to the next aligned poll boundary.

        Examples for a 15s poll interval:
          - at 09:46:47 → sleep until 09:47:00 (13s)
          - at 09:47:00 → sleep until 09:47:15 (15s)
        """
        # Use IST-aware clock so boundary alignment matches market timestamps
        # regardless of the server's local timezone.
        now = now_ist()
        now_seconds = now.second + (now.microsecond / 1_000_000.0)
        remainder = now_seconds % interval_seconds
        wait = interval_seconds - remainder
        if wait >= interval_seconds:
            wait = interval_seconds
        return max(0.0, wait)

    async def _loop(self):
        """
        Main polling loop.

        Behavior:
          * If FORCE_ALWAYS_POLL=true → poll every configured OI interval regardless of time.
          * Else → poll only during NSE market hours (9:00–15:30 IST Mon–Fri, excl. holidays);
            outside the window, sleep 60s and re-check. Announce open/close to Telegram once/day.
          * Polls are aligned to the selected cadence (15/30/60s) so each sample lands on the
            next clock boundary rather than drifting after the previous request finishes.
        """
        was_open = False
        while self.running:
            try:
                poll_interval_seconds = max(1, int(self.settings.get("oi_poll_interval_seconds", POLL_INTERVAL_SECONDS)))
                if FORCE_ALWAYS_POLL or is_market_open():
                    if not was_open:
                        logger.info("Market OPEN — starting continuous OI / straddle polling (browser-independent).")
                        await notifier.alert_market_open()
                        try:
                            await self._purge_prior_session_alerts()
                        except Exception as e:
                            logger.warning("purge prior-session alerts failed: %s", e)
                        was_open = True
                        # Warm immediately — do not wait for the next clock boundary.
                        await self._poll_once()
                        continue
                    await asyncio.sleep(self._seconds_until_next_poll_boundary(poll_interval_seconds))
                    if not self.running:
                        break
                    if not (FORCE_ALWAYS_POLL or is_market_open()):
                        continue
                    await self._poll_once()
                else:
                    if was_open:
                        logger.info("Market CLOSED — pausing polling.")
                        await notifier.alert_market_close()
                        # Build and send daily digest right after close (only when market
                        # was open just now, i.e. real end-of-session).
                        try:
                            digest = await self.build_daily_digest()
                            await notifier.send_daily_digest(digest)
                        except Exception as e:
                            logger.warning(f"daily digest failed: {e}")
                        was_open = False
                    # opportunistic pre-market check: warn if kite creds seem stale
                    await self._premarket_check()
                    await asyncio.sleep(min(poll_interval_seconds, CLOSED_MARKET_SLEEP_SECONDS))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("loop error: %s", e)
                self.last_error = str(e)
                await notifier.alert_tracker_error(str(e))
                await asyncio.sleep(max(1, int(self.settings.get("oi_poll_interval_seconds", POLL_INTERVAL_SECONDS))))

    async def _purge_prior_session_alerts(self):
        """On a new trading day open, drop alerts from prior sessions.

        Keeps the Alerts panel focused on today's session so weekend/holiday
        leftovers are not misread as live signals.
        """
        dt = now_ist()
        if not is_trading_day(dt):
            return
        today = dt.date().isoformat()
        if self._alerts_purged_for == today:
            return
        start_utc, _ = session_window_utc(dt.date(), dt)
        cutoff = start_utc.isoformat()
        result = await self.db.alerts.delete_many({"created_at": {"$lt": cutoff}})
        deleted = getattr(result, "deleted_count", 0) or 0
        self._alerts_purged_for = today
        if deleted:
            logger.info(
                "Purged %s prior-session alert(s) before %s (session %s)",
                deleted,
                cutoff,
                today,
            )

    async def _premarket_check(self):
        """Between 8:45 and 9:00 IST on trading days, verify Kite is usable.
        If not, ping the user on Telegram (once per day)."""
        try:
            dt = now_ist()
            if dt.weekday() >= 5 or is_holiday(dt):
                return
            if not (dt.hour == 8 and dt.minute >= 45):
                return
            if self.mode != "kite" or self.kite_service is None:
                await notifier.alert_kite_token_issue(
                    "Tracker is OFFLINE — no Kite credentials configured. Live polling will not run until credentials are provided."
                )
                return
            # Cheap validation: profile() call
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(self.kite_service.kite.profile),
                    timeout=8.0,
                )
            except Exception as e:
                await notifier.alert_kite_token_issue(
                    f"Kite token check failed: {type(e).__name__}: {e}"
                )
        except Exception as e:
            logger.warning(f"premarket_check error: {e}")

    async def _poll_once(self):
        """
        Concurrently fetch snapshots for enabled indices with a per-index timeout.
        This prevents a slow or stuck fetch for one index from serializing the whole
        poll cycle. Results are then processed (cache, upsert, retention, straddle,
        alerts) sequentially for simplicity and safety.
        """
        self.metrics["poll_cycles"] += 1

        # If tracker is not configured for LIVE (kite) mode, do not attempt to
        # poll Kite or use any demo/mock service. Instead, preserve existing
        # DB-backed snapshots and return early so the system stays read-only.
        if self.mode != "kite" or not self.kite_service:
            logger.debug("[_poll_once] tracker offline: skipping live fetch cycle", extra={"metrics": dict(self.metrics)})
            self.last_updated_at = datetime.now(timezone.utc).isoformat()
            return

        try:
            await self.ensure_instruments_fresh()
        except Exception as e:
            logger.warning("ensure_instruments_fresh in poll: %s", e)

        svc = self._get_service()
        enabled = [i for i in self.settings.get("enabled_indices", INDICES) if i in INDICES]
        if not enabled:
            self.last_updated_at = datetime.now(timezone.utc).isoformat()
            return

        # Fetch EVERY enabled index concurrently. Each index gets its own timeout
        # so a slow NIFTY pull cannot cancel SENSEX mid-flight (the previous
        # shared 10s wait left non-active indices cold until the UI selected them).
        async def _fetch_one(idx: str):
            exp = self.selected_expiry.get(idx)
            try:
                snap = await asyncio.wait_for(
                    asyncio.to_thread(svc.get_snapshot, idx, exp),
                    timeout=15.0,
                )
                return idx, snap, None
            except asyncio.TimeoutError:
                return idx, None, "timeout"
            except Exception as e:
                return idx, None, e

        results = await asyncio.gather(*[_fetch_one(idx) for idx in enabled])

        any_ok = False
        for idx, snap, err in results:
            if err == "timeout":
                self.metrics["poll_timeouts"] += 1
                logger.error(
                    "[_poll_once] snapshot TIMEOUT for %s after 15s — skipping this tick.",
                    idx,
                    extra={"metrics": dict(self.metrics)},
                )
                self.last_error = f"snapshot timeout for {idx}"
                continue
            if err is not None:
                self.metrics["snapshot_fetch_errors"] += 1
                logger.error(
                    "[_poll_once] snapshot failed for %s: %s",
                    idx,
                    f"{type(err).__name__}: {err}",
                    extra={"metrics": dict(self.metrics)},
                )
                self.last_error = str(err)
                try:
                    from kite_maintenance import notice_from_error, merge_maintenance

                    if notice_from_error(self.last_error):
                        self.kite_maintenance = merge_maintenance(
                            self.kite_maintenance, api_error=self.last_error
                        )
                except Exception:
                    pass
                continue

            if not snap:
                self.metrics["snapshot_missing_count"] += 1
                logger.warning(
                    "[_poll_once] get_snapshot(%s) returned None — see oi_service logs above for reason.",
                    idx,
                    extra={"metrics": dict(self.metrics)},
                )
                continue

            any_ok = True
            if isinstance(self.kite_maintenance, dict) and self.kite_maintenance.get("source") == "kite_api":
                self.kite_maintenance = None
            snap["mode"] = self.mode
            self.last_snapshot[idx] = snap
            self.metrics["successful_snapshots"] += 1

            # store idempotently so the DB never accumulates duplicate rows for
            # the same market tick if the same snapshot is re-served during a
            # refresh or inline /change request.
            try:
                await self.persist_snapshot(snap, index_name=idx)
            except Exception:
                # The persist_snapshot helper already logs and updates metrics.
                pass

            # persist straddle samples for the chosen expiry (admin-selected indices only)
            try:
                straddle_enabled = self.settings.get("straddle_enabled_indices") or ["NIFTY", "SENSEX"]
                if idx in straddle_enabled:
                    await self._store_straddle_sample(idx, snap)
            except Exception as e:
                logger.debug(
                    "[_poll_once] _store_straddle_sample failed: %s",
                    e,
                    exc_info=True,
                    extra={"metrics": dict(self.metrics)},
                )

            # evaluate alerts
            try:
                await self._evaluate_alerts(idx, snap)
            except Exception as e:
                self.metrics["alert_eval_errors"] += 1
                logger.debug(
                    "[_poll_once] _evaluate_alerts failed: %s",
                    e,
                    exc_info=True,
                    extra={"metrics": dict(self.metrics)},
                )

        if any_ok:
            self._last_successful_poll_at = datetime.now(timezone.utc)
            self.last_error = None
            try:
                await self.db.system_meta.update_one(
                    {"_id": "oi_poll_heartbeat"},
                    {
                        "$set": {
                            "last_successful_poll_at": self._last_successful_poll_at.isoformat(),
                            "mode": self.mode,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                    upsert=True,
                )
            except Exception:
                pass

        # Retention prune once per poll cycle (only runs while market is open).
        # Floor: never wipe the previous trading session so weekends/holidays
        # always retain Friday (or last session) for review.
        try:
            from market_hours import previous_trading_day, session_window_utc, now_ist as _now_ist
            prev_start_utc, _ = session_window_utc(previous_trading_day(_now_ist()))
            hours_cutoff = datetime.now(timezone.utc) - timedelta(hours=SNAPSHOT_RETENTION_HOURS)
            cutoff_dt = min(hours_cutoff, prev_start_utc)
            await self.db.oi_snapshots.delete_many({"created_at": {"$lt": cutoff_dt.isoformat()}})
        except Exception as e:
            self.metrics["retention_prune_errors"] = self.metrics.get("retention_prune_errors", 0) + 1
            logger.debug(
                "[_poll_once] retention prune failed: %s",
                e,
                exc_info=True,
                extra={"metrics": dict(self.metrics)},
            )

        self.last_updated_at = datetime.now(timezone.utc).isoformat()

    async def _store_straddle_sample(self, index_name: str, snap: Dict[str, Any]):
        try:
            # Chart density capped at 30s even if admin picks 60/120 (FinanceDeft-style).
            try:
                interval = max(5, min(30, int(self.settings.get("straddle_poll_interval_seconds", 15))))
            except Exception:
                interval = 15
            now_utc = datetime.now(timezone.utc)
            last = self._last_straddle_sample_at.get(index_name)
            if last is not None and (now_utc - last).total_seconds() < max(3, interval - 2):
                return

            atm = int(snap.get("atm") or 0)
            price = float(snap.get("price") or 0.0)
            # Prefer pre-computed premium from lightweight ATM quote.
            if snap.get("premium") is not None and snap.get("ce_ltp") is not None:
                ce_p = float(snap.get("ce_ltp") or 0)
                pe_p = float(snap.get("pe_ltp") or 0)
                premium = round(float(snap.get("premium")), 2)
            else:
                strikes = snap.get("strikes", [])
                strike_obj = None
                for s in strikes:
                    if int(s.get("strike")) == atm:
                        strike_obj = s
                        break
                if not strike_obj and strikes:
                    strikes_list = sorted([int(s.get("strike")) for s in strikes if s.get("strike") is not None])
                    if strikes_list:
                        closest = min(strikes_list, key=lambda x: abs(x - atm))
                        for s in strikes:
                            if int(s.get("strike")) == closest:
                                strike_obj = s
                                atm = closest
                                break
                ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
                pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
                premium = round(ce_p + pe_p, 2)

            # Reject garbage quotes that blow up the chart (spikes to 1000+).
            if premium <= 0 or ce_p <= 0 or pe_p <= 0 or price <= 0:
                return
            # Sticky ATM: keep last ATM until spot moves ≥ 0.6× step to avoid
            # half-step flicker swapping CE/PE legs mid-bucket.
            try:
                from oi_service import INDEX_CONFIG
                step = float((INDEX_CONFIG.get(index_name) or {}).get("step") or 50)
            except Exception:
                step = 50.0
            prev_q = self.last_straddle_quote.get(index_name) or {}
            prev_atm = int(prev_q.get("atm") or 0)
            if prev_atm and abs(price - prev_atm) < 0.6 * step:
                # Recompute premium at sticky ATM only when quote already matches.
                if atm != prev_atm and snap.get("ce_ltp") is not None:
                    # Quote was for a new ATM — skip until sticky zone is left.
                    return
                atm = prev_atm
            prev_prem = float(prev_q.get("premium") or 0)
            if prev_prem > 0 and premium > max(prev_prem * 3.0, prev_prem + 200):
                logger.warning(
                    "[_store_straddle_sample] skip outlier %s premium=%.2f vs prev=%.2f",
                    index_name, premium, prev_prem,
                )
                return

            trade_date = now_ist().date().isoformat()
            doc = {
                "index": index_name,
                "expiry": snap.get("expiry"),
                "trade_date": trade_date,
                "ts": snap.get("timestamp") or now_utc.isoformat(),
                "premium": premium,
                "underlying": round(price, 2),
                "atm": atm,
                "ce_ltp": round(ce_p, 2),
                "pe_ltp": round(pe_p, 2),
                "created_at": now_utc.isoformat(),
            }
            await self.db.straddle_samples.insert_one(doc)
            self._last_straddle_sample_at[index_name] = now_utc
            self.last_straddle_quote[index_name] = {
                "ts": doc["ts"],
                "premium": premium,
                "underlying": round(price, 2),
                "atm": atm,
                "ce_ltp": round(ce_p, 2),
                "pe_ltp": round(pe_p, 2),
                "expiry": snap.get("expiry"),
            }
            await self._prune_straddle_history(index_name)
        except Exception as e:
            self.metrics["straddle_store_errors"] += 1
            logger.warning(
                "[_store_straddle_sample] failed for %s: %s",
                index_name,
                e,
                exc_info=True,
                extra={"metrics": dict(self.metrics)},
            )

    async def _prune_straddle_history(self, index_name: str):
        try:
            today_ist = now_ist().date().isoformat()
            await self.db.straddle_samples.delete_many({"index": index_name, "expiry": {"$lt": today_ist}})
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=STRADDLE_RETENTION_HOURS)).isoformat()
            await self.db.straddle_samples.delete_many({"index": index_name, "expiry": {"$exists": False}, "created_at": {"$lt": cutoff}})
        except Exception as e:
            logger.debug(f"[_prune_straddle_history] failed for {index_name}: {e}")

    async def _evaluate_alerts(self, index_name: str, current: Dict[str, Any]):
        """Compare current OI vs snapshot ~N minutes ago and detect reversal spikes.

        Only runs when the NSE market is currently OPEN. Prevents "market closed"
        stale-data alerts from firing during pre-open / post-close / weekend / holiday
        windows — the user was seeing bullish/bearish alerts long after 3:30 PM.
        """
        if not (FORCE_ALWAYS_POLL or is_market_open()):
            return
        # Weekday alert focus (NIFTY Mon/Tue/Fri, SENSEX Wed/Thu) unless overridden today.
        self._refresh_alert_indices_for_today()
        alert_idxs = self.settings.get("alert_enabled_indices") or []
        if isinstance(alert_idxs, str):
            alert_idxs = [alert_idxs]
        elif not isinstance(alert_idxs, (list, tuple)):
            alert_idxs = []
        alert_idxs = [str(x) for x in alert_idxs if x]
        # Never silently alert nobody — fall back to weekday defaults if empty.
        if not alert_idxs:
            alert_idxs = list(default_alert_indices_for_today() or [])
            self.settings["alert_enabled_indices"] = alert_idxs
        # Admin alert focus is authoritative: non-selected indices never alert,
        # even while their OI data continues to poll/load.
        if index_name not in alert_idxs:
            return
        cutoff_min = int(self.settings.get("compare_minutes", 3))
        threshold_pct = float(self.settings.get("threshold_pct", 15.0))
        cooldown = int(self.settings.get("cooldown_seconds", 120))
        target = datetime.now(timezone.utc) - timedelta(minutes=cutoff_min)
        cursor = self.db.oi_snapshots.find(
            {"index": index_name, "timestamp": {"$lte": target.isoformat()}},
            {"_id": 0}
        ).sort("timestamp", -1).limit(1)
        prev_list = await cursor.to_list(length=1)
        if not prev_list:
            return
        prev = prev_list[0]
        prev_map = {s["strike"]: s for s in prev["strikes"]}

        spike_strikes = []
        for s in current["strikes"]:
            p = prev_map.get(s["strike"])
            if not p:
                continue
            ce_change = s["ce_oi"] - p["ce_oi"]
            pe_change = s["pe_oi"] - p["pe_oi"]
            ce_pct = (ce_change / p["ce_oi"] * 100) if p["ce_oi"] else 0
            pe_pct = (pe_change / p["pe_oi"] * 100) if p["pe_oi"] else 0
            # thresholds
            if abs(ce_pct) >= threshold_pct or abs(pe_pct) >= threshold_pct:
                spike_strikes.append({
                    "strike": s["strike"],
                    "ce_pct": round(ce_pct, 2),
                    "pe_pct": round(pe_pct, 2),
                    "ce_abs": ce_change,
                    "pe_abs": pe_change,
                })

        if not spike_strikes:
            return
        # dedupe: don't alert twice within 2 minutes for the same index
        recent = await self.db.alerts.find_one(
            {"index": index_name},
            sort=[("created_at", -1)],
        )
        if recent:
            try:
                last_ts = datetime.fromisoformat(recent["created_at"])
                if (datetime.now(timezone.utc) - last_ts).total_seconds() < cooldown:
                    return
            except Exception:
                pass

        # classify direction (bullish reversal = PE OI dropping / CE OI dropping)
        avg_ce = sum(x["ce_pct"] for x in spike_strikes) / len(spike_strikes)
        avg_pe = sum(x["pe_pct"] for x in spike_strikes) / len(spike_strikes)
        if avg_ce > avg_pe:
            direction = "Bearish pressure (Call OI building)"
            severity = "warning"
        elif avg_pe > avg_ce:
            direction = "Bullish pressure (Put OI building)"
            severity = "info"
        else:
            direction = "OI reversal spike"
            severity = "warning"

        alert = {
            "index": index_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "price": current["price"],
            "atm": current["atm"],
            "direction": direction,
            "severity": severity,
            "strikes": spike_strikes[:10],
            "message": f"{index_name}: {direction} detected across {len(spike_strikes)} strike(s)",
        }
        await self.db.alerts.insert_one(alert)
        logger.warning("ALERT: %s", alert["message"])
        # Forward to Telegram (fire-and-forget; graceful no-op if not configured)
        try:
            await notifier.alert_oi_spike(alert)
        except Exception as e:
            logger.warning(f"telegram forward failed: {e}")

    async def build_daily_digest(self) -> dict:
        """Aggregate today's alerts and closing snapshots for the daily Telegram digest."""
        from market_hours import IST
        today_ist = now_ist().date()
        start_utc = datetime.combine(today_ist, datetime.min.time()).replace(tzinfo=IST).astimezone(timezone.utc)
        alerts_today = await self.db.alerts.find(
            {"created_at": {"$gte": start_utc.isoformat()}},
            {"_id": 0}
        ).sort("created_at", -1).to_list(length=1000)

        indices_out = []
        for idx in INDICES:
            snap = self.last_snapshot.get(idx) or {}
            idx_alerts = [a for a in alerts_today if a.get("index") == idx]
            # biggest bullish PE build (highest positive pe_pct across all alert strikes today)
            top_bullish = None
            top_bearish = None
            best_pe = -1e9
            best_ce = -1e9
            for a in idx_alerts:
                for s in a.get("strikes", []):
                    if s.get("pe_pct", 0) > best_pe:
                        best_pe = s["pe_pct"]
                        top_bullish = {"index": idx, "strike": s.get("strike"), "pe_pct": s.get("pe_pct", 0)}
                    if s.get("ce_pct", 0) > best_ce:
                        best_ce = s["ce_pct"]
                        top_bearish = {"index": idx, "strike": s.get("strike"), "ce_pct": s.get("ce_pct", 0)}
            indices_out.append({
                "index": idx,
                "closing_price": snap.get("price"),
                "atm": snap.get("atm"),
                "total_alerts": len(idx_alerts),
                "top_bullish": top_bullish,
                "top_bearish": top_bearish,
            })

        return {
            "date": today_ist.isoformat(),
            "alerts_total": len(alerts_today),
            "indices": indices_out,
        }

    async def get_status(self):
        ms = market_status()
        poll_interval_seconds = self.poll_interval_seconds()
        err = (self.last_error or "").lower()
        # Only real auth/token failures — do NOT match generic "incorrect" / bare "token"
        # (those false-positive on transient snapshot errors and flash Reconnect in the UI).
        token_bad = bool(
            self.kite_service is not None
            and any(
                k in err
                for k in (
                    "tokenexception",
                    "invalid token",
                    "access_token",
                    "incorrect `api_key`",
                    "incorrect api_key",
                    "unauthorized",
                    "forbidden",
                    "signature mismatch",
                )
            )
        )
        kite_ok = self.mode == "kite" and self.kite_service is not None and not token_bad
        last_ok = self._last_successful_poll_at.isoformat() if self._last_successful_poll_at else None
        maint = self.kite_maintenance if isinstance(self.kite_maintenance, dict) else None
        return {
            "running": self.running,
            "mode": self.mode,
            "last_updated_at": self.last_updated_at,
            "last_successful_poll_at": last_ok,
            "last_error": self.last_error,
            "has_kite_credentials": self.kite_service is not None,
            "kite_ok": kite_ok,
            # Missing credentials → has_kite_credentials=false. Token death only.
            "kite_token_issue": bool(token_bad),
            "kite_user_id": self.kite_user_id,
            "kite_maintenance": maint,
            "poll_interval_seconds": poll_interval_seconds,
            "stale_after_seconds": self.stale_after_seconds(),
            "market": ms,
            "telegram_configured": notifier.is_configured(),
            "retention_hours": SNAPSHOT_RETENTION_HOURS,
            "always_poll": FORCE_ALWAYS_POLL,
            "metrics": {
                "poll_cycles": int(self.metrics.get("poll_cycles", 0)),
                "poll_timeouts": int(self.metrics.get("poll_timeouts", 0)),
                "snapshot_fetch_errors": int(self.metrics.get("snapshot_fetch_errors", 0)),
                "snapshot_missing_count": int(self.metrics.get("snapshot_missing_count", 0)),
                "snapshot_upsert_errors": int(self.metrics.get("snapshot_upsert_errors", 0)),
                "retention_prune_errors": int(self.metrics.get("retention_prune_errors", 0)),
                "straddle_store_errors": int(self.metrics.get("straddle_store_errors", 0)),
                "alert_eval_errors": int(self.metrics.get("alert_eval_errors", 0)),
                "successful_snapshots": int(self.metrics.get("successful_snapshots", 0)),
            },
        }
