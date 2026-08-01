"""
Background OI tracker - polls Kite / Mock every N seconds, stores snapshots in Mongo,
and evaluates alert rules for OI reversal spikes.

Polls ONLY during NSE market hours (9:00–15:30 IST, Mon–Fri, excl. holidays)
when FORCE_ALWAYS_POLL=false (default). Retains 24 h of snapshots so any
timeframe from 5 min – 4 h has data available.
"""
import asyncio
import logging
import os
import base64
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from oi_service import KiteService, MockService, INDEX_CONFIG
from market_hours import is_market_open, market_status, now_ist
import notifier

logger = logging.getLogger(__name__)


def _fernet():
    from cryptography.fernet import Fernet
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

# Data retention: keep 24 hours so a full trading day (9:00–15:30 = 6.5h)
# plus overnight review is always available.
SNAPSHOT_RETENTION_HOURS = int(os.environ.get("SNAPSHOT_RETENTION_HOURS", "24"))
STRADDLE_RETENTION_HOURS = int(os.environ.get("STRADDLE_RETENTION_HOURS", "48"))

# When true, poll 24/7 (dev / mock). When false, poll only inside NSE hours.
FORCE_ALWAYS_POLL = os.environ.get("FORCE_ALWAYS_POLL", "false").lower() == "true"

# Sleep interval when market is closed — check every 60s if window has opened.
CLOSED_MARKET_SLEEP_SECONDS = 60

DEFAULT_SETTINGS = {
    "threshold_pct": 15.0,      # % OI change to trigger alert
    "cooldown_seconds": 120,    # per-index alert cooldown
    "compare_minutes": 3,       # compare with snapshot from N minutes ago
    "enabled_indices": ["NIFTY", "SENSEX", "BANKNIFTY"],  # which indices to poll (BANKNIFTY optional)
    "oi_poll_interval_seconds": 15,  # OI data pull interval (15/30/60 seconds)
    "straddle_poll_interval_seconds": 60,  # Straddle data pull interval (default 60 = 1 minute)
    "straddle_enabled_indices": ["NIFTY", "SENSEX"],  # Which indices to track for straddle
    "visible_pages": ["oi-change", "open-interest", "strike-table", "buildup", "alerts", "activity", "holidays", "straddle", "index-events"],
}


class OITracker:
    def __init__(self, db):
        self.db = db
        self.kite_service: Optional[KiteService] = None
        self.mock_service = MockService()
        self.mode = "mock"  # "kite" or "mock"
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.last_error: Optional[str] = None
        self.last_snapshot: Dict[str, Dict[str, Any]] = {}
        self.last_updated_at: Optional[str] = None
        self.settings: Dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.selected_expiry: Dict[str, Optional[str]] = {i: None for i in INDICES}

    async def load_settings(self):
        doc = await self.db.settings.find_one({"_id": "alerts"})
        if doc:
            self.settings.update({k: v for k, v in doc.items() if k != "_id"})

    async def save_settings(self, patch: Dict[str, Any]):
        allowed = {"threshold_pct", "cooldown_seconds", "compare_minutes", "enabled_indices", 
                   "oi_poll_interval_seconds", "straddle_poll_interval_seconds", "straddle_enabled_indices", "visible_pages"}
        clean = {k: v for k, v in patch.items() if k in allowed}
        self.settings.update(clean)
        await self.db.settings.update_one(
            {"_id": "alerts"}, {"$set": clean}, upsert=True
        )
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

    async def load_credentials(self):
        """Load saved kite credentials from DB and initialize KiteService if present."""
        doc = await self.db.credentials.find_one({"_id": "kite"})
        api_key = _decrypt_secret(doc.get("api_key_enc")) if doc else None
        access_token = _decrypt_secret(doc.get("access_token_enc")) if doc else None
        if not api_key and doc and doc.get("api_key"):
            api_key = doc.get("api_key")
        if not access_token and doc and doc.get("access_token"):
            access_token = doc.get("access_token")
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
        if api_key and access_token:
            try:
                self.kite_service = KiteService(api_key, access_token)
                self.mode = "kite"
                self.last_error = None
                logger.info("KiteService initialized from stored credentials.")
                return True
            except Exception as e:
                self.last_error = f"Kite init failed: {e}"
                self.kite_service = None
                self.mode = "mock"
                logger.error(self.last_error)
                return False
        self.mode = "mock"
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
        await self.db.credentials.update_one(
            {"_id": "kite"},
            {"$set": {
                "api_key_enc": _encrypt_secret(api_key),
                "access_token_enc": _encrypt_secret(access_token),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, "$unset": {"api_key": "", "access_token": ""}},
            upsert=True,
        )
        self.kite_service = svc
        self.mode = "kite"
        self.last_error = None

    async def set_mode(self, mode: str):
        if mode not in ("kite", "mock"):
            raise ValueError("mode must be 'kite' or 'mock'")
        if mode == "kite" and self.kite_service is None:
            raise RuntimeError("No Kite credentials configured")
        self.mode = mode

    def _get_service(self):
        if self.mode == "kite" and self.kite_service:
            return self.kite_service
        return self.mock_service

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("OI tracker started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("OI tracker stopped")

    def _seconds_until_next_poll_boundary(self, interval_seconds: int) -> float:
        """Return the fractional delay to the next aligned poll boundary.

        Examples for a 15s poll interval:
          - at 09:46:47 → sleep until 09:47:00 (13s)
          - at 09:47:00 → sleep until 09:47:15 (15s)
        """
        now = datetime.now()
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
                        logger.info("Market OPEN — starting polling.")
                        await notifier.alert_market_open()
                        was_open = True
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

    async def _premarket_check(self):
        """Between 8:45 and 9:00 IST on trading days, verify Kite is usable.
        If not, ping the user on Telegram (once per day)."""
        try:
            dt = now_ist()
            if dt.weekday() >= 5:
                return
            if not (dt.hour == 8 and dt.minute >= 45):
                return
            if self.mode != "kite" or self.kite_service is None:
                await notifier.alert_kite_token_issue(
                    "Tracker is in MOCK mode — no Kite credentials configured."
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
        svc = self._get_service()
        enabled = self.settings.get("enabled_indices", INDICES)
        for idx in enabled:
            if idx not in INDICES:
                continue
            try:
                exp = self.selected_expiry.get(idx)
                # P0 FIX: wrap per-index fetch in a hard 10s timeout so that a
                # silently-hanging quote() call on ONE index can never starve
                # the entire poll loop (which was leaving other indices' caches
                # stale — root cause of 1/3/5/10/15 min returning identical
                # deltas).
                snap = await asyncio.wait_for(
                    asyncio.to_thread(svc.get_snapshot, idx, exp),
                    timeout=10.0,
                )
            except asyncio.TimeoutError:
                logger.error(f"[_poll_once] snapshot TIMEOUT for {idx} after 10s — skipping this tick.")
                self.last_error = f"snapshot timeout for {idx}"
                continue
            except Exception as e:
                logger.error(f"[_poll_once] snapshot failed for {idx}: {type(e).__name__}: {e}")
                self.last_error = str(e)
                continue
            if not snap:
                logger.warning(f"[_poll_once] get_snapshot({idx}) returned None — see oi_service logs above for reason.")
                continue
            snap["mode"] = self.mode
            self.last_snapshot[idx] = snap
            # store idempotently so the DB never accumulates duplicate rows for
            # the same market tick if the same snapshot is re-served during a
            # refresh or inline /change request.
            snapshot_doc = {**snap, "created_at": datetime.now(timezone.utc).isoformat()}
            await self.db.oi_snapshots.update_one(
                {
                    "index": idx,
                    "timestamp": snapshot_doc.get("timestamp"),
                    "expiry": snapshot_doc.get("expiry"),
                },
                {"$set": snapshot_doc},
                upsert=True,
            )
            # keep only last SNAPSHOT_RETENTION_HOURS (default 24) so full day session is preserved
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=SNAPSHOT_RETENTION_HOURS)).isoformat()
            await self.db.oi_snapshots.delete_many({"created_at": {"$lt": cutoff}})
            # persist straddle samples for the chosen expiry
            await self._store_straddle_sample(idx, snap)
            # evaluate alerts
            await self._evaluate_alerts(idx, snap)
        self.last_updated_at = datetime.now(timezone.utc).isoformat()

    async def _store_straddle_sample(self, index_name: str, snap: Dict[str, Any]):
        try:
            atm = int(snap.get("atm") or 0)
            price = float(snap.get("price") or 0.0)
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
            now_utc = datetime.now(timezone.utc)
            trade_date = now_ist().date().isoformat()
            await self.db.straddle_samples.insert_one({
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
            })
            await self._prune_straddle_history(index_name)
        except Exception as e:
            logger.debug(f"[_store_straddle_sample] failed for {index_name}: {e}")

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
        poll_interval_seconds = max(1, int(self.settings.get("oi_poll_interval_seconds", POLL_INTERVAL_SECONDS)))
        return {
            "running": self.running,
            "mode": self.mode,
            "last_updated_at": self.last_updated_at,
            "last_error": self.last_error,
            "has_kite_credentials": self.kite_service is not None,
            "poll_interval_seconds": poll_interval_seconds,
            "market": ms,
            "telegram_configured": notifier.is_configured(),
            "retention_hours": SNAPSHOT_RETENTION_HOURS,
            "always_poll": FORCE_ALWAYS_POLL,
        }
