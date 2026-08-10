"""Thin Kite Connect REST client (orders / instruments / auth)."""

from __future__ import annotations

import logging
import os
import sys
import time
from typing import Any, Optional

from cas_rule_expiry_automation.config import AppConfig, load_config, save_kite_credentials
from cas_rule_expiry_automation.deps import ensure_kite_deps

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VENDOR = os.path.join(_ROOT, "vendor", "pykiteconnect")
for p in (_ROOT, _VENDOR):
    if p not in sys.path:
        sys.path.insert(0, p)


def _kite_error_message(exc: BaseException) -> str:
    """Normalize kiteconnect / HTTP errors into a short operator-facing string."""
    msg = getattr(exc, "message", None) or str(exc) or exc.__class__.__name__
    et = getattr(exc, "error_type", None)
    if et and str(et) not in str(msg):
        return f"{et}: {msg}"
    return str(msg)


def _KiteConnect():
    ensure_kite_deps()
    from kiteconnect import KiteConnect

    return KiteConnect


def kiteconnect_supports_market_protection() -> bool:
    """True when installed kiteconnect.place_order accepts market_protection."""
    try:
        import inspect

        KC = _KiteConnect()
        return "market_protection" in inspect.signature(KC.place_order).parameters
    except Exception:
        return False


class KiteClient:
    def __init__(self, config: Optional[AppConfig] = None) -> None:
        self.config = config or load_config()
        self.kite: Any = None

    def connect(self, access_token: Optional[str] = None) -> Any:
        key = self.config.api_key
        token = (access_token or self.config.access_token or "").strip()
        if not key or key.startswith("YOUR_"):
            raise RuntimeError("api_key not set — use config.ini or the UI")
        if not token:
            token = self._parent_token() or ""
        if not token:
            raise RuntimeError("access_token missing")
        KC = _KiteConnect()
        self.kite = KC(api_key=key)
        self.kite.set_access_token(token)
        # oi-pulse memory mode: never write config.ini
        if (self.config.config_path or "").strip():
            save_kite_credentials(key, self.config.api_secret, token, self.config.config_path)
            self._save_parent_token(token)
        self.config.access_token = token
        return self.kite

    def login_url(self) -> str:
        return _KiteConnect()(api_key=self.config.api_key).login_url()

    def exchange_request_token(self, request_token: str) -> str:
        """Exchange one-time request_token → access_token; persist server-side only.

        Never log or return the access_token to callers that might echo it to
        the browser — callers should treat the return value as server-private.
        """
        key = (self.config.api_key or "").strip()
        secret = (self.config.api_secret or "").strip()
        req = (request_token or "").strip()
        if not key or key.upper().startswith("YOUR_"):
            raise RuntimeError("api_key not set — save API key first")
        if not secret or secret.upper().startswith("YOUR_"):
            raise RuntimeError("api_secret not set — save API secret first")
        if not req:
            raise RuntimeError("request_token required")
        KC = _KiteConnect()
        kite = KC(api_key=key)
        data = kite.generate_session(req, api_secret=secret)
        token = data["access_token"]
        kite.set_access_token(token)
        self.kite = kite
        save_kite_credentials(key, secret, token, self.config.config_path)
        self._save_parent_token(token)
        self.config.access_token = token
        logger.info("Kite access_token generated and saved (value not logged)")
        return token

    def invalidate_session(self) -> None:
        """Best-effort remote revoke of the current access_token (Zerodha)."""
        token = (self.config.access_token or "").strip()
        key = (self.config.api_key or "").strip()
        if not token or not key:
            return
        try:
            KC = _KiteConnect()
            kite = self.kite or KC(api_key=key)
            if not self.kite:
                kite.set_access_token(token)
            kite.invalidate_access_token(token)
            logger.info("Kite access_token invalidated remotely (value not logged)")
        except Exception as exc:
            logger.info("Kite remote invalidate skipped: %s", exc.__class__.__name__)

    def profile(self) -> dict:
        if not self.kite:
            self.connect()
        return self.kite.profile()

    @staticmethod
    def safe_profile(raw: Optional[dict] = None) -> dict:
        """Public-safe subset of Kite profile (never secrets / tokens)."""
        if not isinstance(raw, dict):
            return {}
        out = {}
        for k in ("user_id", "user_name", "user_shortname", "email", "broker"):
            val = raw.get(k)
            if isinstance(val, (str, int, float)):
                text = str(val).strip()
                if text:
                    out[k] = text
        return out

    def quote(self, keys: list[str]) -> dict:
        if not self.kite:
            self.connect()
        return self.kite.quote(keys)

    def instruments(self, exchange: str) -> list:
        if not self.kite:
            self.connect()
        return self.kite.instruments(exchange)

    def historical(self, token: int, start, end, interval: str = "minute") -> list:
        if not self.kite:
            self.connect()
        return self.kite.historical_data(token, start, end, interval)

    def previous_session_close(self, instrument_token: int, asof=None) -> float:
        """Official previous trading-day close from daily history.

        Do NOT use quote ``ohlc.close`` overnight — Kite keeps that as the
        prior session until ~06:30 IST BOD, so after hours it is one day stale.
        Historical daily bars already carry the latest completed session close.
        """
        from datetime import date, datetime, timedelta

        from cas_rule_expiry_automation.time_utils import get_ist_now

        if asof is None:
            asof = get_ist_now().date()
        elif isinstance(asof, datetime):
            asof = asof.date()
        elif not isinstance(asof, date):
            asof = date.fromisoformat(str(asof)[:10])

        start = asof - timedelta(days=15)
        bars = self.historical(int(instrument_token), start, asof, "day") or []

        def _bar_day(bar) -> Optional[date]:
            dt = bar.get("date")
            if dt is None:
                return None
            if isinstance(dt, datetime):
                try:
                    return dt.astimezone().date() if dt.tzinfo else dt.date()
                except Exception:
                    return dt.date()
            if isinstance(dt, date):
                return dt
            try:
                return date.fromisoformat(str(dt)[:10])
            except Exception:
                return None

        # Prefer last bar strictly before ``asof`` (previous session).
        prior = []
        for b in bars:
            d = _bar_day(b)
            if d is not None and d < asof:
                prior.append(b)
        if prior:
            return float(prior[-1]["close"])
        if bars:
            return float(bars[-1]["close"])
        return 0.0

    def place_market_sell(
        self,
        exchange: str,
        tradingsymbol: str,
        quantity: int,
        product: str,
        tag: str = "CASRULE",
        live: bool = False,
    ) -> Any:
        """Punch a MARKET SELL per Kite Connect v3 + SEBI algo rules.

        Required for live MARKET / SL-M via API (Apr 2025+):
          - order_type=MARKET
          - market_protection != 0  (−1 = auto system protection)
          - do NOT send price (LIMIT-only) or trigger_price (SL/SL-M only)
          - requests must come from a Kite-developer **static IP whitelist**
          - valid access_token + active F&O tradingsymbol (no trailing spaces)

        Official example payload shape:
          variety=regular, transaction_type=SELL, validity=DAY,
          product=NRML|MIS, market_protection=-1
        """
        if not self.kite:
            self.connect()

        symbol = (tradingsymbol or "").strip()
        if not symbol:
            raise ValueError("tradingsymbol is empty")
        qty = int(quantity)
        if qty <= 0:
            raise ValueError(f"quantity must be > 0, got {qty}")
        exch = (exchange or "").strip().upper()
        prod = (product or "NRML").strip().upper() or "NRML"
        if prod not in ("NRML", "MIS"):
            raise ValueError(f"product must be NRML or MIS, got {prod}")

        if not live:
            logger.warning(
                "[DRY-RUN] MARKET SELL %s x%d %s/%s (no broker call)",
                symbol,
                qty,
                exch,
                prod,
            )
            return f"DRY-{symbol}-{int(time.time()*1000)%100000}"

        # Never pass price=0 / trigger_price=0 — those are LIMIT/SL fields and
        # the pykiteconnect client omits only None (0 would be sent to Kite).
        protection = int(getattr(self.kite, "MARKET_PROTECTION_AUTO", -1) or -1)
        if protection == 0:
            # 0 is rejected by Kite as unprotected MARKET
            protection = -1
        validity = getattr(self.kite, "VALIDITY_DAY", "DAY")

        # kiteconnect>=5.2 accepts market_protection; older wheels TypeError.
        kwargs: dict = {
            "variety": self.kite.VARIETY_REGULAR,
            "exchange": exch,
            "tradingsymbol": symbol,
            "transaction_type": self.kite.TRANSACTION_TYPE_SELL,
            "quantity": qty,
            "product": prod,
            "order_type": self.kite.ORDER_TYPE_MARKET,
            "validity": validity,
            "tag": (tag or "CASRULE")[:20],
            "market_protection": protection,
        }
        logger.info(
            "Kite place_order MARKET SELL %s/%s x%d product=%s validity=%s protection=%s",
            exch,
            symbol,
            qty,
            prod,
            validity,
            protection,
        )
        try:
            return self.kite.place_order(**kwargs)
        except TypeError as exc:
            # Fallback if an older kiteconnect build lacks market_protection kw.
            if "market_protection" not in str(exc):
                raise
            logger.error(
                "kiteconnect place_order lacks market_protection — upgrade to >=5.2.0"
            )
            raise RuntimeError(
                "Installed kiteconnect cannot send market_protection. "
                "Upgrade to kiteconnect>=5.2.0 or Live MARKET sells will be rejected."
            ) from exc
        except Exception as exc:
            # Surface Zerodha message clearly (token / IP / symbol / margin / …)
            msg = _kite_error_message(exc)
            logger.exception("Kite MARKET SELL rejected: %s", msg)
            raise RuntimeError(msg) from exc

    def clear_local_session(self) -> None:
        """Drop in-memory kite client (does not touch config.ini)."""
        self.kite = None
        self.config.access_token = ""
        self._save_parent_token("")

    @staticmethod
    def _parent_token() -> Optional[str]:
        try:
            import instrument_cache

            return instrument_cache.get_kite_token()
        except Exception:
            return None

    @staticmethod
    def _save_parent_token(token: str) -> None:
        try:
            import instrument_cache

            if token:
                instrument_cache.save_kite_token(token)
            else:
                # Best-effort clear if the helper supports it
                if hasattr(instrument_cache, "clear_kite_token"):
                    instrument_cache.clear_kite_token()
                elif hasattr(instrument_cache, "save_kite_token"):
                    instrument_cache.save_kite_token("")
        except Exception:
            pass
