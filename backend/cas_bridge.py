"""Bridge CAS Rule Expiry Automation into oi-pulse.

Uses the same Kite api_key + access_token already stored by the tracker.
Does not place live orders unless admin explicitly enables Live + Activate.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import date, datetime, time as dtime
from typing import Any, Dict, Optional

from cas_rule_expiry_automation.config import AppConfig
from cas_rule_expiry_automation.engine import AutomationEngine, get_engine
from cas_rule_expiry_automation.state import StateStore, get_store
from cas_rule_expiry_automation.time_utils import get_ist_now

logger = logging.getLogger(__name__)

_STATE_PATH = os.environ.get(
    "CAS_STATE_PATH",
    os.path.join(os.path.dirname(__file__), "data", "cas_runtime_state.json"),
)
_LOCK = threading.RLock()
_SETTINGS: Dict[str, Any] = {
    "lots": 1,
    "ce_otm_steps": 1,
    "pe_otm_steps": 1,
    "product": "NRML",
    "live_trading": False,
    "paper_any_day": True,
    "debug_mode": False,
    "watch_indexes": ["NIFTY", "SENSEX"],
}


def _ensure_state_dir() -> None:
    try:
        os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
    except OSError:
        pass


def _build_config(
    api_key: str = "",
    access_token: str = "",
    api_secret: str = "",
    overrides: Optional[Dict[str, Any]] = None,
) -> AppConfig:
    o = {**_SETTINGS, **(overrides or {})}
    debug = bool(o.get("debug_mode"))
    live = bool(o.get("live_trading"))
    # Debug + paper: rehearse any day / any hour (no real orders).
    paper_any = bool(o.get("paper_any_day", True)) or (debug and not live)
    cfg = AppConfig(
        api_key=(api_key or "").strip(),
        api_secret=(api_secret or "").strip(),
        access_token=(access_token or "").strip(),
        lots=max(1, int(o.get("lots") or 1)),
        ce_otm_steps=max(0, int(o.get("ce_otm_steps") or 1)),
        pe_otm_steps=max(0, int(o.get("pe_otm_steps") or 1)),
        product=str(o.get("product") or "NRML").strip().upper() or "NRML",
        live_trading=live,
        paper_any_day=paper_any,
        paper_latency_probe=True,
        fire_on_cas_move=True,
        fire_on_close_update=True,
        fire_on_ltp_in_window=False,
        expiry_only=True,
        nifty_expiry_weekday=1,
        sensex_expiry_weekday=3,
        watch_start=dtime(15, 27),
        watch_end=dtime(15, 35),
        move_window_start=dtime(15, 28),
        move_window_end=dtime(15, 30),
        market_close=dtime(15, 41),
        config_path="",  # memory mode — never write config.ini
    )
    # Attach oi-pulse-only knobs (not in original AppConfig dataclass fields
    # that load_config knows — set as attributes for engine/strategy).
    cfg.debug_mode = debug  # type: ignore[attr-defined]
    watch = o.get("watch_indexes") or ["NIFTY", "SENSEX"]
    cfg.watch_indexes = [  # type: ignore[attr-defined]
        str(x).upper() for x in watch if str(x).upper() in ("NIFTY", "SENSEX")
    ] or ["NIFTY", "SENSEX"]
    # Paper+debug: widen windows so Activate outside market hours still streams
    # and can dry-run on LTP moves (never for live money).
    if debug and not live:
        cfg.watch_start = dtime(0, 0)
        cfg.watch_end = dtime(23, 59, 59)
        cfg.move_window_start = dtime(0, 0)
        cfg.move_window_end = dtime(23, 59, 59)
        cfg.market_close = dtime(23, 59, 59)
        cfg.expiry_only = False
    return cfg


def _apply_config_to_engine(engine: AutomationEngine, cfg: AppConfig) -> None:
    """Hot-apply config without reading config.ini."""
    engine.config = cfg
    engine._indexes_day = None
    engine._indexes_cache = []
    engine._baselines_pulled = False
    engine._dep_error_logged = False
    engine._next_retry_at = 0.0
    if engine.strategy:
        engine.strategy.config = cfg
        engine.strategy.orders.lots = cfg.lots
        engine.strategy.orders.product = cfg.product
        engine.strategy.orders.live_trading = cfg.live_trading
    if engine.client:
        engine.client.config = cfg


def sync_credentials_from_tracker(tracker) -> Dict[str, Any]:
    """Pull Kite credentials from oi-pulse tracker into the CAS engine."""
    with _LOCK:
        _ensure_state_dir()
        engine = get_engine()
        # Point state store at oi-pulse data dir once
        if getattr(engine.store, "path", None) != _STATE_PATH:
            engine.store = StateStore(_STATE_PATH)
            # Rebind global store used by get_store()
            import cas_rule_expiry_automation.state as state_mod

            state_mod._STORE = engine.store

        api_key = ""
        access_token = ""
        svc = getattr(tracker, "kite_service", None)
        if svc is not None and getattr(svc, "kite", None) is not None:
            kite = svc.kite
            api_key = getattr(kite, "api_key", "") or ""
            access_token = getattr(kite, "access_token", "") or ""
            # Some SDK versions keep token only via set_access_token
            if not access_token:
                access_token = getattr(kite, "_access_token", "") or ""

        cfg = _build_config(api_key=api_key, access_token=access_token)
        _apply_config_to_engine(engine, cfg)

        # Attach live kite instance when available (skip reconnect)
        if svc is not None and getattr(svc, "kite", None) is not None:
            from cas_rule_expiry_automation.kite_client import KiteClient

            if engine.client is None:
                engine.client = KiteClient(cfg)
            engine.client.config = cfg
            engine.client.kite = svc.kite

        if not engine.running:
            engine.start()

        return {
            "has_kite": bool(api_key and access_token),
            "mode": getattr(tracker, "mode", "offline"),
            "live_trading": bool(cfg.live_trading),
            "lots": cfg.lots,
        }


def get_status(tracker=None) -> Dict[str, Any]:
    if tracker is not None:
        sync_credentials_from_tracker(tracker)
    engine = get_engine()
    status = engine.status()
    status["settings"] = dict(_SETTINGS)
    status["plain"] = _plain_status(status)
    return status


def _plain_status(status: Dict[str, Any]) -> Dict[str, Any]:
    """Human-friendly summary for the UI."""
    day = status.get("day") or {}
    state = status.get("state") or {}
    cfg = status.get("config") or {}
    settings = status.get("settings") or {}
    activated = bool(state.get("activated"))
    live = bool(cfg.get("live_trading"))
    debug = bool(settings.get("debug_mode") or getattr(cfg, "debug_mode", False) or cfg.get("debug_mode"))
    indexes = day.get("indexes") or []
    fired = state.get("fired_indexes") or []
    if activated and live:
        mode_label = "LIVE armed — real MARKET sells"
    elif activated and debug:
        mode_label = "PAPER + DEBUG armed — dry-run · any-time feed"
    elif activated:
        mode_label = "PAPER armed — dry-run sells only"
    elif debug:
        mode_label = "Debug on — Activate anytime (Paper safe)"
    else:
        mode_label = "Off — pick Paper or Live, then Activate"

    return {
        "mode_label": mode_label,
        "activated": activated,
        "live": live,
        "debug": debug,
        "is_expiry_day": bool(day.get("is_expiry_day")),
        "watching": indexes,
        "fired": fired,
        "weekday": day.get("weekday"),
        "date": day.get("date"),
        "market_closed": bool(status.get("market_closed")),
        "ws_connected": bool((state.get("ws_connected"))),
        "fills_today": len(state.get("fills") or []),
        "last_error": state.get("last_error"),
        "ticks": (status.get("ws") or {}).get("ticks_received") or state.get("ticks_seen") or 0,
    }


def update_settings(patch: Dict[str, Any], tracker=None, *, allow_live: bool = False) -> Dict[str, Any]:
    with _LOCK:
        if "lots" in patch:
            _SETTINGS["lots"] = max(1, min(50, int(patch["lots"])))
        if "ce_otm_steps" in patch:
            _SETTINGS["ce_otm_steps"] = max(0, min(5, int(patch["ce_otm_steps"])))
        if "pe_otm_steps" in patch:
            _SETTINGS["pe_otm_steps"] = max(0, min(5, int(patch["pe_otm_steps"])))
        if "product" in patch:
            prod = str(patch["product"]).strip().upper()
            if prod not in ("NRML", "MIS"):
                raise ValueError("product must be NRML or MIS")
            _SETTINGS["product"] = prod
        if "paper_any_day" in patch:
            _SETTINGS["paper_any_day"] = bool(patch["paper_any_day"])
        if "debug_mode" in patch:
            _SETTINGS["debug_mode"] = bool(patch["debug_mode"])
            # Live + debug is still allowed for activate-after-hours, but we never
            # widen fire windows while live_trading is on.
        if "watch_indexes" in patch:
            raw = patch["watch_indexes"] or []
            if isinstance(raw, str):
                raw = [x.strip() for x in raw.split(",") if x.strip()]
            cleaned = [str(x).upper() for x in raw if str(x).upper() in ("NIFTY", "SENSEX")]
            if not cleaned:
                raise ValueError("Pick at least one index: NIFTY or SENSEX")
            _SETTINGS["watch_indexes"] = cleaned
        if "live_trading" in patch:
            if bool(patch["live_trading"]) and not allow_live:
                raise PermissionError("Only admin can enable Live trading")
            _SETTINGS["live_trading"] = bool(patch["live_trading"])
            # Safety: turning Live on while armed requires re-activate
            if _SETTINGS["live_trading"]:
                store = get_store()
                if store.is_activated():
                    store.deactivate(by="switched-to-live")
        if tracker is not None:
            sync_credentials_from_tracker(tracker)
        else:
            engine = get_engine()
            _apply_config_to_engine(engine, _build_config(
                api_key=engine.config.api_key,
                access_token=engine.config.access_token,
            ))
        return get_status(tracker)


def activate(tracker, *, by: str = "admin", require_live_confirm: bool = False) -> Dict[str, Any]:
    sync_credentials_from_tracker(tracker)
    engine = get_engine()
    if not (engine.config.api_key and engine.config.access_token):
        raise RuntimeError("Kite not connected. Open Kite API in the header and connect first.")
    if engine.config.live_trading and not require_live_confirm:
        raise RuntimeError("Live mode needs an explicit confirm flag.")
    debug = bool(getattr(engine.config, "debug_mode", False) or _SETTINGS.get("debug_mode"))
    if (not debug) and get_ist_now().time() >= engine.config.market_close:
        raise RuntimeError(
            "Market is closed for CAS (after 15:41 IST). Turn on Debug to rehearse, or try tomorrow."
        )
    get_store().activate(by=by + ("+debug" if debug else ""))
    return get_status(tracker)


def deactivate(tracker, *, by: str = "admin") -> Dict[str, Any]:
    sync_credentials_from_tracker(tracker)
    get_store().deactivate(by=by)
    return get_status(tracker)


def reset_day(tracker) -> Dict[str, Any]:
    sync_credentials_from_tracker(tracker)
    get_store().reset_day()
    return get_status(tracker)


def run_backtest(
    tracker,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    lots: Optional[int] = None,
    capital: Optional[float] = None,
    indexes: Optional[list] = None,
) -> Dict[str, Any]:
    sync_credentials_from_tracker(tracker)
    from cas_rule_expiry_automation.backtest_ws import run_ws_backtest
    from copy import copy
    from dataclasses import asdict

    engine = get_engine()
    kite = engine.client.kite if engine.client else None
    if kite is None and getattr(tracker, "kite_service", None):
        kite = tracker.kite_service.kite

    start_d = date.fromisoformat(start) if start else None
    end_d = date.fromisoformat(end) if end else None
    idx_filter = None
    if indexes:
        idx_filter = [str(x).upper() for x in indexes if str(x).upper() in ("NIFTY", "SENSEX")]
        if not idx_filter:
            raise ValueError("indexes must include NIFTY and/or SENSEX")
    # Backtest selection overrides live watch_indexes for this run only.
    bt_cfg = copy(engine.config)
    bt_cfg.watch_indexes = list(idx_filter or ["NIFTY", "SENSEX"])  # type: ignore[attr-defined]
    # Keep expiry calendar for historical days (do not widen via debug).
    bt_cfg.expiry_only = True
    result = run_ws_backtest(
        kite=kite,
        config=bt_cfg,
        start=start_d,
        end=end_d,
        capital=capital,
        lots=lots if lots is not None else _SETTINGS["lots"],
        indexes=idx_filter,
    )
    # BacktestResult is a dataclass
    if hasattr(result, "__dataclass_fields__"):
        return asdict(result)
    if isinstance(result, dict):
        return result
    return {"error": "unexpected backtest result"}
