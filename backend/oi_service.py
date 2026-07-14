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
    "BANKNIFTY": {
        "quote_symbol": "NSE:NIFTY BANK",
        "name": "BANKNIFTY",
        "step": 100,
        "segment": "NFO-OPT",
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

    def list_expiries(self, index_name: str):
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"list_expiries load failed: {e}")
            return []
        import pandas as pd
        cfg = INDEX_CONFIG[index_name]
        opt_df = self.instruments_df[
            (self.instruments_df["name"] == cfg["name"])
            & (self.instruments_df["segment"] == cfg["segment"])
        ]
        expiries = sorted({str(pd.to_datetime(x).date()) for x in opt_df["expiry"].unique()})
        return expiries

    def get_snapshot(self, index_name: str, expiry: Optional[str] = None) -> Optional[Dict[str, Any]]:
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"[get_snapshot:{index_name}] load_instruments failed: {type(e).__name__}: {e}")
            return None

        cfg = INDEX_CONFIG[index_name]
        ltp: float = 0.0
        try:
            q = self.kite.quote(cfg["quote_symbol"])
            ltp = q[cfg["quote_symbol"]]["last_price"]
        except Exception as e:
            logger.error(f"[get_snapshot:{index_name}] index quote failed for {cfg['quote_symbol']}: {type(e).__name__}: {e}")
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
        if opt_df.empty:
            logger.error(f"[get_snapshot:{index_name}] no option rows found in instruments_df for name={cfg['name']} segment={cfg['segment']}")
            return None
        opt_df["expiry"] = pd.to_datetime(opt_df["expiry"])
        available = sorted(opt_df["expiry"].unique())
        if not available:
            logger.error(f"[get_snapshot:{index_name}] no expiries available")
            return None
        if expiry:
            selected = pd.to_datetime(expiry)
            if selected not in available:
                logger.warning(f"[get_snapshot:{index_name}] requested expiry {expiry} not available; falling back to {available[0]}")
                selected = available[0]
        else:
            selected = available[0]
        expiry_opt = opt_df[opt_df["expiry"] == selected]
        all_expiries = [str(pd.Timestamp(x).date()) for x in available]

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
            logger.error(
                f"[get_snapshot:{index_name}] EMPTY tokens for expiry={selected} atm={atm} "
                f"strikes_count={len(strikes)} ce_syms={len(ce_syms)} pe_syms={len(pe_syms)} "
                f"instrument_token_map_size={len(self.instrument_token_map)}"
            )
            return None
        try:
            quotes = self.kite.quote(tokens)
        except Exception as e:
            logger.error(f"[get_snapshot:{index_name}] options quote failed (tokens={len(tokens)}): {type(e).__name__}: {e}")
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
            "expiry": str(pd.Timestamp(selected).date()),
            "expiries": all_expiries,
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
        self._base_price = {"NIFTY": 23800.0, "SENSEX": 78500.0, "BANKNIFTY": 51200.0}
        # generate 4 synthetic weekly expiries
        from datetime import date
        today = date.today()
        # weekly Thursday for NFO, Tuesday for BFO — but we just use 7-day rolls
        self._expiries = [
            (today + timedelta(days=(((3 - today.weekday()) % 7) or 7) + 7 * k)).isoformat()
            for k in range(4)
        ]
        for idx in ("NIFTY", "SENSEX", "BANKNIFTY"):
            self._init_index(idx)

    def _init_index(self, index_name: str):
        cfg = INDEX_CONFIG[index_name]
        base = self._base_price[index_name]
        step = cfg["step"]
        atm = round(base / step) * step
        n = cfg["strikes_around_atm"]
        strikes = [atm + i * step for i in range(-n, n + 1)]
        # Seed OI per expiry - farther expiries have less OI
        by_expiry = {}
        for ei, exp in enumerate(self._expiries):
            multiplier = [1.0, 0.55, 0.28, 0.15][ei]
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
        self._state[index_name] = {
            "price": base,
            "atm": atm,
            "expiries": by_expiry,
        }

    def list_expiries(self, index_name: str):
        return list(self._expiries)

    def get_snapshot(self, index_name: str, expiry: Optional[str] = None) -> Dict[str, Any]:
        cfg = INDEX_CONFIG[index_name]
        state = self._state[index_name]
        exp = expiry or self._expiries[0]
        if exp not in state["expiries"]:
            # If unknown, fall back to nearest
            exp = self._expiries[0]
        strike_map = state["expiries"][exp]

        # random walk price (shared across expiries)
        drift = random.uniform(-0.0005, 0.0005)
        state["price"] = state["price"] * (1 + drift)
        step = cfg["step"]
        new_atm = round(state["price"] / step) * step
        state["atm"] = new_atm

        # ensure strikes exist around new atm for THIS expiry
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

        # update OI with small random walk; occasional 'spike' for alerts
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
            "expiries": self._expiries,
            "pcr": pcr,
            "vix": vix,
            "strikes": strikes_data,
        }
