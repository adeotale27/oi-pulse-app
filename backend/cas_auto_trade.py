"""CAS Auto Trade — first NSE indicative vs frozen NIFTY, one ATM BUY, manual exit.

Does not replace the existing 15:28 sell-both CAS fire path.
ATM is locked from pre-signal live NIFTY. Indicative is direction only.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, time as dtime
from typing import Any, Dict, Optional, Tuple

from cas_indicative_nse import NseIndicativeProvider, accept_first_indicative
from cas_rule_expiry_automation.expiry_calendar import INDEX_META
from cas_rule_expiry_automation.kite_client import KiteClient
from cas_rule_expiry_automation.strike_resolver import StrikeCache, round_atm
from cas_rule_expiry_automation.time_utils import get_ist_now, time_only

logger = logging.getLogger(__name__)

STATES = (
    "IDLE",
    "PREPARING",
    "ARMED",
    "CAS_DATA_RECEIVED",
    "SIGNAL_DECIDED",
    "EXECUTING",
    "EXECUTED",
    "NO_TRADE",
    "FAILED",
)

INDEX = "NIFTY"


def _auto_lots(settings: Dict[str, Any]) -> int:
    """Auto Trade size — not classic 15:28 expiry lots."""
    raw = settings.get("auto_trade_lots")
    if raw is None:
        raw = settings.get("lots")
    try:
        n = int(raw or 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, min(50, n))


def _parse_hhmm(value: str, default: dtime) -> dtime:
    text = str(value or "").strip()
    try:
        parts = [int(p) for p in text.split(":") if p != ""]
        if len(parts) >= 3:
            return dtime(parts[0], parts[1], parts[2])
        if len(parts) == 2:
            return dtime(parts[0], parts[1])
    except Exception:
        return default
    return default


def decide_signal(
    *,
    pre_signal: float,
    indicative: float,
    bullish_pts: float,
    bearish_pts: float,
) -> Tuple[str, float, Optional[str]]:
    """Return (signal, delta, opt_type). ATM is NOT recomputed here."""
    delta = float(indicative) - float(pre_signal)
    if delta >= float(bullish_pts):
        return "BULLISH", delta, "CE"
    if delta <= -float(bearish_pts):
        return "BEARISH", delta, "PE"
    return "NO_TRADE", delta, None


class CasAutoTrade:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._exec_lock = threading.Lock()
        self._provider = NseIndicativeProvider()
        self._cache = StrikeCache()
        self._day: Optional[str] = None
        self._last_poll_mono = 0.0
        self._warmed_today = False
        self._state: Dict[str, Any] = self._empty_state()

    @staticmethod
    def _empty_state() -> Dict[str, Any]:
        return {
            "status": "IDLE",
            "mode": "off",
            "enabled": False,
            "reason": None,
            "pre_signal_nifty": None,
            "pre_signal_at": None,
            "locked_atm": None,
            "prepared_ce": None,
            "prepared_pe": None,
            "indicative_nifty": None,
            "indicative_at": None,
            "indicative_field": None,
            "cas_delta": None,
            "signal": None,
            "order_status": None,
            "order_id": None,
            "tradingsymbol": None,
            "opt_type": None,
            "quantity": None,
            "latency": {},
            "nse_error": None,
            "last_rehearsal": None,
        }

    def reset_if_new_day(self) -> None:
        today = get_ist_now().date().isoformat()
        if self._day != today:
            with self._lock:
                self._day = today
                self._warmed_today = False
                self._state = self._empty_state()
                self._cache = StrikeCache()

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._state)

    def inject_indicative(self, value: float, settings: Dict[str, Any], client: Optional[KiteClient]) -> Dict[str, Any]:
        """Paper/debug: pretend NSE just printed ``value``.

        Before 15:20 this is a **rehearsal** (live Kite freeze + dry order) and does
        not consume today's 15:20 fire. From 15:20 it is the day's paper/live path.
        """
        mode = str(settings.get("auto_trade_mode") or "off").lower()
        if mode == "live":
            raise RuntimeError("Inject is paper-only. Switch Auto mode to Paper, then inject.")
        if mode != "paper":
            raise RuntimeError("Turn Auto mode to Paper first (live Kite tape, dry-run BUY). Inject is disabled while Off.")
        self.reset_if_new_day()
        signal_t = _parse_hhmm(settings.get("auto_signal_start"), dtime(15, 20, 0))
        rehearsal = time_only(get_ist_now()) < signal_t
        saved_state = None
        saved_cache = None
        if rehearsal:
            with self._lock:
                saved_state = dict(self._state)
                saved_cache = self._cache
        with self._lock:
            if not rehearsal and self._state.get("status") in ("EXECUTED", "EXECUTING"):
                raise RuntimeError("Already executed today")
        ran = None
        try:
            if not self._state.get("prepared_ce"):
                self._prepare(settings, client, force=True)
            if not self._state.get("prepared_ce"):
                ran = dict(self._state)
                raise RuntimeError(self._state.get("reason") or "prepare_failed")
            hit = {
                "value": float(value),
                "field": "inject",
                "status": "INJECT",
                "index_name": "NIFTY 50",
                "indicative_time": get_ist_now().strftime("%d-%b-%Y %H:%M:%S"),
                "received_at": get_ist_now().isoformat(timespec="milliseconds"),
            }
            self._on_indicative(hit, settings, client)
            ran = dict(self._state)
        finally:
            if rehearsal and saved_state is not None:
                with self._lock:
                    self._state = saved_state
                    self._cache = saved_cache
                    if ran is not None:
                        ran["rehearsal"] = True
                        self._state["last_rehearsal"] = {
                            "status": ran.get("status"),
                            "signal": ran.get("signal"),
                            "opt_type": ran.get("opt_type"),
                            "tradingsymbol": ran.get("tradingsymbol"),
                            "order_id": ran.get("order_id"),
                            "order_status": ran.get("order_status"),
                            "locked_atm": ran.get("locked_atm"),
                            "pre_signal_nifty": ran.get("pre_signal_nifty"),
                            "indicative_nifty": ran.get("indicative_nifty"),
                            "cas_delta": ran.get("cas_delta"),
                            "quantity": ran.get("quantity"),
                            "reason": ran.get("reason"),
                            "at": get_ist_now().isoformat(timespec="milliseconds"),
                        }
        return self.snapshot()

    def tick(self, settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        self.reset_if_new_day()
        mode = str(settings.get("auto_trade_mode") or "off").lower()
        enabled = bool(settings.get("auto_trade_enabled")) and mode in ("paper", "live")
        with self._lock:
            self._state["mode"] = mode if enabled else "off"
            self._state["enabled"] = enabled
        if not enabled:
            return

        now = get_ist_now()
        tnow = time_only(now)
        debug = bool(settings.get("debug_mode"))
        prepare_t = _parse_hhmm(settings.get("auto_prepare_time"), dtime(15, 19, 30))
        arm_t = _parse_hhmm(settings.get("auto_arm_time"), dtime(15, 19, 55))
        signal_t = _parse_hhmm(settings.get("auto_signal_start"), dtime(15, 20, 0))
        cutoff_t = _parse_hhmm(settings.get("auto_cutoff_time"), dtime(15, 22, 0))
        try:
            poll_ms = max(150, min(2000, int(settings.get("auto_poll_ms") or 250)))
        except (TypeError, ValueError):
            poll_ms = 250

        status = self._state.get("status")
        if status == "EXECUTED":
            return
        if self._state.get("order_status") == "failed":
            # Do not re-send a MARKET order that the broker already rejected.
            return
        if status == "NO_TRADE" and not debug:
            return
        if status == "FAILED" and tnow > cutoff_t and not debug:
            return

        warmup_t = dtime(max(0, prepare_t.hour), max(0, prepare_t.minute - 10), 0)
        if tnow >= warmup_t or debug:
            if not self._warmed_today:
                self._warmed_today = self._provider.warmup()
                with self._lock:
                    self._state["nse_error"] = self._provider.last_error

        if (tnow >= prepare_t or debug) and not self._state.get("prepared_ce"):
            if status in ("IDLE", "FAILED", "PREPARING") or debug:
                self._prepare(settings, client)

        status = self._state.get("status")
        if status == "PREPARING" and (tnow >= arm_t or debug):
            with self._lock:
                if self._state.get("prepared_ce") and self._state.get("prepared_pe"):
                    self._state["status"] = "ARMED"
                    self._state["reason"] = "ATM CE/PE locked — waiting for first NSE indicative"

        status = self._state.get("status")
        if status == "ARMED" and tnow > cutoff_t and not debug:
            with self._lock:
                if self._state["status"] == "ARMED":
                    self._state["status"] = "NO_TRADE"
                    self._state["reason"] = "cutoff_passed_no_indicative"
            return

        if status != "ARMED":
            return
        if tnow < signal_t and not debug:
            return
        if tnow > cutoff_t and not debug:
            return

        now_m = time.monotonic()
        if now_m - self._last_poll_mono < (poll_ms / 1000.0):
            return
        self._last_poll_mono = now_m
        hits = self._provider.fetch() or []
        with self._lock:
            self._state["nse_error"] = self._provider.last_error
        if isinstance(hits, dict):
            hits = [hits]
        freeze = self._state.get("pre_signal_nifty")
        chosen = None
        last_why = "empty"
        for hit in hits:
            ok, why = accept_first_indicative(hit, freeze=freeze, now=now)
            last_why = why
            if ok:
                chosen = hit
                break
        if not chosen:
            if hits:
                logger.info("CAS auto-trade skip indicative: %s", last_why)
            return
        self._on_indicative(chosen, settings, client)

    def _prepare(self, settings: Dict[str, Any], client: Optional[KiteClient], *, force: bool = False) -> None:
        with self._lock:
            if self._state.get("status") in ("EXECUTING", "EXECUTED"):
                return
            self._state["status"] = "PREPARING"
            self._state["reason"] = None
        if client is None or client.kite is None:
            with self._lock:
                self._state["status"] = "FAILED"
                self._state["reason"] = "kite_not_connected"
            return
        try:
            key = INDEX_META[INDEX]["spot_key"]
            q = client.quote([key])[key]
            spot = float(q.get("last_price") or 0)
            if spot <= 0:
                spot = float((q.get("ohlc") or {}).get("close") or 0)
            if spot <= 0:
                raise RuntimeError("nifty_ltp_missing")
            gap = int(INDEX_META[INDEX]["strike_gap"])
            atm = round_atm(spot, gap)
            n = self._cache.prewarm(
                client.kite,
                INDEX,
                spot,
                ce_steps=0,
                pe_steps=0,
                radius=2,
            )
            ce = self._cache._legs.get((INDEX, "CE", atm))
            pe = self._cache._legs.get((INDEX, "PE", atm))
            if ce is None or pe is None:
                raise RuntimeError(f"atm_legs_missing atm={atm} warmed={n}")
            lots = _auto_lots(settings)
            qty_ce = lots * max(int(ce.lot_size), 1)
            qty_pe = lots * max(int(pe.lot_size), 1)
            frozen_at = get_ist_now().isoformat(timespec="milliseconds")
            with self._lock:
                self._state.update({
                    "status": "PREPARING",
                    "pre_signal_nifty": spot,
                    "pre_signal_at": frozen_at,
                    "locked_atm": atm,
                    "prepared_ce": ce.tradingsymbol,
                    "prepared_pe": pe.tradingsymbol,
                    "quantity": qty_ce,
                    "reason": f"locked ATM {atm} from live NIFTY {spot:.2f}",
                })
            logger.info(
                "CAS auto-trade prepared spot=%.2f atm=%s CE=%s PE=%s qty=%s/%s",
                spot, atm, ce.tradingsymbol, pe.tradingsymbol, qty_ce, qty_pe,
            )
        except Exception as exc:
            logger.exception("CAS auto-trade prepare failed")
            with self._lock:
                self._state["status"] = "FAILED"
                self._state["reason"] = str(exc)[:240]

    def _on_indicative(self, hit: Dict[str, Any], settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        t_recv = time.perf_counter()
        received_at = hit.get("received_at") or get_ist_now().isoformat(timespec="milliseconds")
        indicative = float(hit["value"])
        with self._lock:
            if self._state.get("status") not in ("ARMED", "PREPARING"):
                return
            pre = self._state.get("pre_signal_nifty")
            atm = self._state.get("locked_atm")
            ce_sym = self._state.get("prepared_ce")
            pe_sym = self._state.get("prepared_pe")
            self._state["status"] = "CAS_DATA_RECEIVED"
            self._state["indicative_nifty"] = indicative
            self._state["indicative_at"] = received_at
            self._state["indicative_field"] = hit.get("field")
        if pre is None or atm is None or not ce_sym or not pe_sym:
            with self._lock:
                self._state["status"] = "FAILED"
                self._state["reason"] = "not_prepared"
            return

        bull = float(settings.get("auto_bullish_pts") if settings.get("auto_bullish_pts") is not None else 15)
        bear = float(settings.get("auto_bearish_pts") if settings.get("auto_bearish_pts") is not None else 15)
        signal, delta, opt = decide_signal(
            pre_signal=float(pre),
            indicative=indicative,
            bullish_pts=bull,
            bearish_pts=bear,
        )
        t_decided = time.perf_counter()
        decided_at = get_ist_now().isoformat(timespec="milliseconds")
        with self._lock:
            self._state["status"] = "SIGNAL_DECIDED"
            self._state["signal"] = signal
            self._state["cas_delta"] = round(delta, 2)
            self._state["opt_type"] = opt
            self._state["latency"] = {
                "data_to_decision_ms": round((t_decided - t_recv) * 1000, 3),
            }

        if signal == "NO_TRADE" or opt is None:
            with self._lock:
                self._state["status"] = "NO_TRADE"
                self._state["reason"] = f"delta {delta:.2f} inside thresholds +{bull}/-{bear}"
            logger.info("CAS auto-trade NO_TRADE delta=%.2f", delta)
            return

        if not self._exec_lock.acquire(blocking=False):
            return
        try:
            with self._lock:
                if self._state.get("status") in ("EXECUTING", "EXECUTED"):
                    return
                self._state["status"] = "EXECUTING"
            self._execute(
                settings,
                client,
                opt,
                float(pre),
                indicative,
                delta,
                t_recv,
                t_decided,
                received_at,
                decided_at,
            )
        finally:
            try:
                self._exec_lock.release()
            except Exception:
                pass

    def reset_today(self) -> None:
        with self._lock:
            self._state = self._empty_state()
            self._warmed_today = False
            self._cache = StrikeCache()
            self._last_poll_mono = 0.0

    def _execute(
        self,
        settings: Dict[str, Any],
        client: Optional[KiteClient],
        opt: str,
        pre: float,
        indicative: float,
        delta: float,
        t_recv: float,
        t_decided: float,
        received_at: str,
        decided_at: str,
    ) -> None:
        mode = str(settings.get("auto_trade_mode") or "paper").lower()
        live = mode == "live"
        if live and (client is None or not getattr(client, "kite", None)):
            with self._lock:
                self._state["status"] = "FAILED"
                self._state["reason"] = "kite_not_connected"
                self._state["order_status"] = "failed"
            return
        atm = int(self._state["locked_atm"])
        symbol = self._state["prepared_ce"] if opt == "CE" else self._state["prepared_pe"]
        leg = self._cache._legs.get((INDEX, opt, atm))
        if leg is None or client is None:
            with self._lock:
                self._state["status"] = "FAILED"
                self._state["reason"] = "leg_or_kite_missing"
            return
        lots = _auto_lots(settings)
        qty = lots * max(int(leg.lot_size), 1)
        product = str(settings.get("product") or "NRML").upper()
        t_order = time.perf_counter()
        submitted_at = get_ist_now().isoformat(timespec="milliseconds")
        order_id = None
        err = None
        try:
            order_id = client.place_market_buy(
                exchange=leg.exchange,
                tradingsymbol=leg.tradingsymbol,
                quantity=qty,
                product=product,
                tag="CASAUTO",
                live=live,
            )
        except Exception as exc:
            err = str(exc)[:240]
            logger.exception("CAS auto-trade BUY failed")
        ack_at = get_ist_now().isoformat(timespec="milliseconds")
        t_ack = time.perf_counter()
        latency = {
            "data_to_decision_ms": round((t_decided - t_recv) * 1000, 3),
            "decision_to_order_ms": round((t_order - t_decided) * 1000, 3),
            "total_signal_to_order_ms": round((t_ack - t_recv) * 1000, 3),
            "received_at": received_at,
            "decided_at": decided_at,
            "order_submitted_at": submitted_at,
            "order_ack_at": ack_at,
        }
        logger.info(
            "CAS AUTO TRADE mode=%s pre=%.2f ind=%.2f delta=%+.2f atm=%s signal=%s BUY %s x%d order=%s err=%s",
            mode.upper(),
            pre,
            indicative,
            delta,
            atm,
            opt,
            symbol,
            qty,
            order_id,
            err,
        )
        with self._lock:
            if err:
                self._state["status"] = "FAILED"
                self._state["reason"] = err
                self._state["order_status"] = "failed"
            else:
                self._state["status"] = "EXECUTED"
                self._state["reason"] = "exit_manually_in_positions"
                self._state["order_status"] = "paper" if not live else "submitted"
            self._state["order_id"] = order_id
            self._state["tradingsymbol"] = symbol
            self._state["quantity"] = qty
            self._state["latency"] = latency


_AUTO: Optional[CasAutoTrade] = None
_ALOCK = threading.Lock()


def get_auto_trade() -> CasAutoTrade:
    global _AUTO
    with _ALOCK:
        if _AUTO is None:
            _AUTO = CasAutoTrade()
        return _AUTO
