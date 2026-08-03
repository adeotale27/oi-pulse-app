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


# MockService moved to backend/dev/mock_service.py and is imported only when ENABLE_DEV_MOCK=true
# This keeps demo/mock code available for local development while preventing
# accidental exposure in production builds.

# If you need the mock service for local dev, set ENV ENABLE_DEV_MOCK=true and
# the OI tracker will import dev.mock_service.MockService at runtime.
