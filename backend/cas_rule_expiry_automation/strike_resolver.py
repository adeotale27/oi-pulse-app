"""ATM / OTM strike resolution with pre-warm cache for low-latency fire.

Symbol source of truth (same idea as oi_service):
  1. Kite ``instruments`` row with ``name`` == NIFTY|SENSEX and matching segment
  2. Exact strike + CE/PE on the chosen weekly expiry (IST calendar day)
  3. Local ``instruments.db`` cache when present (same filters)
  4. Never invent tradingsymbols — only broker instrument rows
"""

from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from cas_rule_expiry_automation.expiry_calendar import INDEX_META
from cas_rule_expiry_automation.time_utils import get_ist_now

logger = logging.getLogger(__name__)


@dataclass
class Leg:
    index: str
    opt_type: str
    strike: int
    tradingsymbol: str
    exchange: str
    instrument_token: int
    lot_size: int


def round_atm(spot: float, gap: int) -> int:
    return int(round(spot / gap) * gap)


def otm_strikes(
    close_price: float, gap: int, ce_steps: int = 1, pe_steps: int = 1
) -> Tuple[int, int, int]:
    """Pick CE/PE strikes to sell at CAS close.

    Rule (expiry premium collapse):
      • Spot **below** ATM → ATM CE is OTM and goes to ~0 → sell **ATM CE**
        (not ATM+1). PE stays ``ATM − pe_steps``.
      • Spot **above** ATM → ATM PE is OTM and goes to ~0 → sell **ATM PE**
        (not ATM−1). CE stays ``ATM + ce_steps``.
      • Spot **exactly** ATM → classic wings: CE=ATM+ce_steps, PE=ATM−pe_steps.

    With default steps=1:
      spot 78954.76 → ATM 79000 → CE 79000, PE 78900
      spot 79022    → ATM 79000 → CE 79100, PE 79000
    """
    atm = round_atm(close_price, gap)
    ce_steps = max(int(ce_steps), 0)
    pe_steps = max(int(pe_steps), 0)

    if close_price < atm:
        # Prefer ATM CE (OTM). Extra ce_steps>1 still step further OTM from ATM.
        ce_strike = atm + max(ce_steps - 1, 0) * gap
        pe_strike = atm - pe_steps * gap
    elif close_price > atm:
        # Prefer ATM PE (OTM). Extra pe_steps>1 still step further OTM from ATM.
        pe_strike = atm - max(pe_steps - 1, 0) * gap
        ce_strike = atm + ce_steps * gap
    else:
        ce_strike = atm + ce_steps * gap
        pe_strike = atm - pe_steps * gap

    return atm, int(ce_strike), int(pe_strike)


def _db_path() -> str:
    import os

    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "instruments.db"
    )


def _as_date(exp) -> Optional[date]:
    if exp is None:
        return None
    if isinstance(exp, date) and not isinstance(exp, datetime):
        return exp
    if hasattr(exp, "date"):
        try:
            return exp.date()
        except Exception:
            return None
    try:
        return date.fromisoformat(str(exp)[:10])
    except Exception:
        return None


def _is_index_option(inst: Dict[str, Any], meta: Dict[str, Any]) -> bool:
    """True only for this index's CE/PE — not NIFTYNXT / FINNIFTY / etc."""
    if inst.get("instrument_type") not in ("CE", "PE"):
        return False
    name = str(inst.get("name") or "").strip().upper()
    want = str(meta["name"]).upper()
    if name:
        # Prefer exact Kite ``name`` (same filter oi_service uses).
        if name != want:
            return False
    else:
        # Rare fallback: symbol must start with index name and not a longer sibling.
        sym = str(inst.get("tradingsymbol") or "")
        if not sym.startswith(want):
            return False
        # Reject NIFTYNXT50… when looking for NIFTY
        siblings = ("NIFTYNXT", "FINNIFTY", "MIDCPNIFTY", "BANKNIFTY")
        if any(sym.startswith(s) for s in siblings if s != want and s.startswith(want)):
            return False
        if want == "NIFTY" and sym.startswith("NIFTYNXT"):
            return False
    seg = str(inst.get("segment") or "").strip().upper()
    want_seg = str(meta.get("segment") or "").strip().upper()
    if want_seg and seg and seg != want_seg:
        return False
    return True


def common_prefix(symbols: List[str]) -> str:
    if not symbols:
        return ""
    prefix = symbols[0]
    for s in symbols[1:]:
        while not s.startswith(prefix):
            prefix = prefix[:-1]
            if not prefix:
                return ""
    return prefix


def detect_expiry_prefix(kite: Any, index: str, on_date: Optional[date] = None) -> Optional[str]:
    """Find option symbol prefix for ``index``.

    Prefers contracts expiring on ``on_date`` (IST today). If none (non-expiry /
    paper practice day), falls back to the nearest upcoming weekly expiry so
    strike resolve still works for latency tests.
    """
    meta = INDEX_META[index]
    target = on_date or get_ist_now().date()
    instruments = kite.instruments(meta["exchange"])
    typed = [i for i in instruments if _is_index_option(i, meta) and i.get("expiry")]

    by_expiry: Dict[date, List[str]] = {}
    for i in typed:
        ed = _as_date(i.get("expiry"))
        if ed is None:
            continue
        sym = str(i.get("tradingsymbol") or "").strip()
        if not sym:
            continue
        by_expiry.setdefault(ed, []).append(sym)

    symbols = by_expiry.get(target) or []
    if not symbols:
        future = sorted(e for e in by_expiry if e >= target)
        if future:
            symbols = by_expiry[future[0]]
            logger.info(
                "%s: no expiry on %s — using nearest %s (%d contracts)",
                index,
                target,
                future[0],
                len(symbols),
            )
        elif by_expiry:
            # Last resort: most recent past weekly (holiday / after hours)
            past = sorted(by_expiry.keys())[-1]
            symbols = by_expiry[past]
            logger.warning("%s: using past expiry %s for prefix", index, past)
    if not symbols:
        return None
    return common_prefix(symbols)


def _validate_leg_symbol(tradingsymbol: str, opt: str, strike: int) -> str:
    sym = (tradingsymbol or "").strip()
    if not sym:
        raise RuntimeError("empty tradingsymbol from instruments")
    if not sym.endswith(opt):
        raise RuntimeError(f"symbol {sym} does not end with {opt}")
    # Strike digits appear in Zerodha weekly symbols (…24500CE). Soft-check only.
    if str(int(strike)) not in sym:
        logger.warning(
            "symbol %s may not contain strike %s — still using broker row",
            sym,
            strike,
        )
    return sym


class StrikeCache:
    """Pre-warms nearby CE/PE contracts so fire path avoids cold instrument scans."""

    def __init__(self) -> None:
        self.prefix: Dict[str, str] = {}
        # (index, opt_type, strike) -> Leg
        self._legs: Dict[Tuple[str, str, int], Leg] = {}
        self.ready_for: Dict[str, float] = {}  # index -> spot used for prewarm

    def prewarm(
        self,
        kite: Any,
        index: str,
        spot: float,
        ce_steps: int,
        pe_steps: int,
        radius: int = 5,
    ) -> int:
        meta = INDEX_META[index]
        gap = int(meta["strike_gap"])
        atm = round_atm(spot, gap)
        prefix = detect_expiry_prefix(kite, index)
        if not prefix:
            raise RuntimeError(f"No {index} expiry contracts today")
        self.prefix[index] = prefix

        strikes = {atm + i * gap for i in range(-radius, radius + 1)}
        # Cover both classic wings and ATM-biased OTM (spot below/above ATM).
        strikes |= {
            atm,
            atm + ce_steps * gap,
            atm - pe_steps * gap,
            atm + max(ce_steps - 1, 0) * gap,
            atm - max(pe_steps - 1, 0) * gap,
        }
        n = 0
        for strike in strikes:
            for opt in ("CE", "PE"):
                leg = self._lookup(kite, index, prefix, strike, opt)
                if leg:
                    self._legs[(index, opt, strike)] = leg
                    n += 1
        self.ready_for[index] = spot
        logger.info("Pre-warmed %s %d legs around ATM=%s prefix=%s", index, n, atm, prefix)
        return n

    def resolve(
        self,
        kite: Any,
        index: str,
        close_price: float,
        ce_steps: int,
        pe_steps: int,
    ) -> List[Leg]:
        """Hot-path strike resolve — same otm_strikes() rule as backtest. Prefers cache."""
        t0 = time.perf_counter()
        meta = INDEX_META[index]
        gap = int(meta["strike_gap"])
        atm, ce_strike, pe_strike = otm_strikes(close_price, gap, ce_steps, pe_steps)
        prefix = self.prefix.get(index) or detect_expiry_prefix(kite, index)
        if not prefix:
            raise RuntimeError(f"No expiry prefix for {index}")

        out: List[Leg] = []
        for opt, strike in (("CE", ce_strike), ("PE", pe_strike)):
            key = (index, opt, strike)
            leg = self._legs.get(key)
            if leg is None:
                # Cache miss — last resort lookup (should be rare after prewarm)
                leg = self._lookup(kite, index, prefix, strike, opt)
                if leg:
                    self._legs[key] = leg
            if leg is None:
                raise RuntimeError(f"Missing {index} {opt} {strike} — prewarm incomplete")
            out.append(leg)
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "Resolved %s ATM=%s CE=%s PE=%s in %.2fms (MARKET path)",
            index,
            atm,
            out[0].tradingsymbol,
            out[1].tradingsymbol,
            elapsed,
        )
        return out

    def _lookup(
        self, kite: Any, index: str, prefix: str, strike: int, opt: str
    ) -> Optional[Leg]:
        meta = INDEX_META[index]
        row = self._from_db(index, prefix, strike, opt)
        if row is None:
            row = self._from_kite(kite, meta, prefix, strike, opt)
        if row is None:
            return None
        try:
            sym = _validate_leg_symbol(str(row["tradingsymbol"]), opt, int(strike))
        except RuntimeError as exc:
            logger.error("reject instrument row: %s", exc)
            return None
        return Leg(
            index=index,
            opt_type=opt,
            strike=int(row.get("strike") or strike),
            tradingsymbol=sym,
            exchange=meta["exchange"],
            instrument_token=int(row.get("instrument_token") or 0),
            lot_size=int(row.get("lot_size") or meta["default_lot"]),
        )

    def _from_db(
        self, index: str, prefix: str, strike: int, opt: str
    ) -> Optional[Dict[str, Any]]:
        meta = INDEX_META[index]
        try:
            conn = sqlite3.connect(_db_path())
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            # Prefer exact name + segment (oi_service style). Fall back if schema is older.
            cols = {r[1] for r in cur.execute("PRAGMA table_info(instruments)").fetchall()}
            if "name" in cols and "segment" in cols:
                cur.execute(
                    """
                    SELECT * FROM instruments
                    WHERE name = ?
                      AND instrument_type = ?
                      AND segment = ?
                      AND ABS(strike - ?) < 0.01
                      AND tradingsymbol LIKE ?
                    LIMIT 1
                    """,
                    (
                        meta["name"],
                        opt,
                        meta["segment"],
                        float(strike),
                        f"{prefix}%",
                    ),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM instruments
                    WHERE tradingsymbol LIKE ?
                      AND instrument_type = ?
                      AND segment = ?
                      AND ABS(strike - ?) < 0.01
                    LIMIT 1
                    """,
                    (f"{prefix}%", opt, meta["segment"], float(strike)),
                )
            row = cur.fetchone()
            conn.close()
            return dict(row) if row else None
        except Exception:
            return None

    def _from_kite(
        self, kite: Any, meta: Dict[str, Any], prefix: str, strike: int, opt: str
    ) -> Optional[Dict[str, Any]]:
        try:
            for inst in kite.instruments(meta["exchange"]):
                if not _is_index_option(inst, meta):
                    continue
                if inst.get("instrument_type") != opt:
                    continue
                if abs(float(inst.get("strike") or 0) - strike) >= 0.01:
                    continue
                sym = str(inst.get("tradingsymbol") or "").strip()
                # Prefer rows that match the prewarmed weekly prefix.
                if prefix and not sym.startswith(prefix):
                    continue
                return inst
        except Exception:
            return None
        return None
