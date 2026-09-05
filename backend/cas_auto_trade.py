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

from cas_indicative_nse import NseIndicativeProvider, accept_first_indicative as accept_first_nse_indicative
from cas_indicative_bse import BseIndicativeProvider, accept_first_indicative as accept_first_bse_indicative
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
        self._providers = {
            "NIFTY": NseIndicativeProvider(),
            "SENSEX": BseIndicativeProvider()
        }
        self._cache = StrikeCache()
        self._day: Optional[str] = None
        self._last_poll_mono = 0.0
        self._last_warm_mono = 0.0
        self._last_preview_mono = 0.0
        self._warmed_today = False
        self._test_log: list = []
        self._pending_persist: list = []
        self._states: Dict[str, Dict[str, Any]] = {
            "NIFTY": self._empty_state(),
            "SENSEX": self._empty_state()
        }

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
            "nse_streaming_last": None,
            "nse_indicative_close": None,
            "nse_previous_close": None,
            "nse_widget_time": None,
            "nse_ic_change": None,
            "nse_ic_per_change": None,
            "nse_fallback_value": None,
            "nse_fallback_field": None,
            "decision": None,
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
                self._states = {
                    "NIFTY": self._empty_state(),
                    "SENSEX": self._empty_state()
                }
                self._cache = StrikeCache()

    def snapshot(self) -> Dict[str, Any]:
        now = get_ist_now()
        tnow = time_only(now)
        with self._lock:
            # Return combined state for backward compatibility, plus per-index data
            out = {
                "NIFTY": dict(self._states["NIFTY"]),
                "SENSEX": dict(self._states["SENSEX"]),
                "active_index": self._get_active_index_for_day(),
                "clock_ist": now.isoformat(timespec="seconds"),
                "in_probe_window": tnow >= dtime(9, 15, 0) and tnow <= dtime(15, 40, 0),
                "test_log": list(self._test_log[-20:])
            }
        return out

    def arm_watch(self) -> None:
        """Paper/Live just turned on: warm cookies and ATM now, do not wait for 15:09."""
        self.reset_if_new_day()
        self._last_poll_mono = 0.0
        self._last_warm_mono = 0.0
        self._last_preview_mono = 0.0
        self._warmed_today = False
        with self._lock:
            # Initialize both indices to WATCHING state
            for index in self._states:
                self._states[index]["status"] = "WATCHING"
                self._states[index]["waiting_for"] = f"15:20 first {index} indicative"
                self._states[index]["reason"] = f"Paper/Live on — warming {index} cookies and ATM preview; freeze at 15:19:30"

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
            self._state["mode"] = mode if mode in ("paper", "live") else "off"
            self._state["enabled"] = enabled
        if not enabled:
            with self._lock:
                # Reset all indices to IDLE when not enabled
                for index in self._states:
                    self._states[index]["status"] = "IDLE"
                    self._states[index]["waiting_for"] = None
                if mode == "live":
                    if self._state.get("status") in ("IDLE", "WATCHING", None):
                        self._state["status"] = "IDLE"
                    self._state["waiting_for"] = "Press Start to run Auto Trade"
                    self._state["reason"] = (
                        "Live selected — Start runs the 15:20 BUY. Homepage Indicative Close still updates below."
                    )
            if mode == "live":
                now = get_ist_now()
                tnow = time_only(now)
                cash = tnow >= dtime(9, 15, 0) and tnow <= dtime(15, 40, 0)
                now_m = time.monotonic()
                if cash and now_m - self._last_poll_mono >= 2.0:
                    self._last_poll_mono = now_m
                    # Probe active indices based on indicative_index setting
                    active_indices = self._get_active_indices(settings)
                    for index in active_indices:
                        self._probe_index(index, now, hot=False)
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

        # Determine which indices are active for this session
        active_indices = self._get_active_indices(settings)

        # Update states for all indices
        with self._lock:
            for index in self._states:
                status = self._states[index].get("status")
                # Handle WATCHING state transitions
                if not enabled and status == "WATCHING" and mode != "live":
                    self._states[index]["status"] = "IDLE"
                    self._states[index]["waiting_for"] = None
                elif enabled and mode == "live" and self._states[index].get("status") in ("IDLE", "WATCHING", None):
                    self._states[index]["status"] = "IDLE"
                    self._states[index]["waiting_for"] = "Press Start to run Auto Trade"
                    self._states[index]["reason"] = (
                        f"Live selected — Start runs the 15:20 BUY. {index} Indicative Close still updates below."
                    )

                # Initialize WATCHING state when enabling
                if enabled and status in ("IDLE", "WATCHING", None) and mode != "live":
                    self._states[index]["status"] = "WATCHING"
                    self._states[index]["waiting_for"] = f"15:20 first {index} indicative"
                    self._states[index]["reason"] = (
                        f"Paper/Live on — warming {index} cookies and ATM preview; freeze at 15:19:30"
                    )

        # Handle live mode polling when not actively trading
        if mode == "live" and enabled:
            now = get_ist_now()
            tnow = time_only(now)
            cash = tnow >= dtime(9, 15, 0) and tnow <= dtime(15, 40, 0)
            now_m = time.monotonic()
            if cash and now_m - self._last_poll_mono >= 2.0:
                self._last_poll_mono = now_m
                # Probe active indices
                for index in active_indices:
                    self._probe_index(index, now, hot=False)

        # Main trading logic
        status = self._state.get("status")  # Keep for backward compatibility with single index logic
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
                self._state["waiting_for"] = "15:20 first NSE indicative"  # Backward compatibility
                if tnow < prepare_t and not debug:
                    self._state["reason"] = (
                        "Waiting for 15:19:30 freeze / 15:20 fire. NSE cookies + ATM preview load now. "
                        "Yesterday CLOSE leftovers are ignored."
                    )

        if cash or debug:
            if not (tnow >= signal_t and tnow <= cutoff_t):
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
                    self._state["how"] = (
                        "No BUY: cutoff 15:22 with no usable homepage Indicative Close "
                        "(marketStatus leftover / cash last is not that print)"
                    )
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
            # Probe active indices in hot mode when armed
            if in_hot:
                for index in active_indices:
                    chosen = self._probe_index(index, now, hot=in_hot)
                    if chosen:
                        self._on_indicative(chosen, settings, client)

    def _maybe_warm(self) -> None:
        now_m = time.monotonic()
        # Warm all providers if needed
        for index, provider in self._providers.items():
            # We'll track warming per index if needed, but for simplicity warm all together
            pass
        if self._warmed_today and (now_m - self._last_warm_mono) < 480:
            return
        # Warm all providers
        results = {}
        for index, provider in self._providers.items():
            results[index] = provider.warmup()
        self._warmed_today = all(results.values())
        self._last_warm_mono = now_m
        # Update state for each index
        with self._lock:
            for index, provider in self._providers.items():
                names = list(getattr(provider, "last_cookie_names", None) or [])
                self._states[index]["nse_error"] = provider.last_error  # Keep field name for compatibility
                self._states[index]["cookies_ok"] = bool(results[index] and names)
                self._states[index]["cookie_names"] = names[:12]

    def _preview_atm(self, settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        now_m = time.monotonic()
        if client is None or client.kite is None:
            return

        # Preview ATM for each active index
        active_indices = self._get_active_indices(settings)
        for index in active_indices:
            # Simple debounce per index - using a dict to track last preview time per index
            if not hasattr(self, '_last_preview_mono_per_index'):
                self._last_preview_mono_per_index = {}
            last_preview = self._last_preview_mono_per_index.get(index, 0.0)
            if (now_m - last_preview) < 20 and self._states[index].get("atm_preview"):
                continue

            try:
                key = INDEX_META[index]["spot_key"]
                q = client.quote([key])[key]
                spot = float(q.get("last_price") or 0)
                if spot <= 0:
                    spot = float((q.get("ohlc") or {}).get("close") or 0)
                if spot <= 0:
                    continue
                gap = int(INDEX_META[index]["strike_gap"])
                atm = round_atm(spot, gap)
                # Use a separate cache per index or clear and rewarm
                self._cache.prewarm(client.kite, index, spot, ce_steps=0, pe_steps=0, radius=2)
                ce = self._cache._legs.get((index, "CE", atm))
                pe = self._cache._legs.get((index, "PE", atm))
                if ce is None or pe is None:
                    continue
                self._last_preview_mono_per_index[index] = now_m
                with self._lock:
                    self._states[index]["atm_preview"] = atm
                    self._states[index]["preview_ce"] = ce.tradingsymbol if ce else None
                    self._states[index]["preview_pe"] = pe.tradingsymbol if pe else None
            except Exception as exc:
                logger.debug("CAS auto-trade ATM preview skipped for %s: %s", index, exc)

    def _append_test_log(self, rec: Dict[str, Any]) -> None:
        rec = dict(rec)
        rec.setdefault("at", get_ist_now().isoformat(timespec="milliseconds"))
        rec.setdefault("day", get_ist_now().date().isoformat())
        with self._lock:
            self._test_log.append(rec)
            self._test_log = self._test_log[-40:]
            self._pending_persist.append(rec)

    def _probe_index(self, index: str, now: datetime, *, hot: bool = False) -> Optional[Dict[str, Any]]:
        """Hit the index JSON (NSE or BSE). Always update the tape strip; return a fireable hit or None."""
        provider = self._providers[index]
        state = self._states[index]
        fetch = getattr(provider, "fetch")
        try:
            hits = fetch(hot=hot) or []
        except TypeError:
            hits = fetch() or []
        if isinstance(hits, dict):
            hits = [hits]
        freeze = state.get("pre_signal_nifty")  # Note: we keep the field name as pre_signal_nifty for compatibility
        chosen = None
        last_why = "empty"
        for hit in hits:
            # Use the appropriate accept function based on index
            if index == "NIFTY":
                ok, why = accept_first_nse_indicative(hit, freeze=freeze, now=now)
            else:  # SENSEX
                ok, why = accept_first_bse_indicative(hit, freeze=freeze, now=now)
            last_why = why
            if ok:
                chosen = hit
                last_why = "ok"
                break
        tape = getattr(provider, "last_tape", None) or {}
        hit0 = hits[0] if hits else None
        with self._lock:
            # Update state for this index
            state["nse_error"] = provider.last_error  # Keeping field name for compatibility
            state["nse_fetched_at"] = getattr(provider, "last_fetch_at", None)
            state["nse_skip_why"] = None if chosen else last_why
            if tape:
                state["nse_streaming_last"] = tape.get("streaming_last")
                state["nse_indicative_close"] = tape.get("indicative_close")
                state["nse_previous_close"] = tape.get("previous_close")
                state["nse_widget_time"] = tape.get("time_val")
                state["nse_ic_change"] = tape.get("ic_change")
                state["nse_ic_per_change"] = tape.get("ic_per_change")
            display = tape.get("indicative_close") if tape else None
            field_lbl = "getIndexData:indicativeClose"
            stamp_w = tape.get("time_val") if tape else None
            if display is None and hit0 and str(hit0.get("source") or "") != "marketStatus":
                display = hit0.get("value")
                src = hit0.get("source")
                field = hit0.get("field")
                field_lbl = f"{src}:{field}" if src else field
                stamp_w = hit0.get("indicative_time")
            if display is not None:
                prev = state.get("nse_last_value")
                stamp = get_ist_now().isoformat(timespec="milliseconds")
                if prev is None:
                    state["nse_first_at"] = stamp
                try:
                    changed = prev is not None and abs(float(display) - float(prev)) > 0.001
                except (TypeError, ValueError):
                    changed = prev != display
                if changed:
                    state["nse_changed_at"] = stamp
                state["nse_last_value"] = display
                state["nse_last_field"] = field_lbl
                state["nse_last_stamp"] = stamp_w or state.get("nse_last_stamp")
                if tape:
                    state["nse_last_status"] = "indicative"
            if hit0 and str(hit0.get("source") or "") == "marketStatus":
                state["nse_fallback_value"] = hit0.get("value")
                state["nse_fallback_field"] = hit0.get("field")
        if not chosen and (hits or provider.last_error):
            logger.info(
                "CAS auto-trade %s probe skip=%s err=%s",
                index,
                last_why,
                provider.last_error,
            )
        return chosen

    def _prepare(self, settings: Dict[str, Any], client: Optional[KiteClient], *, force: bool = False) -> None:
        if client is None or client.kite is None:
            with self._lock:
                for index in self._states:
                    self._states[index]["status"] = "FAILED"
                    self._states[index]["reason"] = "kite_not_connected"
            return

        # Prepare each active index
        active_indices = self._get_active_indices(settings)
        for index in active_indices:
            with self._lock:
                if self._states[index].get("status") in ("EXECUTING", "EXECUTED"):
                    continue
                self._states[index]["status"] = "PREPARING"
                self._states[index]["reason"] = None

            try:
                key = INDEX_META[index]["spot_key"]
                q = client.quote([key])[key]
                spot = float(q.get("last_price") or 0)
                if spot <= 0:
                    spot = float((q.get("ohlc") or {}).get("close") or 0)
                if spot <= 0:
                    raise RuntimeError(f"{index}_ltp_missing")
                gap = int(INDEX_META[index]["strike_gap"])
                atm = round_atm(spot, gap)
                n = self._cache.prewarm(
                    client.kite,
                    index,
                    spot,
                    ce_steps=0,
                    pe_steps=0,
                    radius=2,
                )
                ce = self._cache._legs.get((index, "CE", atm))
                pe = self._cache._legs.get((index, "PE", atm))
                if ce is None or pe is None:
                    raise RuntimeError(f"atm_legs_missing atm={atm} warmed={n} for {index}")
                lots = _auto_lots(settings)
                qty_ce = lots * max(int(ce.lot_size), 1)
                qty_pe = lots * max(int(pe.lot_size), 1)
                frozen_at = get_ist_now().isoformat(timespec="milliseconds")
                with self._lock:
                    self._states[index].update({
                        "status": "PREPARING",
                        "pre_signal_nifty": spot,  # Keeping field name for compatibility
                        "pre_signal_at": frozen_at,
                        "locked_atm": atm,
                        "prepared_ce": ce.tradingsymbol,
                        "prepared_pe": pe.tradingsymbol,
                        "quantity": qty_ce,
                        "reason": f"locked ATM {atm} from live {index} {spot:.2f}",
                    })
                logger.info(
                    "CAS auto-trade [%s] prepared spot=%.2f atm=%s CE=%s PE=%s qty=%s/%s",
                    index, spot, atm, ce.tradingsymbol, pe.tradingsymbol, qty_ce, qty_pe,
                )
            except Exception as exc:
                logger.exception("CAS auto-trade prepare failed for %s", index)
                with self._lock:
                    self._states[index]["status"] = "FAILED"
                    self._states[index]["reason"] = str(exc)[:240]

    def _on_indicative(self, hit: Dict[str, Any], settings: Dict[str, Any], client: Optional[KiteClient]) -> None:
        # Determine which index this hit belongs to
        index_name = hit.get("index_name", "").upper()
        target_index = None
        if "NIFTY" in index_name:
            target_index = "NIFTY"
        elif "SENSEX" in index_name:
            target_index = "SENSEX"
        else:
            # Default to NIFTY if we can't determine
            target_index = "NIFTY"

        # Only process if this index is active
        active_indices = self._get_active_indices(settings)
        if target_index not in active_indices:
            logger.debug(f"Ignoring indicative for {target_index} - not active")
            return

        t_recv = time.perf_counter()
        received_at = hit.get("received_at") or get_ist_now().isoformat(timespec="milliseconds")
        indicative = float(hit["value"])
        state = self._states[target_index]

        with self._lock:
            if state.get("status") not in ("ARMED", "PREPARING"):
                return
            pre = state.get("pre_signal_nifty")
            atm = state.get("locked_atm")
            ce_sym = state.get("prepared_ce")
            pe_sym = state.get("prepared_pe")
            state["status"] = "CAS_DATA_RECEIVED"
            state["indicative_nifty"] = indicative  # Keeping field name for compatibility
            state["indicative_at"] = received_at
            field = hit.get("field")
            src = hit.get("source")
            state["indicative_field"] = f"{src}:{field}" if src else field

        if pre is None or atm is None or not ce_sym or not pe_sym:
            with self._lock:
                state["status"] = "FAILED"
                state["reason"] = "not_prepared"
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
            state["status"] = "SIGNAL_DECIDED"
            state["signal"] = signal
            state["cas_delta"] = round(delta, 2)
            state["opt_type"] = opt
            state["latency"] = {
                "data_to_decision_ms": round((t_decided - t_recv) * 1000, 3),
            }

        if signal == "NO_TRADE" or opt is None:
            with self._lock:
                state["status"] = "NO_TRADE"
                state["reason"] = f"delta {delta:.2f} inside thresholds +{bull}/-{bear}"
                state["fired_at"] = decided_at
                state["how"] = (
                    f"No BUY at {_clock(decided_at)}: homepage Indicative Close {indicative:.2f} "
                    f"vs frozen {target_index} {float(pre):.2f} is Δ {delta:+.2f}, inside +{bull:g}/−{bear:g}. "
                    f"ATM {atm} stays locked from freeze."
                )
                state["decision"] = {
                    "freeze": float(pre),
                    "indicative": indicative,
                    "delta": round(delta, 2),
                    "bullish_pts": bull,
                    "bearish_pts": bear,
                    "atm": atm,
                    "opt_type": None,
                    "signal": "NO_TRADE",
                    "because": state["how"],
                }
            logger.info(f"CAS auto-trade {target_index} NO_TRADE delta=%.2f", delta)
            self._append_test_log({
                "kind": "NO_TRADE",
                "mode": str(settings.get("auto_trade_mode") or "").lower(),
                "index": target_index,
                "status": "NO_TRADE",
                "signal": signal,
                "pre_signal_nifty": float(pre),
                "indicative_nifty": indicative,
                "cas_delta": round(delta, 2),
                "locked_atm": atm,
                "order_id": None,
                "paper": str(settings.get("auto_trade_mode") or "").lower() != "live",
                "how": state.get("how"),
            })
            return

        if not self._exec_lock.acquire(blocking=False):
            return
        try:
            with self._lock:
                if state.get("status") in ("EXECUTING", "EXECUTED"):
                    return
                state["status"] = "EXECUTING"
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

    def _get_active_index_for_day(self) -> str:
        """Get the index that should be active based on day-of-week settings."""
        # Get current day of week (0=Monday, 6=Sunday)
        today_weekday = get_ist_now().weekday()
        day_map = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        today_day = day_map[today_weekday]

        # Check if BSE is enabled and today is a BSE default day
        bse_enabled = self._get_setting_safely("bse_enabled", False)
        bse_default_days = self._get_setting_safely("bse_default_days", ["wed", "thu"])
        nse_default_days = self._get_setting_safely("nse_default_days", ["mon", "tue"])

        if bse_enabled and today_day in bse_default_days:
            return "SENSEX"
        elif today_day in nse_default_days:
            return "NIFTY"
        else:
            # Default to NIFTY if no specific rule matches
            return "NIFTY"

    def _get_active_indices(self, settings: Dict[str, Any]) -> list:
        """Get list of indices that should be active based on indicative_index setting."""
        indicative_index = str(settings.get("indicative_index", "NIFTY")).upper()
        bse_enabled = self._get_setting_safely("bse_enabled", False)

        if indicative_index == "BOTH" and bse_enabled:
            return ["NIFTY", "SENSEX"]
        elif indicative_index == "SENSEX" and bse_enabled:
            return ["SENSEX"]
        else:
            return ["NIFTY"]

    def _get_setting_safely(self, key: str, default: Any) -> Any:
        """Safely get a setting from either self._state or default."""
        # Try to get from state (for backward compatibility)
        state_settings = self._state.get("settings", {})
        if key in state_settings:
            return state_settings[key]
        # Fall back to default
        return default

    def _execute(
        self,
        index: str,
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
                self._states[index]["status"] = "FAILED"
                self._states[index]["reason"] = "kite_not_connected"
                self._states[index]["order_status"] = "failed"
            return
        atm = int(self._states[index]["locked_atm"])
        symbol = self._states[index]["prepared_ce"] if opt == "CE" else self._states[index]["prepared_pe"]
        leg = self._cache._legs.get((index, opt, atm))
        if leg is None or client is None:
            with self._lock:
                self._states[index]["status"] = "FAILED"
                self._states[index]["reason"] = "leg_or_kite_missing"
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
            "CAS AUTO TRADE [%s] mode=%s pre=%.2f ind=%.2f delta=%+.2f atm=%s signal=%s BUY %s x%d order=%s err=%s",
            index,
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
            bull = float(settings.get("auto_bullish_pts") if settings.get("auto_bullish_pts") is not None else 15)
            bear = float(settings.get("auto_bearish_pts") if settings.get("auto_bearish_pts") is not None else 15)
            recap = (
                f"{kind} at {_clock(ack_at)}: {opt} {symbol} ×{qty} because Indicative Close "
                f"{indicative:.2f} vs frozen {index} {pre:.2f} is Δ {delta:+.2f} "
                f"({'≥ +' + format(bull, 'g') if opt == 'CE' else '≤ −' + format(bear, 'g')} threshold) → "
                f"{'BULLISH so BUY CE' if opt == 'CE' else 'BEARISH so BUY PE'} "
                f"ATM {atm} (ATM from freeze, not from indicative)."
            )
            if err:
                recap = f"FAILED at {_clock(ack_at)}: {err}"
            if err:
                self._states[index]["status"] = "FAILED"
                self._states[index]["reason"] = err
                self._states[index]["order_status"] = "failed"
            else:
                self._states[index]["status"] = "EXECUTED"
                self._states[index]["reason"] = "exit_manually_in_positions"
                self._states[index]["order_status"] = "paper" if not live else "submitted"
            self._states[index]["order_id"] = order_id
            self._states[index]["tradingsymbol"] = symbol
            self._states[index]["quantity"] = qty
            self._states[index]["latency"] = latency
            self._states[index]["how"] = recap
            self._states[index]["fired_at"] = ack_at
            self._states[index]["decision"] = {
                "freeze": pre,
                "indicative": indicative,
                "delta": round(delta, 2),
                "atm": atm,
                "opt_type": opt,
                "signal": "BULLISH" if opt == "CE" else "BEARISH",
                "tradingsymbol": symbol,
                "quantity": qty,
                "because": recap,
            }
        # Update backward compatibility fields (for single index mode)
        if self._get_setting_safely("indicative_index", "NIFTY").upper() == "NIFTY" and not self._get_setting_safely("bse_enabled", False):
            with self._lock:
                self._state["status"] = self._states[index]["status"]
                self._state["reason"] = self._states[index]["reason"]
                self._state["order_status"] = self._states[index]["order_status"]
                self._state["order_id"] = order_id
                self._state["tradingsymbol"] = symbol
                self._state["quantity"] = qty
                self._state["latency"] = latency
                self._state["how"] = recap
                self._state["fired_at"] = ack_at
                self._state["decision"] = self._states[index]["decision"]
        self._append_test_log({
            "kind": "BUY" if not err else "FAILED",
            "mode": mode,
            "index": index,
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
