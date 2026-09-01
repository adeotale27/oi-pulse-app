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
    "auto_trade_lots": 1,
    "ce_otm_steps": 1,
    "pe_otm_steps": 1,
    "product": "NRML",
    "live_trading": False,
    "paper_any_day": True,
    "debug_mode": False,
    "watch_indexes": ["NIFTY", "SENSEX"],
    "auto_trade_enabled": False,
    "auto_trade_mode": "off",  # off | paper | live
    "auto_prepare_time": "15:19:30",
    "auto_arm_time": "15:19:55",
    "auto_signal_start": "15:20:00",
    "auto_cutoff_time": "15:22:00",
    "auto_bullish_pts": 15.0,
    "auto_bearish_pts": 15.0,
    "auto_poll_ms": 250,
}
_EGRESS_CACHE: Dict[str, Any] = {"ip": None, "at": 0.0, "error": None}


def detect_backend_egress_ip(*, force: bool = False) -> Dict[str, Any]:
    """Public IP Zerodha sees for Live place_order from THIS backend process.

    Not your laptop IP when the app is hosted on Emergent/cloud — whitelist
    the server egress IP. Cached ~10 minutes.
    """
    import time
    import urllib.request

    now = time.time()
    if (
        not force
        and _EGRESS_CACHE.get("ip")
        and now - float(_EGRESS_CACHE.get("at") or 0) < 600
    ):
        return {
            "ip": _EGRESS_CACHE["ip"],
            "source": "cache",
            "note": _EGRESS_CACHE.get("note"),
            "error": None,
        }
    ip = None
    err = None
    for url in (
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
    ):
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                cand = (resp.read() or b"").decode("utf-8", errors="ignore").strip()
            # basic IPv4/IPv6 sanity
            if cand and " " not in cand and 3 <= len(cand) <= 45:
                ip = cand
                break
        except Exception as exc:
            err = str(exc)
            continue
    note = (
        "Whitelist this IP in Kite developer Profile → IP Whitelist. "
        "It is the backend/server egress IP (Emergent host if the API runs there), "
        "NOT your home/office PC IP unless you run the backend locally."
    )
    _EGRESS_CACHE["ip"] = ip
    _EGRESS_CACHE["at"] = now
    _EGRESS_CACHE["error"] = None if ip else err
    _EGRESS_CACHE["note"] = note
    return {"ip": ip, "source": "live", "note": note, "error": None if ip else err}


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


def _config_fingerprint(cfg: AppConfig) -> tuple:
    """Cheap identity for hot-apply — avoid nuking strategy on every status poll."""
    return (
        (cfg.api_key or "").strip(),
        (cfg.access_token or "").strip(),
        int(cfg.lots),
        int(cfg.ce_otm_steps),
        int(cfg.pe_otm_steps),
        str(cfg.product),
        bool(cfg.live_trading),
        bool(cfg.paper_any_day),
        bool(getattr(cfg, "debug_mode", False)),
        tuple(getattr(cfg, "watch_indexes", None) or ()),
        cfg.watch_start.isoformat(),
        cfg.watch_end.isoformat(),
        cfg.move_window_start.isoformat() if getattr(cfg, "move_window_start", None) else "",
        cfg.move_window_end.isoformat() if getattr(cfg, "move_window_end", None) else "",
        cfg.market_close.isoformat(),
        bool(cfg.expiry_only),
    )


def _apply_config_to_engine(
    engine: AutomationEngine, cfg: AppConfig, *, force: bool = False
) -> bool:
    """Hot-apply config. Returns True if anything meaningful changed.

    Status polling must NOT clear pre-move LTP / indexes on every tick — that
    breaks Debug+Paper move detection and makes Paper/Live toggles feel flaky.
    """
    prev = getattr(engine, "_cas_cfg_fp", None)
    fp = _config_fingerprint(cfg)
    settings_changed = force or prev != fp
    creds_changed = force or prev is None or (
        prev[0] != fp[0] or prev[1] != fp[1]
    )

    engine.config = cfg
    if engine.client:
        engine.client.config = cfg

    if settings_changed:
        # Window / lots / live / debug changed — refresh bounds without wiping
        # day baselines unless credentials actually changed.
        if engine.strategy:
            engine.strategy.config = cfg
            engine.strategy.orders.lots = cfg.lots
            engine.strategy.orders.product = cfg.product
            engine.strategy.orders.live_trading = cfg.live_trading
            try:
                engine.strategy._refresh_window_bounds()
            except Exception:
                pass
            # Indexes may change when watch_indexes / expiry_only / paper_any flip.
            engine._indexes_day = None
            engine._indexes_cache = []
        engine._cas_cfg_fp = fp

    if creds_changed:
        engine._baselines_pulled = False
        engine._dep_error_logged = False
        engine._next_retry_at = 0.0
        engine._cas_cfg_fp = fp

    return settings_changed or creds_changed


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
    status["live_readiness"] = _live_readiness(status)
    status["plain"] = _plain_status(status)
    try:
        from cas_auto_trade import get_auto_trade

        status["auto_trade"] = get_auto_trade().snapshot()
    except Exception:
        status["auto_trade"] = {"status": "IDLE", "mode": "off"}
    return status


def _live_readiness(status: Dict[str, Any]) -> Dict[str, Any]:
    """Checklist vs Zerodha live MARKET-order requirements (ops + code)."""
    from cas_rule_expiry_automation.kite_client import (
        kiteconnect_supports_market_protection,
    )

    cfg = status.get("config") or {}
    has_token = bool(cfg.get("has_token"))
    has_key = bool(cfg.get("has_key"))
    mp_ok = kiteconnect_supports_market_protection()
    egress = detect_backend_egress_ip()
    egress_ip = egress.get("ip")
    checks = [
        {
            "id": "api_key",
            "ok": has_key,
            "label": "Kite api_key present",
            "fix": "Connect via Kite API in the header" if not has_key else "OK",
        },
        {
            "id": "access_token",
            "ok": has_token,
            "label": "Valid access_token session",
            "fix": (
                "Re-login if token expired or you logged in elsewhere"
                if not has_token
                else "OK — re-login daily / if session drops"
            ),
        },
        {
            "id": "market_protection",
            "ok": mp_ok,
            "label": "SDK supports market_protection (−1 auto)",
            "fix": (
                "Upgrade kiteconnect to ≥5.2.0"
                if not mp_ok
                else "CAS sends MARKET + market_protection=-1 + validity=DAY"
            ),
        },
        {
            "id": "fno_symbol",
            "ok": True,
            "label": "F&O symbol resolve (CE/PE)",
            "fix": (
                "Uses Kite instruments name=NIFTY|SENSEX + segment + strike + CE/PE "
                "(same idea as OI desk). Never invents symbols."
            ),
        },
        {
            "id": "static_ip",
            "ok": None,  # detected ≠ whitelisted; still an ops step
            "label": "Static IP to whitelist (backend egress)",
            "fix": (
                f"Detected backend egress IP: {egress_ip}. "
                f"{egress.get('note') or ''}"
                if egress_ip
                else (
                    "Could not detect egress IP automatically. "
                    "From the machine running the API, open https://api.ipify.org "
                    "and whitelist that value — Emergent server IP if hosted there, "
                    "not your laptop (unless backend runs on your laptop)."
                )
            ),
        },
        {
            "id": "order_shape",
            "ok": True,
            "label": "CAS order shape (MARKET SELL CE+PE)",
            "fix": (
                "variety=regular · order_type=MARKET · no price/trigger · "
                f"product={cfg.get('product') or 'NRML'} · tag=CASRULE · parallel legs"
            ),
        },
        {
            "id": "rate_limits",
            "ok": True,
            "label": "Order rate limits",
            "fix": (
                "CAS fires ~2 MARKET sells per index per day — well under "
                "400/min and 5000/day. Avoid spam Activate/Debug probes on Live."
            ),
        },
    ]
    blockers = [c for c in checks if c.get("ok") is False]
    return {
        "ready_for_code": has_key and has_token and mp_ok,
        "needs_ops_ip_whitelist": True,
        "egress_ip": egress_ip,
        "egress": egress,
        "checks": checks,
        "blockers": [c["id"] for c in blockers],
        "summary": (
            f"Code path is Live-capable. Whitelist backend IP {egress_ip} in Kite "
            "developer Profile before Activate Live."
            if has_key and has_token and mp_ok and egress_ip
            else (
                "Code path is Live-capable. Confirm static IP whitelist before Activate Live."
                if has_key and has_token and mp_ok
                else "Fix blockers below before Live Activate."
            )
        ),
    }


def _plain_status(status: Dict[str, Any]) -> Dict[str, Any]:
    """Human-friendly summary for the UI."""
    day = status.get("day") or {}
    state = status.get("state") or {}
    cfg = status.get("config") or {}
    settings = status.get("settings") or {}
    activated = bool(state.get("activated"))
    if "live_trading" in cfg:
        live = bool(cfg.get("live_trading"))
    elif "live_trading" in settings:
        live = bool(settings.get("live_trading"))
    else:
        live = False
    debug = bool(settings.get("debug_mode") or cfg.get("debug_mode"))
    indexes = day.get("indexes") or []
    fired = state.get("fired_indexes") or []
    if activated and live:
        mode_label = "LIVE armed — real MARKET sells"
    elif activated and debug:
        mode_label = "PAPER + DEBUG armed — dry-run · any-time feed"
    elif activated:
        mode_label = "PAPER armed — dry-run sells only"
    elif debug and live:
        mode_label = "Debug on · Live selected — Activate anytime (REAL orders)"
    elif debug:
        mode_label = "Debug on · Paper selected — Activate anytime (safe dry-run)"
    elif live:
        mode_label = "Live selected — Activate in market hours for real sells"
    else:
        mode_label = "Paper selected — Activate to dry-run"

    readiness = status.get("live_readiness") or {}
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
        "live_ready_code": bool(readiness.get("ready_for_code")),
        "live_ready_summary": readiness.get("summary"),
    }


def update_settings(patch: Dict[str, Any], tracker=None, *, allow_live: bool = False) -> Dict[str, Any]:
    with _LOCK:
        if "lots" in patch:
            _SETTINGS["lots"] = max(1, min(50, int(patch["lots"])))
        if "auto_trade_lots" in patch:
            _SETTINGS["auto_trade_lots"] = max(1, min(50, int(patch["auto_trade_lots"])))
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
            want_live = bool(patch["live_trading"])
            auto_mode_next = str(
                patch.get("auto_trade_mode", _SETTINGS.get("auto_trade_mode") or "off")
            ).strip().lower()
            if want_live and auto_mode_next == "live":
                raise ValueError(
                    "Turn off Auto-Trade Live before enabling classic CAS Live "
                    "(do not run both live arms on the same expiry)"
                )
            _SETTINGS["live_trading"] = want_live
            # Safety: turning Live on while armed requires re-activate
            if _SETTINGS["live_trading"]:
                store = get_store()
                if store.is_activated():
                    store.deactivate(by="switched-to-live")
        if "auto_trade_enabled" in patch:
            _SETTINGS["auto_trade_enabled"] = bool(patch["auto_trade_enabled"])
        if "auto_trade_mode" in patch:
            mode = str(patch["auto_trade_mode"] or "off").strip().lower()
            if mode not in ("off", "paper", "live"):
                raise ValueError("auto_trade_mode must be off, paper, or live")
            if mode == "live" and not allow_live:
                raise PermissionError("Only admin can enable Live auto-trade")
            live_classic = bool(_SETTINGS.get("live_trading"))
            if "live_trading" in patch:
                live_classic = bool(patch["live_trading"])
            if mode == "live" and live_classic:
                raise ValueError(
                    "Turn off classic CAS Live before enabling Auto-Trade Live "
                    "(do not run both live arms on the same expiry)"
                )
            _SETTINGS["auto_trade_mode"] = mode
            if mode == "live":
                _SETTINGS["auto_trade_enabled"] = True
            elif mode == "off":
                _SETTINGS["auto_trade_enabled"] = False
        for key, lo, hi, cast in (
            ("auto_bullish_pts", 0.0, 200.0, float),
            ("auto_bearish_pts", 0.0, 200.0, float),
            ("auto_poll_ms", 150, 2000, int),
        ):
            if key in patch:
                _SETTINGS[key] = max(lo, min(hi, cast(patch[key])))
        for tkey in (
            "auto_prepare_time",
            "auto_arm_time",
            "auto_signal_start",
            "auto_cutoff_time",
        ):
            if tkey in patch and patch[tkey] is not None:
                raw = str(patch[tkey]).strip()
                parts = raw.split(":")
                if len(parts) < 2:
                    raise ValueError(f"{tkey} must be HH:MM")
                _SETTINGS[tkey] = raw
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
    # Always gate on the *current* live flag after sync (never trust a stale pre-check).
    if bool(engine.config.live_trading) and not require_live_confirm:
        raise RuntimeError("Live mode needs an explicit confirm flag.")
    debug = bool(getattr(engine.config, "debug_mode", False) or _SETTINGS.get("debug_mode"))
    if (not debug) and get_ist_now().time() >= engine.config.market_close:
        raise RuntimeError(
            "Market is closed for CAS (after 15:41 IST). Turn on Debug to rehearse, or try tomorrow."
        )
    if engine.config.live_trading:
        from cas_rule_expiry_automation.kite_client import (
            kiteconnect_supports_market_protection,
        )

        if not kiteconnect_supports_market_protection():
            raise RuntimeError(
                "kiteconnect is too old for Live MARKET sells (needs market_protection). "
                "Upgrade to kiteconnect>=5.2.0."
            )
        logger.warning(
            "LIVE CAS activate — ensure Kite developer static IP is whitelisted for this host’s "
            "public egress IP or place_order will be rejected"
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
    try:
        from cas_auto_trade import get_auto_trade

        get_auto_trade().reset_today()
    except Exception:
        logger.exception("CAS auto-trade reset failed")
    return get_status(tracker)


def inject_auto_trade(indicative: float, tracker=None) -> Dict[str, Any]:
    """Paper: fake the first NSE indicative (rehearsal before 15:20)."""
    if tracker is not None:
        sync_credentials_from_tracker(tracker)
    from cas_auto_trade import get_auto_trade

    engine = get_engine()
    get_auto_trade().inject_indicative(float(indicative), _SETTINGS, engine.client)
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
