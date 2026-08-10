"""WebSocket-driven CAS fire strategy — catch theta decay on the CAS move.

Why we fire
-----------
Under SEBI's Closing Auction Session, index constituents auction near the close.
Nifty / Sensex can print a sudden move roughly **15:28–15:30 IST**. That print
is our ATM. We MARKET-sell CE+PE *on that tick* to catch instant theta decay.

What we do NOT do
-----------------
Do **not** sell merely because the watch clock hit 15:27. Arming early only
locks a pre-move LTP reference so the first real move inside the auction window
is detectable. A 15:27 dry-run (old ``paper_latency_probe``) sold stale ATM and
missed the move — useless for the CAS rule.

Signals (first wins per index)
------------------------------
1. ``ws_ohlc_close`` — ``ohlc.close`` flips from prev-session baseline (live CAS print)
2. ``cas_ltp_move``  — LTP changes vs pre-move reference inside the move window
   (default 15:28–15:30). Works on expiry days **and** paper non-expiry rehearsal.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional, Set

from cas_rule_expiry_automation.config import AppConfig
from cas_rule_expiry_automation.expiry_calendar import (
    INDEX_META,
    indexes_for_date,
    today_indexes,
)
from cas_rule_expiry_automation.kite_client import KiteClient
from cas_rule_expiry_automation.order_engine import OrderEngine
from cas_rule_expiry_automation.state import StateStore
from cas_rule_expiry_automation.strike_resolver import StrikeCache
from cas_rule_expiry_automation.time_utils import get_ist_now
from cas_rule_expiry_automation.timing import new_detect_event

logger = logging.getLogger(__name__)

# IST is UTC+5:30 fixed — used for a cheap window check on every tick.
_IST_OFFSET_SEC = 5 * 3600 + 30 * 60


def _ist_day_seconds() -> float:
    """Seconds since local IST midnight (no datetime alloc)."""
    return (time.time() + _IST_OFFSET_SEC) % 86400.0


def _time_to_day_seconds(t) -> float:
    return t.hour * 3600 + t.minute * 60 + t.second + t.microsecond / 1e6


def _tick_move_iso(tick: dict) -> str:
    """Best-effort IST timestamp for when the index last moved on this tick."""
    # Kite FULL mode may include exchange_timestamp (epoch seconds).
    for key in ("exchange_timestamp", "timestamp", "last_trade_time"):
        raw = tick.get(key)
        if raw is None:
            continue
        try:
            if hasattr(raw, "isoformat"):
                # datetime from SDK
                if getattr(raw, "tzinfo", None) is None:
                    from cas_rule_expiry_automation.time_utils import IST

                    raw = raw.replace(tzinfo=IST)
                return raw.isoformat(timespec="milliseconds")
            sec = float(raw)
            if sec > 1e12:  # ms
                sec /= 1000.0
            from datetime import datetime

            from cas_rule_expiry_automation.time_utils import IST

            return datetime.fromtimestamp(sec, tz=IST).isoformat(timespec="milliseconds")
        except Exception:
            continue
    return get_ist_now().isoformat(timespec="milliseconds")


class StrategyEngine:
    def __init__(
        self,
        client: KiteClient,
        config: AppConfig,
        store: StateStore,
    ) -> None:
        self.client = client
        self.config = config
        self.store = store
        self.cache = StrikeCache()
        self.orders = OrderEngine(
            client,
            lots=config.lots,
            product=config.product,
            live_trading=config.live_trading,
        )
        self._baseline_close: Dict[str, float] = {}
        self._token_to_index: Dict[int, str] = {}
        self._lock = threading.Lock()
        self._firing: Set[str] = set()
        self.active_indexes: List[str] = []
        # Calendar-expiry indexes for today (empty on Mon/Wed/Fri when expiry_only)
        self._calendar_indexes: Set[str] = set()
        # Last seen LTP per index — detect real price moves during CAS window
        self._last_ltp_seen: Dict[str, float] = {}
        # LTP locked before / at start of move window — compare against this
        self._pre_move_ltp: Dict[str, float] = {}
        self._refresh_window_bounds()

    def _refresh_window_bounds(self) -> None:
        self._win_start_sec = _time_to_day_seconds(self.config.watch_start)
        self._win_end_sec = _time_to_day_seconds(self.config.watch_end)
        move_start = getattr(self.config, "move_window_start", None) or self.config.watch_start
        move_end = getattr(self.config, "move_window_end", None)
        if move_end is None:
            from datetime import time as dtime

            move_end = dtime(15, 30, 0)
        self._move_start_sec = _time_to_day_seconds(move_start)
        self._move_end_sec = _time_to_day_seconds(move_end)
        self._min_move = float(getattr(self.config, "cas_move_min_points", 0.05) or 0.05)

    def _fire_source(self) -> str:
        return "live" if self.config.live_trading else "paper"

    def setup_for_today(self) -> List[str]:
        indexes = today_indexes(self.config)
        self.active_indexes = indexes
        self._token_to_index = {
            int(INDEX_META[i]["token"]): i for i in indexes
        }
        now = get_ist_now()
        self._calendar_indexes = set(indexes_for_date(now.date(), self.config))
        self._pre_move_ltp.clear()
        self._last_ltp_seen.clear()
        self._refresh_window_bounds()
        if not indexes:
            logger.info("Not an expiry day — strategy idle")
        elif not self._calendar_indexes and not self.config.live_trading:
            logger.info(
                "Paper non-expiry day — watching %s; fire only on CAS LTP move "
                "inside %s–%s (not at watch open)",
                indexes,
                getattr(self.config, "move_window_start", self.config.watch_start),
                getattr(self.config, "move_window_end", None),
            )
        return indexes

    def capture_baselines(self) -> None:
        """Load prev-session close into strategy (for CAS detect) + prewarm strikes.

        Uses historical daily close (not quote.ohlc.close). LTP still only via WS.
        """
        asof = get_ist_now().date()
        for index in self.active_indexes:
            token = int(INDEX_META[index]["token"])
            try:
                prev = self.client.previous_session_close(token, asof=asof)
            except Exception as exc:
                logger.warning("hist baseline %s failed: %s — trying quote", index, exc)
                key = INDEX_META[index]["spot_key"]
                q = self.client.quote([key])[key]
                prev = float(q.get("ohlc", {}).get("close") or 0)

            if prev:
                self._baseline_close[index] = prev
                self.store.set_baseline(index, prev)

            # Spot for strike prewarm only (one quote; not shown as streaming LTP)
            key = INDEX_META[index]["spot_key"]
            try:
                ltp = float(self.client.quote([key])[key].get("last_price") or 0)
            except Exception:
                ltp = 0.0
            logger.info("[%s] baseline close=%.2f (spot for prewarm=%.2f)", index, prev, ltp)
            spot = ltp or prev
            if spot > 0:
                try:
                    self.cache.prewarm(
                        self.client.kite,
                        index,
                        spot,
                        self.config.ce_otm_steps,
                        self.config.pe_otm_steps,
                    )
                except Exception as exc:
                    logger.warning("prewarm %s failed: %s", index, exc)

    def _allow_cas_ltp_move(self) -> bool:
        """Move-window LTP fire: live expiry always; paper when probe/move enabled."""
        if not getattr(self.config, "fire_on_cas_move", True):
            return False
        if self.config.live_trading:
            return True
        # Paper: rehearsal on any day (incl. non-expiry) when probe/move is on
        return bool(
            getattr(self.config, "paper_latency_probe", True)
            or getattr(self.config, "fire_on_cas_move", True)
        )

    def on_ticks(self, ticks: List[dict]) -> None:
        """KiteTicker push callback — fire on CAS move / close flip, not clock open."""
        if not self.store.is_activated():
            return
        # Cheap IST window checks (no datetime objects on the hot path)
        now_sec = _ist_day_seconds()
        in_cas = self._win_start_sec <= now_sec <= self._win_end_sec
        in_move = self._move_start_sec <= now_sec <= self._move_end_sec
        allow_move = self._allow_cas_ltp_move()
        source = self._fire_source()
        token_map = self._token_to_index
        min_move = self._min_move

        for tick in ticks:
            token = int(tick.get("instrument_token") or 0)
            index = token_map.get(token)
            if not index:
                continue

            ltp = float(tick.get("last_price") or 0)
            if ltp:
                prev_ltp = self._last_ltp_seen.get(index)
                self.store.set_ltp(index, ltp)
                # Track last price move during the full CAS watch window (UI).
                if in_cas and (prev_ltp is None or abs(ltp - prev_ltp) > 1e-9):
                    self.store.note_index_move(index, _tick_move_iso(tick))
                self._last_ltp_seen[index] = ltp

                # Before the auction move window: keep refreshing pre-move ref.
                # At/after move window start the ref is frozen so the sudden
                # print is measurable (15:27 open alone must never fire).
                if in_cas and not in_move:
                    self._pre_move_ltp[index] = ltp
                elif in_move and index not in self._pre_move_ltp:
                    # Activated late into the move window — lock first tick as ref
                    self._pre_move_ltp[index] = ltp

            if index in self._firing or self.store.has_fired(index):
                continue

            ohlc = tick.get("ohlc") or {}
            ohlc_close = float(ohlc.get("close") or 0)
            baseline = self._baseline_close.get(index)

            trigger = None
            close_px = None

            # 1) Live primary: day's ohlc.close flipped from prev-day baseline
            if (
                self.config.fire_on_close_update
                and in_cas
                and baseline
                and ohlc_close
                and abs(ohlc_close - baseline) > 1e-6
            ):
                trigger = "ws_ohlc_close"
                close_px = ohlc_close
            # 2) Sudden LTP move inside 15:28–15:30 vs pre-move reference
            elif (
                allow_move
                and in_move
                and ltp > 0
                and index in self._pre_move_ltp
                and abs(ltp - self._pre_move_ltp[index]) >= min_move
            ):
                trigger = "cas_ltp_move"
                close_px = ltp  # moved print = ATM for strike resolve
            elif self.config.fire_on_ltp_in_window and in_cas and ltp > 0:
                # Explicit opt-in only — still not used at bare watch open by default
                trigger = "ws_ltp_window"
                close_px = ltp
            elif tick.get("cas_close") and ltp > 0:
                trigger = "ws_replay_cas"
                close_px = float((tick.get("ohlc") or {}).get("close") or ltp)

            if trigger and close_px:
                # Claim synchronously so concurrent ticks cannot double-fire,
                # then sell off the ticker thread so the socket stays free.
                with self._lock:
                    if index in self._firing or self.store.has_fired(index):
                        continue
                    self._firing.add(index)
                threading.Thread(
                    target=self._fire_claimed,
                    args=(index, float(close_px), trigger, source),
                    name=f"cas-fire-{index}",
                    daemon=True,
                ).start()

    def _fire_claimed(
        self,
        index: str,
        close_price: float,
        trigger: str,
        source: str = "live",
    ) -> list:
        """Fire path after index is already claimed in ``_firing``."""
        self.orders.lots = self.config.lots
        self.orders.product = self.config.product
        self.orders.live_trading = self.config.live_trading

        # Stamp detect the instant we decided to sell (WS tick arrival)
        timing = new_detect_event(index, close_price, trigger, source=source)
        timing.dry_run = not self.config.live_trading
        t0 = time.perf_counter()
        mode = "LIVE" if self.config.live_trading else "PAPER/DRY"
        logger.info(
            "CAS DETECTED %s close=%.2f at %s trigger=%s mode=%s → MARKET SELL both legs NOW",
            index,
            close_price,
            timing.cas_detected_at,
            trigger,
            mode,
        )
        try:
            legs = self.cache.resolve(
                self.client.kite,
                index,
                close_price,
                self.config.ce_otm_steps,
                self.config.pe_otm_steps,
            )
            fills, timing = self.orders.sell_otm(
                legs, close_price, trigger, t0, timing=timing
            )
            self.store.mark_fired(index, close_price, fills, timing=timing)
            logger.info(
                "FIRE done %s detect→done=%sms CE=%sms PE=%sms live=%s source=%s",
                index,
                timing.detect_to_done_ms if timing else "?",
                timing.detect_to_ce_ms if timing else "?",
                timing.detect_to_pe_ms if timing else "?",
                self.config.live_trading,
                source,
            )
            return fills
        except Exception as exc:
            logger.exception("Fire failed for %s", index)
            self.store.set_error(f"{index}: {exc}")
            with self._lock:
                self._firing.discard(index)
            return []

    def _fire(
        self,
        index: str,
        close_price: float,
        trigger: str,
        source: str = "live",
    ) -> list:
        """CAS detect → cached strikes → parallel MARKET SELL CE+PE."""
        with self._lock:
            if index in self._firing or self.store.has_fired(index):
                return []
            self._firing.add(index)
        return self._fire_claimed(index, close_price, trigger, source=source)

    def manual_fire(self, index: str, close_price: float) -> list:
        return self._fire(
            index,
            close_price,
            "manual",
            source="manual" if self.config.live_trading else "paper",
        )
