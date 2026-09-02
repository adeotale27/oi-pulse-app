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
    "WATCHING",
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


def _clock(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    text = str(iso)
    m = text.find("T")
    if m >= 0:
        return text[m + 1 : m + 13]
    return text[:12]


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
        self._last_warm_mono = 0.0
        self._last_preview_mono = 0.0
        self._warmed_today = False
        self._test_log: list = []
        self._pending_persist: list = []
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
            "nse_fetched_at": None,
            "nse_last_value": None,
            "nse_last_field": None,
            "nse_last_stamp": None,
            "nse_last_status": None,
            "nse_skip_why": None,
            "nse_first_at": None,
            "nse_changed_at": None,
            "how": None,
            "fired_at": None,
            "last_rehearsal": None,
            "cookies_ok": False,
            "cookie_names": [],
            "atm_preview": None,
            "preview_ce": None,
            "preview_pe": None,
            "waiting_for": None,
        }

    def reset_if_new_day(self) -> None:
        today = get_ist_now().date().isoformat()
        if self._day != today:
            with self._lock:
                self._day = today
                self._warmed_today = False
                self._last_warm_mono = 0.0
                self._last_preview_mono = 0.0
                self._test_log = []
                self._pending_persist = []
                self._state = self._empty_state()
                self._cache = StrikeCache()

    def snapshot(self) -> Dict[str, Any]:
        now = get_ist_now()
        tnow = time_only(now)
        with self._lock:
            out = dict(self._state)
        out["clock_ist"] = now.isoformat(timespec="seconds")
        out["in_probe_window"] = tnow >= dtime(9, 15, 0) and tnow <= dtime(15, 40, 0)
        out["test_log"] = list(self._test_log[-20:])
        return out

    def arm_watch(self) -> None:
        """Paper/Live just turned on: warm cookies and ATM now, do not wait for 15:09."""
        self.reset_if_new_day()
        self._last_poll_mono = 0.0
        self._last_warm_mono = 0.0
        self._last_preview_mono = 0.0
        self._warmed_today = False
        with self._lock:
            if self._state.get("status") in ("IDLE", "WATCHING", None):
                self._state["status"] = "WATCHING"
                self._state["waiting_for"] = "15:20 first NSE indicative"
                self._state["reason"] = "Paper/Live on — warming NSE cookies and ATM preview; freeze at 15:19:30"

    def drain_persists(self) -> list:
        with self._lock:
            out = list(self._pending_persist)
            self._pending_persist = []
            return out

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
                if rehearsal and ran is not None:
                    self._append_test_log({
                        "kind": "REHEARSAL",
                        "mode": "paper",
                        "status": ran.get("status"),
                        "paper": True,
                        "live_kite": False,
                        "opt_type": ran.get("opt_type"),
                        "tradingsymbol": ran.get("tradingsymbol"),
                        "order_id": ran.get("order_id"),
                        "quantity": ran.get("quantity"),
                        "locked_atm": ran.get("locked_atm"),
                        "pre_signal_nifty": ran.get("pre_signal_nifty"),
                        "indicative_nifty": ran.get("indicative_nifty"),
                        "cas_delta": ran.get("cas_delta"),
                        "how": ran.get("how") or "Inject rehearsal (does not spend 15:20 fire)",
                    })
        return self.snapshot()

    def tick(self, settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        self.reset_if_new_day()
        mode = str(settings.get("auto_trade_mode") or "off").lower()
        enabled = bool(settings.get("auto_trade_enabled")) and mode in ("paper", "live")
        with self._lock:
            self._state["mode"] = mode if enabled else "off"
            self._state["enabled"] = enabled
        if not enabled:
            with self._lock:
                if self._state.get("status") == "WATCHING":
                    self._state["status"] = "IDLE"
                    self._state["waiting_for"] = None
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
        latched = (
            status == "EXECUTED"
            or self._state.get("order_status") == "failed"
            or (status == "NO_TRADE" and not debug)
        )
        skip_prepare = latched or (status == "FAILED" and tnow > cutoff_t and not debug)
        cash = tnow >= dtime(9, 15, 0) and tnow <= dtime(15, 40, 0)

        if not latched and status in ("IDLE", "WATCHING"):
            with self._lock:
                self._state["status"] = "WATCHING"
                self._state["waiting_for"] = "15:20 first NSE indicative"
                if tnow < prepare_t and not debug:
                    self._state["reason"] = (
                        "Waiting for 15:19:30 freeze / 15:20 fire. NSE cookies + ATM preview load now. "
                        "Yesterday CLOSE leftovers are ignored."
                    )

        if cash or debug:
            self._maybe_warm()
            if not latched and (tnow < prepare_t or debug) and not self._state.get("prepared_ce"):
                self._preview_atm(settings, client)

        if not skip_prepare and (tnow >= prepare_t or debug) and not self._state.get("prepared_ce"):
            if self._state.get("status") in ("IDLE", "WATCHING", "FAILED", "PREPARING") or debug:
                self._prepare(settings, client)

        status = self._state.get("status")
        if not latched and status == "PREPARING" and (tnow >= arm_t or debug):
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
                    self._state["how"] = "No BUY: cutoff 15:22 with no usable NSE indicative"
            latched = True

        status = self._state.get("status")
        in_hot = (
            not latched
            and status == "ARMED"
            and (tnow >= signal_t or debug)
            and (tnow <= cutoff_t or debug)
        )
        now_m = time.monotonic()
        gap = (poll_ms / 1000.0) if in_hot else (5.0 if cash else 30.0)
        if now_m - self._last_poll_mono >= gap:
            self._last_poll_mono = now_m
            self._maybe_warm()
            chosen = self._probe_nse(now)
            if in_hot and chosen:
                self._on_indicative(chosen, settings, client)

    def _maybe_warm(self) -> None:
        now_m = time.monotonic()
        if self._warmed_today and (now_m - self._last_warm_mono) < 480:
            return
        ok = self._provider.warmup()
        self._warmed_today = bool(ok)
        self._last_warm_mono = now_m
        names = list(getattr(self._provider, "last_cookie_names", None) or [])
        with self._lock:
            self._state["nse_error"] = self._provider.last_error
            self._state["cookies_ok"] = bool(ok and names)
            self._state["cookie_names"] = names[:12]

    def _preview_atm(self, settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        now_m = time.monotonic()
        if (now_m - self._last_preview_mono) < 20 and self._state.get("atm_preview"):
            return
        if client is None or client.kite is None:
            return
        try:
            key = INDEX_META[INDEX]["spot_key"]
            q = client.quote([key])[key]
            spot = float(q.get("last_price") or 0)
            if spot <= 0:
                spot = float((q.get("ohlc") or {}).get("close") or 0)
            if spot <= 0:
                return
            gap = int(INDEX_META[INDEX]["strike_gap"])
            atm = round_atm(spot, gap)
            self._cache.prewarm(client.kite, INDEX, spot, ce_steps=0, pe_steps=0, radius=2)
            ce = self._cache._legs.get((INDEX, "CE", atm))
            pe = self._cache._legs.get((INDEX, "PE", atm))
            self._last_preview_mono = now_m
            with self._lock:
                self._state["atm_preview"] = atm
                self._state["preview_ce"] = ce.tradingsymbol if ce else None
                self._state["preview_pe"] = pe.tradingsymbol if pe else None
        except Exception as exc:
            logger.debug("CAS auto-trade ATM preview skipped: %s", exc)

    def _append_test_log(self, rec: Dict[str, Any]) -> None:
        rec = dict(rec)
        rec.setdefault("at", get_ist_now().isoformat(timespec="milliseconds"))
        rec.setdefault("day", get_ist_now().date().isoformat())
        with self._lock:
            self._test_log.append(rec)
            self._test_log = self._test_log[-40:]
            self._pending_persist.append(rec)

    def _probe_nse(self, now: datetime) -> Optional[Dict[str, Any]]:
        """Hit NSE JSON. Always update the tape strip; return a fireable hit or None."""
        hits = self._provider.fetch() or []
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
                last_why = "ok"
                break
        hit0 = hits[0] if hits else None
        with self._lock:
            self._state["nse_error"] = self._provider.last_error
            self._state["nse_fetched_at"] = getattr(self._provider, "last_fetch_at", None)
            self._state["nse_skip_why"] = None if chosen else last_why
            if hit0:
                prev = self._state.get("nse_last_value")
                val = hit0.get("value")
                stamp = get_ist_now().isoformat(timespec="milliseconds")
                if prev is None and val is not None:
                    self._state["nse_first_at"] = stamp
                try:
                    changed = prev is not None and abs(float(val) - float(prev)) > 0.001
                except (TypeError, ValueError):
                    changed = prev != val
                if changed:
                    self._state["nse_changed_at"] = stamp
                self._state["nse_last_value"] = val
                self._state["nse_last_field"] = hit0.get("field")
                self._state["nse_last_stamp"] = hit0.get("indicative_time")
                self._state["nse_last_status"] = hit0.get("status")
        if not chosen and (hits or self._provider.last_error):
            logger.info(
                "CAS auto-trade NSE probe skip=%s err=%s",
                last_why,
                self._provider.last_error,
            )
        return chosen

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
                self._state["fired_at"] = decided_at
                self._state["how"] = (
                    f"No BUY at {_clock(decided_at)}: first NSE {hit.get('field')} {indicative:.2f} "
                    f"vs freeze {float(pre):.2f} (Δ {delta:+.2f}) inside +{bull}/-{bear}"
                )
            logger.info("CAS auto-trade NO_TRADE delta=%.2f", delta)
            self._append_test_log({
                "kind": "NO_TRADE",
                "mode": str(settings.get("auto_trade_mode") or "").lower(),
                "status": "NO_TRADE",
                "signal": signal,
                "pre_signal_nifty": float(pre),
                "indicative_nifty": indicative,
                "cas_delta": round(delta, 2),
                "locked_atm": atm,
                "order_id": None,
                "paper": str(settings.get("auto_trade_mode") or "").lower() != "live",
                "how": self._state.get("how"),
            })
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
            self._last_warm_mono = 0.0
            self._last_preview_mono = 0.0
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
            kind = "Paper DRY-BUY (no Zerodha fill)" if not live else "Live MARKET BUY"
            field = self._state.get("indicative_field") or "indicative"
            recap = (
                f"{kind} at {_clock(ack_at)}: {opt} {symbol} ×{qty} because first NSE {field} "
                f"{indicative:.2f} vs freeze {pre:.2f} (Δ {delta:+.2f})"
            )
            if err:
                recap = f"FAILED at {_clock(ack_at)}: {err}"
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
            self._state["how"] = recap
            self._state["fired_at"] = ack_at
        self._append_test_log({
            "kind": "BUY" if not err else "FAILED",
            "mode": mode,
            "status": "FAILED" if err else "EXECUTED",
            "signal": opt,
            "opt_type": opt,
            "tradingsymbol": symbol,
            "quantity": qty,
            "pre_signal_nifty": pre,
            "indicative_nifty": indicative,
            "cas_delta": round(delta, 2),
            "locked_atm": atm,
            "order_id": order_id,
            "order_status": "failed" if err else ("paper" if not live else "submitted"),
            "paper": not live,
            "live_kite": bool(live),
            "how": recap,
            "reason": err,
        })


_AUTO: Optional[CasAutoTrade] = None
_ALOCK = threading.Lock()


def get_auto_trade() -> CasAutoTrade:
    global _AUTO
    with _ALOCK:
        if _AUTO is None:
            _AUTO = CasAutoTrade()
        return _AUTO
