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
INDICES = ["NIFTY", "SENSEX"]


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
        try:
            svc = KiteService(api_key, access_token)
            # smoke test
            svc.kite.profile()
        except Exception as e:
            raise RuntimeError(f"Invalid Kite credentials: {e}")
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
        for idx in INDICES:
            try:
                snap = await asyncio.to_thread(svc.get_snapshot, idx)
            except Exception as e:
                logger.error(f"snapshot failed for {idx}: {e}")
                self.last_error = str(e)
                continue
            if not snap:
                continue
            snap["mode"] = self.mode
            self.last_snapshot[idx] = snap
            # store
            await self.db.oi_snapshots.insert_one({**snap, "created_at": datetime.now(timezone.utc).isoformat()})
            # keep only last 4 hours
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
            await self.db.oi_snapshots.delete_many({"created_at": {"$lt": cutoff}})
            # evaluate alerts
            await self._evaluate_alerts(idx, snap)
        self.last_updated_at = datetime.now(timezone.utc).isoformat()

    async def _evaluate_alerts(self, index_name: str, current: Dict[str, Any]):
        """Compare current OI vs snapshot ~3 minutes ago and detect reversal spikes."""
        cutoff_min = 3
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
            if abs(ce_pct) >= 15 or abs(pe_pct) >= 15:
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
                if (datetime.now(timezone.utc) - last_ts).total_seconds() < 120:
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
