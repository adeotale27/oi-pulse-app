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

from universe import desk_index_config, nearest_fut_quote_symbol

logger = logging.getLogger(__name__)

# Live OI board — desk ids. Extra MCX/F&O names merge in via index_registry.
INDEX_CONFIG = desk_index_config()


def merge_index_config(extra: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Dict[str, Any]]:
    """Keep desk defaults; add extra pollable underlyings from the registry."""
    base = desk_index_config()
    INDEX_CONFIG.clear()
    INDEX_CONFIG.update(base)
    for k, cfg in (extra or {}).items():
        if not cfg or not cfg.get("quote_symbol") or not cfg.get("name"):
            continue
        uid = str(k).upper()
        INDEX_CONFIG[uid] = {
            "quote_symbol": cfg["quote_symbol"],
            "quote_kind": cfg.get("quote_kind") or "index",
            "name": cfg.get("name") or uid,
            "step": int(cfg.get("step") or 50),
            "segment": cfg.get("segment") or "NFO-OPT",
            "strikes_around_atm": int(cfg.get("strikes_around_atm") or 15),
            "calendar": cfg.get("calendar") or "nse",
            "session_group": cfg.get("session_group") or ("mcx_non_agri" if str(cfg.get("segment") or "").upper().startswith("MCX") or (cfg.get("quote_kind") or "") == "mcx_fut" else "nse"),
        }
    return dict(INDEX_CONFIG)


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
        # Cache India VIX across index fetches in the same poll cycle so we
        # don't burn 3 identical quote calls per cycle (NIFTY/SENSEX/BANKNIFTY).
        self._vix_cache: Optional[float] = None
        self._vix_cached_at: float = 0.0
        self._vix_ttl_seconds: float = 12.0

    def instrument_rows(self) -> List[Dict[str, Any]]:
        self._load_instruments()
        if self.instruments_df is None:
            return []
        return self.instruments_df.to_dict("records")

    def _load_instruments(self):
        if self._loaded:
            return
        import pandas as pd
        insts = self.kite.instruments()
        self.instruments_df = pd.DataFrame(insts)
        # index tokens (cash/index quotes only — MCX uses nearest FUT at snapshot time)
        for idx_key, cfg in INDEX_CONFIG.items():
            if (cfg.get("quote_kind") or "index") == "mcx_fut":
                continue
            qsym = cfg.get("quote_symbol") or ""
            idx_sym = qsym.split(":")[-1]
            if not idx_sym:
                continue
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

    def reload_instruments(self, force: bool = False):
        """Refresh the instrument universe (weekly expiry roll / new contracts)."""
        if force:
            self._loaded = False
        self._load_instruments()

    def list_expiries(self, index_name: str):
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"list_expiries load failed: {e}")
            return []
        import pandas as pd
        cfg = INDEX_CONFIG.get(index_name)
        if not cfg:
            return []
        opt_df = self.instruments_df[
            (self.instruments_df["name"] == cfg["name"])
            & (self.instruments_df["segment"] == cfg["segment"])
        ]
        expiries = sorted({str(pd.to_datetime(x).date()) for x in opt_df["expiry"].unique()})
        return expiries

    def _get_india_vix(self) -> float:
        """Return India VIX, reusing a short in-process cache across indices."""
        import time as _time
        now = _time.monotonic()
        if self._vix_cache is not None and (now - self._vix_cached_at) < self._vix_ttl_seconds:
            return float(self._vix_cache)
        try:
            vix_q = self.kite.quote("NSE:INDIA VIX")
            vix = float(vix_q["NSE:INDIA VIX"]["last_price"])
            self._vix_cache = vix
            self._vix_cached_at = now
            return vix
        except Exception:
            return float(self._vix_cache or 0.0)

    def resolve_quote_symbol(self, cfg: Dict[str, Any]) -> Optional[str]:
        """Cash/index quote, or nearest MCX FUT (rolls each poll)."""
        if (cfg.get("quote_kind") or "index") != "mcx_fut":
            return cfg.get("quote_symbol")
        self._load_instruments()
        rows = []
        if self.instruments_df is not None:
            fut = self.instruments_df[
                (self.instruments_df["name"] == cfg["name"])
                & (self.instruments_df["instrument_type"] == "FUT")
            ]
            rows = fut.to_dict("records")
        return nearest_fut_quote_symbol(rows, cfg["name"]) or cfg.get("quote_symbol")

    def _quote_ltp(self, cfg: Dict[str, Any]) -> tuple:
        key = self.resolve_quote_symbol(cfg)
        if not key:
            raise RuntimeError("no quote symbol")
        q = self.kite.quote(key)
        blob = q.get(key) if isinstance(q, dict) else None
        if not blob and isinstance(q, dict) and len(q) == 1:
            blob = next(iter(q.values()))
        if not blob:
            raise RuntimeError(f"empty quote for {key}")
        return key, float(blob.get("last_price") or 0)

    def _opt_symbol_at_strike(self, expiry_opt, st, itype: str):
        sub = expiry_opt[expiry_opt["instrument_type"] == itype]
        if sub.empty:
            return None
        exact = sub[sub["strike"] == st]
        if not exact.empty:
            return exact.iloc[0]["tradingsymbol"]
        try:
            diffs = (sub["strike"].astype(float) - float(st)).abs()
            i = diffs.idxmin()
            if float(diffs.loc[i]) <= 1e-6:
                return sub.loc[i]["tradingsymbol"]
        except Exception:
            pass
        return None

    def get_snapshot(self, index_name: str, expiry: Optional[str] = None) -> Optional[Dict[str, Any]]:
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"[get_snapshot:{index_name}] load_instruments failed: {type(e).__name__}: {e}")
            return None

        cfg = INDEX_CONFIG[index_name]
        ltp: float = 0.0
        try:
            _key, ltp = self._quote_ltp(cfg)
        except Exception as e:
            logger.error(f"[get_snapshot:{index_name}] index quote failed for {cfg.get('quote_symbol')}: {type(e).__name__}: {e}")
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
            ce_sym = self._opt_symbol_at_strike(expiry_opt, st, "CE")
            pe_sym = self._opt_symbol_at_strike(expiry_opt, st, "PE")
            if ce_sym:
                ce_syms[st] = ce_sym
            if pe_sym:
                pe_syms[st] = pe_sym

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
        vix = self._get_india_vix()

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

    def get_atm_straddle_quote(
        self, index_name: str, expiry: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Lightweight ATM CE+PE+spot quote for dense intraday straddle charts.

        Quotes only 3 instruments (index + ATM call + ATM put) instead of the
        full OI chain — cheap enough to sample every few seconds like FinanceDeft.
        """
        try:
            self._load_instruments()
        except Exception as e:
            logger.error(f"[atm_straddle:{index_name}] load_instruments failed: {e}")
            return None

        cfg = INDEX_CONFIG[index_name]
        try:
            _key, ltp = self._quote_ltp(cfg)
        except Exception as e:
            logger.error(f"[atm_straddle:{index_name}] index quote failed: {e}")
            return None

        step = cfg["step"]
        atm = int(round(ltp / step) * step)

        import pandas as pd
        opt_df = self.instruments_df[
            (self.instruments_df["name"] == cfg["name"])
            & (self.instruments_df["segment"] == cfg["segment"])
        ].copy()
        if opt_df.empty:
            return None
        opt_df["expiry"] = pd.to_datetime(opt_df["expiry"])
        available = sorted(opt_df["expiry"].unique())
        if not available:
            return None
        if expiry:
            selected = pd.to_datetime(expiry)
            if selected not in available:
                selected = available[0]
        else:
            selected = available[0]
        expiry_opt = opt_df[opt_df["expiry"] == selected]
        ce = expiry_opt[(expiry_opt["strike"] == atm) & (expiry_opt["instrument_type"] == "CE")]
        pe = expiry_opt[(expiry_opt["strike"] == atm) & (expiry_opt["instrument_type"] == "PE")]
        if ce.empty or pe.empty:
            # ATM may sit between listed strikes right after a move — pick nearest.
            strikes = sorted({int(x) for x in expiry_opt["strike"].unique() if x is not None})
            if not strikes:
                return None
            atm = int(min(strikes, key=lambda x: abs(x - atm)))
            ce = expiry_opt[(expiry_opt["strike"] == atm) & (expiry_opt["instrument_type"] == "CE")]
            pe = expiry_opt[(expiry_opt["strike"] == atm) & (expiry_opt["instrument_type"] == "PE")]
            if ce.empty or pe.empty:
                return None

        ce_sym = ce.iloc[0]["tradingsymbol"]
        pe_sym = pe.iloc[0]["tradingsymbol"]
        tokens = []
        for sym in (ce_sym, pe_sym):
            tok = self.instrument_token_map.get(sym)
            if tok is not None:
                tokens.append(int(tok))
        if len(tokens) < 2:
            return None
        try:
            quotes = self.kite.quote(tokens)
        except Exception as e:
            logger.error(f"[atm_straddle:{index_name}] options quote failed: {e}")
            return None

        sym_to_data = {}
        for tok, data in quotes.items():
            sym = self.token_to_symbol.get(int(tok))
            if sym:
                sym_to_data[sym] = data
        ce_d = sym_to_data.get(ce_sym, {})
        pe_d = sym_to_data.get(pe_sym, {})
        ce_ltp = float(ce_d.get("last_price", 0) or 0)
        pe_ltp = float(pe_d.get("last_price", 0) or 0)
        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "index": index_name,
            "timestamp": now_iso,
            "price": float(ltp),
            "atm": int(atm),
            "expiry": str(pd.Timestamp(selected).date()),
            "ce_ltp": ce_ltp,
            "pe_ltp": pe_ltp,
            "premium": round(ce_ltp + pe_ltp, 2),
            "strikes": [{
                "strike": int(atm),
                "ce_ltp": ce_ltp,
                "pe_ltp": pe_ltp,
                "ce_oi": int(ce_d.get("oi", 0) or 0),
                "pe_oi": int(pe_d.get("oi", 0) or 0),
            }],
        }


# MockService moved to backend/dev/mock_service.py and is imported only when ENABLE_DEV_MOCK=true
# This keeps demo/mock code available for local development while preventing
# accidental exposure in production builds.

# If you need the mock service for local dev, set ENV ENABLE_DEV_MOCK=true and
# the OI tracker will import dev.mock_service.MockService at runtime.
