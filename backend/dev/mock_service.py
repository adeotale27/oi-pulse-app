"""
Dev-only MockService moved here. Enabled only when ENABLE_DEV_MOCK=true.
"""
import os
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from oi_service import INDEX_CONFIG

logger = logging.getLogger(__name__)

class MockService:
    """Realistic OI simulator - persistent state per index so bars evolve smoothly.

    This is intended for development/testing only. It is imported only when
    the environment variable ENABLE_DEV_MOCK=true to avoid accidental usage in
    production deployments.
    """

    def __init__(self):
        self._state: Dict[str, Dict[str, Any]] = {}
        self._base_price = {"NIFTY": 23800.0, "SENSEX": 78500.0, "BANKNIFTY": 51200.0}
        self._weekday_by_index = {"NIFTY": 1, "BANKNIFTY": 1, "SENSEX": 3}
        from datetime import date
        today = date.today()
        self._expiries_by_index: Dict[str, list] = {}
        for idx, weekday in self._weekday_by_index.items():
            days_ahead = (weekday - today.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7
            first = today + timedelta(days=days_ahead)
            self._expiries_by_index[idx] = sorted([(first + timedelta(days=7 * k)).isoformat() for k in range(6)])
        for idx in ("NIFTY", "SENSEX", "BANKNIFTY"):
            self._init_index(idx)

    def _init_index(self, index_name: str):
        cfg = INDEX_CONFIG[index_name]
        base = self._base_price[index_name]
        step = cfg["step"]
        atm = round(base / step) * step
        n = cfg["strikes_around_atm"]
        strikes = [atm + i * step for i in range(-n, n + 1)]
        expiries = self._expiries_by_index[index_name]
        by_expiry = {}
        for ei, exp in enumerate(expiries):
            _mults = [1.0, 0.55, 0.28, 0.15, 0.09, 0.06, 0.04, 0.03]
            multiplier = _mults[ei] if ei < len(_mults) else 0.03
            strike_map = {}
            for st in strikes:
                distance = abs(st - atm) / step
                base_oi = max(500_000, int(9_000_000 * (0.9 ** distance) * multiplier))
                ce_bias = 1.4 if st > atm else 0.9
                pe_bias = 1.4 if st < atm else 0.9
                strike_map[st] = {
                    "ce_oi": int(base_oi * ce_bias * random.uniform(0.85, 1.15)),
                    "pe_oi": int(base_oi * pe_bias * random.uniform(0.85, 1.15)),
                    "ce_ltp": max(0.5, (atm - st) if st < atm else random.uniform(5, 60)),
                    "pe_ltp": max(0.5, (st - atm) if st > atm else random.uniform(5, 60)),
                }
            by_expiry[exp] = strike_map
        self._state[index_name] = {"price": base, "atm": atm, "expiries": by_expiry}

    def list_expiries(self, index_name: str):
        return list(self._expiries_by_index.get(index_name, []))

    def get_snapshot(self, index_name: str, expiry: Optional[str] = None) -> Dict[str, Any]:
        cfg = INDEX_CONFIG[index_name]
        state = self._state[index_name]
        expiries = self._expiries_by_index[index_name]
        exp = expiry or expiries[0]
        if exp not in state["expiries"]:
            exp = expiries[0]
        strike_map = state["expiries"][exp]
        drift = random.uniform(-0.0005, 0.0005)
        state["price"] = state["price"] * (1 + drift)
        step = cfg["step"]
        new_atm = round(state["price"] / step) * step
        state["atm"] = new_atm
        n = cfg["strikes_around_atm"]
        needed = [new_atm + i * step for i in range(-n, n + 1)]
        for st in needed:
            if st not in strike_map:
                distance = abs(st - new_atm) / step
                base_oi = max(500_000, int(9_000_000 * (0.9 ** distance)))
                strike_map[st] = {
                    "ce_oi": int(base_oi * random.uniform(0.85, 1.15)),
                    "pe_oi": int(base_oi * random.uniform(0.85, 1.15)),
                    "ce_ltp": random.uniform(5, 60),
                    "pe_ltp": random.uniform(5, 60),
                }
        for st, d in strike_map.items():
            spike_ce = random.random() < 0.008
            spike_pe = random.random() < 0.008
            ce_pct = random.uniform(-0.02, 0.02) + (random.choice([-0.2, 0.25]) if spike_ce else 0)
            pe_pct = random.uniform(-0.02, 0.02) + (random.choice([-0.2, 0.25]) if spike_pe else 0)
            d["ce_oi"] = max(10_000, int(d["ce_oi"] * (1 + ce_pct)))
            d["pe_oi"] = max(10_000, int(d["pe_oi"] * (1 + pe_pct)))
            d["ce_ltp"] = max(0.5, d["ce_ltp"] * random.uniform(0.98, 1.02))
            d["pe_ltp"] = max(0.5, d["pe_ltp"] * random.uniform(0.98, 1.02))
        strikes_list = sorted(needed)
        strikes_data = []
        total_ce = 0
        total_pe = 0
        for st in strikes_list:
            d = strike_map[st]
            total_ce += d["ce_oi"]
            total_pe += d["pe_oi"]
            strikes_data.append({
                "strike": int(st),
                "ce_oi": int(d["ce_oi"]),
                "pe_oi": int(d["pe_oi"]),
                "ce_ltp": round(d["ce_ltp"], 2),
                "pe_ltp": round(d["pe_ltp"], 2),
                "ce_volume": random.randint(5000, 500000),
                "pe_volume": random.randint(5000, 500000),
            })
        pcr = round(total_pe / total_ce, 2) if total_ce else 0.0
        vix = round(random.uniform(12.0, 18.0), 2)
        return {
            "index": index_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "price": round(state["price"], 2),
            "atm": int(new_atm),
            "expiry": exp,
            "expiries": self._expiries_by_index[index_name],
            "pcr": pcr,
            "vix": vix,
            "strikes": strikes_data,
        }
