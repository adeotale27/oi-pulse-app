"""
Background OI tracker - polls Kite / Mock every N seconds, stores snapshots in Mongo,
and evaluates alert rules for OI reversal spikes.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from oi_service import KiteService, MockService, INDEX_CONFIG

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 15
INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"]

DEFAULT_SETTINGS = {
    "threshold_pct": 15.0,      # % OI change to trigger alert
    "cooldown_seconds": 120,    # per-index alert cooldown
    "compare_minutes": 3,       # compare with snapshot from N minutes ago
    "enabled_indices": ["NIFTY", "SENSEX"],  # which indices to poll (BANKNIFTY optional)
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
        allowed = {"threshold_pct", "cooldown_seconds", "compare_minutes", "enabled_indices"}
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
        if doc and doc.get("api_key") and doc.get("access_token"):
            try:
                self.kite_service = KiteService(doc["api_key"], doc["access_token"])
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
            {"$set": {"api_key": api_key, "access_token": access_token,
                      "updated_at": datetime.now(timezone.utc).isoformat()}},
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

    async def _loop(self):
        while self.running:
            try:
                await self._poll_once()
            except Exception as e:
                logger.exception("poll error: %s", e)
                self.last_error = str(e)
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

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
            # store
            await self.db.oi_snapshots.insert_one({**snap, "created_at": datetime.now(timezone.utc).isoformat()})
            # keep only last 6 hours
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
            await self.db.oi_snapshots.delete_many({"created_at": {"$lt": cutoff}})
            # evaluate alerts
            await self._evaluate_alerts(idx, snap)
        self.last_updated_at = datetime.now(timezone.utc).isoformat()

    async def _evaluate_alerts(self, index_name: str, current: Dict[str, Any]):
        """Compare current OI vs snapshot ~N minutes ago and detect reversal spikes."""
        cutoff_min = int(self.settings.get("compare_minutes", 3))
        threshold_pct = float(self.settings.get("threshold_pct", 15.0))
        cooldown = int(self.settings.get("cooldown_seconds", 120))
        target = datetime.now(timezone.utc) - timedelta(minutes=cutoff_min)
        cursor = self.db.oi_snapshots.find(
            {"index": index_name, "created_at": {"$lte": target.isoformat()}},
            {"_id": 0}
        ).sort("created_at", -1).limit(1)
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

    async def get_status(self):
        return {
            "running": self.running,
            "mode": self.mode,
            "last_updated_at": self.last_updated_at,
            "last_error": self.last_error,
            "has_kite_credentials": self.kite_service is not None,
            "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        }
