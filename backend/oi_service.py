"""
OI Data Service - fetches Option Open Interest data from Zerodha KiteConnect
Also supports a Demo/Mock mode that generates realistic-looking OI data so the
UI is fully functional without live broker credentials.
"""
import os
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List, Any

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Index configuration
# --------------------------------------------------------------------------- #
INDEX_CONFIG = {
    "NIFTY": {
        "quote_symbol": "NSE:NIFTY 50",
        "name": "NIFTY",
        "step": 50,
        "segment": "NFO-OPT",
        "strikes_around_atm": 15,
    },
    "SENSEX": {
        "quote_symbol": "BSE:SENSEX",
        "name": "SENSEX",
        "step": 100,
        "segment": "BFO-OPT",
        "strikes_around_atm": 15,
    },
}


# --------------------------------------------------------------------------- #
# Kite (real broker) service
# --------------------------------------------------------------------------- #
class KiteService:
    def __init__(self, api_key: str, access_token: str):
        from kiteconnect import KiteConnect
        self.kite = KiteConnect(api_key=api_key)
        self.kite.set_access_token(access_token)
        self.instruments_df = None
        self.instrument_token_map: Dict[str, int] = {}
        self.token_to_symbol: Dict[int, str] = {}
        self._loaded = False

    def _load_instruments(self):
        if self._loaded:
            return
        import pandas as pd
        insts = self.kite.instruments()
        self.instruments_df = pd.DataFrame(insts)
        # index tokens
        for idx_key, cfg in INDEX_CONFIG.items():
            idx_sym = cfg["quote_symbol"].split(":")[-1]
            row = self.instruments_df[self.instruments_df["tradingsymbol"] == idx_sym]
            if not row.empty:
                token = int(row.iloc[0]["instrument_token"])
                self.instrument_token_map[idx_sym] = token
                self.token_to_symbol[token] = idx_sym
        # option tokens
        for idx_key, cfg in INDEX_CONFIG.items():
            opt_df = self.instruments_df[self.instruments_df["name"] == cfg["name"]]
            for _, row in opt_df.iterrows():
                sym = row["tradingsymbol"]
                token = int(row["instrument_token"])
                self.instrument_token_map[sym] = token
                self.token_to_symbol[token] = sym
        self._loaded = True

    def get_snapshot(self, index_name: str) -> Optional[Dict[str, Any]]:
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"load_instruments failed: {e}")
            return None

        cfg = INDEX_CONFIG[index_name]
        try:
            q = self.kite.quote(cfg["quote_symbol"])
            ltp = q[cfg["quote_symbol"]]["last_price"]
        except Exception as e:
            logger.error(f"quote index failed: {e}")
            return None

        step = cfg["step"]
        atm = round(ltp / step) * step
        n = cfg["strikes_around_atm"]
        strikes = [atm + i * step for i in range(-n, n + 1)]

        import pandas as pd
        opt_df = self.instruments_df[
            (self.instruments_df["name"] == cfg["name"])
            & (self.instruments_df["segment"] == cfg["segment"])
        ].copy()
        opt_df["expiry"] = pd.to_datetime(opt_df["expiry"])
        nearest_expiry = opt_df["expiry"].min()
        expiry_opt = opt_df[opt_df["expiry"] == nearest_expiry]

        ce_syms, pe_syms = {}, {}
        for st in strikes:
            ce = expiry_opt[(expiry_opt["strike"] == st) & (expiry_opt["instrument_type"] == "CE")]
            pe = expiry_opt[(expiry_opt["strike"] == st) & (expiry_opt["instrument_type"] == "PE")]
            if not ce.empty:
                ce_syms[st] = ce.iloc[0]["tradingsymbol"]
            if not pe.empty:
                pe_syms[st] = pe.iloc[0]["tradingsymbol"]

        all_syms = list(ce_syms.values()) + list(pe_syms.values())
        tokens = [self.instrument_token_map[s] for s in all_syms if s in self.instrument_token_map]
        if not tokens:
            return None
        try:
            quotes = self.kite.quote(tokens)
        except Exception as e:
            logger.error(f"quote options failed: {e}")
            return None

        sym_to_data = {}
        for tok, data in quotes.items():
            sym = self.token_to_symbol.get(int(tok))
            if sym:
                sym_to_data[sym] = data

        strikes_data = []
        total_ce_oi = 0
        total_pe_oi = 0
        for st in strikes:
            ce_sym = ce_syms.get(st)
            pe_sym = pe_syms.get(st)
            ce_d = sym_to_data.get(ce_sym, {}) if ce_sym else {}
            pe_d = sym_to_data.get(pe_sym, {}) if pe_sym else {}
            ce_oi = int(ce_d.get("oi", 0) or 0)
            pe_oi = int(pe_d.get("oi", 0) or 0)
            total_ce_oi += ce_oi
            total_pe_oi += pe_oi
            strikes_data.append({
                "strike": int(st),
                "ce_oi": ce_oi,
                "pe_oi": pe_oi,
                "ce_ltp": float(ce_d.get("last_price", 0) or 0),
                "pe_ltp": float(pe_d.get("last_price", 0) or 0),
                "ce_volume": int(ce_d.get("volume", 0) or 0),
                "pe_volume": int(pe_d.get("volume", 0) or 0),
            })

        pcr = round(total_pe_oi / total_ce_oi, 2) if total_ce_oi > 0 else 0.0
        vix = 0.0
        try:
            vix_q = self.kite.quote("NSE:INDIA VIX")
            vix = float(vix_q["NSE:INDIA VIX"]["last_price"])
        except Exception:
            pass

        return {
            "index": index_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "price": float(ltp),
            "atm": int(atm),
            "expiry": str(nearest_expiry.date()),
            "pcr": pcr,
            "vix": vix,
            "strikes": strikes_data,
        }


# --------------------------------------------------------------------------- #
# Mock service - generates realistic OI data with slow random walks
# --------------------------------------------------------------------------- #
class MockService:
    """Realistic OI simulator - persistent state per index so bars evolve smoothly."""

    def __init__(self):
        self._state: Dict[str, Dict[str, Any]] = {}
        # base prices
        self._base_price = {"NIFTY": 23800.0, "SENSEX": 78500.0}
        for idx in ("NIFTY", "SENSEX"):
            self._init_index(idx)

    def _init_index(self, index_name: str):
        cfg = INDEX_CONFIG[index_name]
        base = self._base_price[index_name]
        step = cfg["step"]
        atm = round(base / step) * step
        n = cfg["strikes_around_atm"]
        strikes = [atm + i * step for i in range(-n, n + 1)]
        # Seed OI with a realistic bell curve around ATM
        strike_map = {}
        for st in strikes:
            distance = abs(st - atm) / step
            base_oi = max(500_000, int(9_000_000 * (0.9 ** distance)))
            # CE higher above ATM (call writers), PE higher below ATM (put writers)
            ce_bias = 1.4 if st > atm else 0.9
            pe_bias = 1.4 if st < atm else 0.9
            strike_map[st] = {
                "ce_oi": int(base_oi * ce_bias * random.uniform(0.85, 1.15)),
                "pe_oi": int(base_oi * pe_bias * random.uniform(0.85, 1.15)),
                "ce_ltp": max(0.5, (atm - st) if st < atm else random.uniform(5, 60)),
                "pe_ltp": max(0.5, (st - atm) if st > atm else random.uniform(5, 60)),
            }
        self._state[index_name] = {
            "price": base,
            "atm": atm,
            "strikes": strike_map,
        }

    def get_snapshot(self, index_name: str) -> Dict[str, Any]:
        cfg = INDEX_CONFIG[index_name]
        state = self._state[index_name]

        # random walk price
        drift = random.uniform(-0.0005, 0.0005)
        state["price"] = state["price"] * (1 + drift)
        step = cfg["step"]
        new_atm = round(state["price"] / step) * step
        state["atm"] = new_atm

        # ensure strikes exist around new atm
        n = cfg["strikes_around_atm"]
        needed = [new_atm + i * step for i in range(-n, n + 1)]
        for st in needed:
            if st not in state["strikes"]:
                distance = abs(st - new_atm) / step
                base_oi = max(500_000, int(9_000_000 * (0.9 ** distance)))
                state["strikes"][st] = {
                    "ce_oi": int(base_oi * random.uniform(0.85, 1.15)),
                    "pe_oi": int(base_oi * random.uniform(0.85, 1.15)),
                    "ce_ltp": random.uniform(5, 60),
                    "pe_ltp": random.uniform(5, 60),
                }

        # update OI with small random walk; occasional 'spike' to trigger alerts
        for st, d in state["strikes"].items():
            spike_ce = random.random() < 0.008
            spike_pe = random.random() < 0.008
            ce_pct = random.uniform(-0.02, 0.02) + (random.choice([-0.2, 0.25]) if spike_ce else 0)
            pe_pct = random.uniform(-0.02, 0.02) + (random.choice([-0.2, 0.25]) if spike_pe else 0)
            d["ce_oi"] = max(10_000, int(d["ce_oi"] * (1 + ce_pct)))
            d["pe_oi"] = max(10_000, int(d["pe_oi"] * (1 + pe_pct)))
            d["ce_ltp"] = max(0.5, d["ce_ltp"] * random.uniform(0.98, 1.02))
            d["pe_ltp"] = max(0.5, d["pe_ltp"] * random.uniform(0.98, 1.02))

        # build response
        strikes_list = sorted(needed)
        strikes_data = []
        total_ce = 0
        total_pe = 0
        for st in strikes_list:
            d = state["strikes"][st]
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
        # random VIX
        vix = round(random.uniform(12.0, 18.0), 2)
        expiry = (datetime.now() + timedelta(days=(3 - datetime.now().weekday()) % 7 or 7)).date()

        return {
            "index": index_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "price": round(state["price"], 2),
            "atm": int(new_atm),
            "expiry": str(expiry),
            "pcr": pcr,
            "vix": vix,
            "strikes": strikes_data,
        }
