"""
Smart Order Flow Analyzer - Institutional Footprint Detection

Detects from 1-minute bar data:
  - Iceberg orders (large OI change, small volume print)
  - Sweep orders (multiple strikes hit in < N seconds)
  - Block trades (single print > ₹X Cr premium notional)
  - Delta-neutral positioning (CE+PE OI rise together at same strike)

Outputs structured signals for API consumption and alerting.
"""
from __future__ import annotations
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any
from collections import defaultdict
from enum import Enum

logger = logging.getLogger(__name__)


class FlowSignalType(str, Enum):
    ICEBERG = "iceberg"
    SWEEP = "sweep"
    BLOCK_TRADE = "block_trade"
    DELTA_NEUTRAL = "delta_neutral"
    AGGRESSIVE_BUILD = "aggressive_build"
    TRAPPED_WRITERS = "trapped_writers"


class SignalSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class FlowSignal:
    """Structured flow signal for API/UI consumption."""
    signal_type: FlowSignalType
    severity: SignalSeverity
    index: str
    strike: int
    side: str  # "CE" or "PE"
    timestamp: datetime
    message: str
    details: Dict[str, Any]
    notional_cr: float = 0.0
    oi_change: int = 0
    volume: int = 0
    oi_to_volume_ratio: float = 0.0
    related_strikes: List[int] = field(default_factory=list)
    confidence: float = 0.0  # 0-1


@dataclass
class TickData:
    """Normalized 1-minute tick data for a single strike/side."""
    index: str
    strike: int
    side: str  # "CE" or "PE"
    ts: datetime
    oi: int
    volume: int
    ltp: float
    prev_oi: int = 0
    prev_volume: int = 0
    prev_ltp: float = 0.0


class OrderFlowAnalyzer:
    """
    Analyzes 1-minute option chain ticks for institutional footprints.
    
    Detection logic:
    - Iceberg: |ΔOI| > threshold AND volume < volume_threshold (large hidden orders)
    - Sweep: Multiple strikes with OI change > threshold within time_window seconds
    - Block: Single strike notional (|ΔOI| × LTP × lot) > block_threshold_cr
    - Delta-neutral: CE and PE OI both increase significantly at same strike
    - Aggressive build: OI rising + price moving in favor of that side
    - Trapped writers: OI rising + price moving against that side
    """
    
    def __init__(
        self,
        lot_sizes: Dict[str, int],
        iceberg_oi_threshold: int = 50000,      # min OI change for iceberg
        iceberg_volume_ratio: float = 0.15,     # volume/OI change ratio (lower = more hidden)
        sweep_time_window_sec: int = 60,        # seconds for sweep detection
        sweep_min_strikes: int = 3,             # min strikes for sweep
        sweep_oi_threshold: int = 20000,        # min OI change per strike
        block_threshold_cr: float = 5.0,        # ₹Cr notional for block trade
        delta_neutral_oi_threshold: int = 30000, # min OI change on both sides
        trapped_oi_threshold: int = 40000,      # min OI change for trapped writers
        trapped_price_move_pct: float = 0.3,    # % price move against writer
    ):
        self.lot_sizes = lot_sizes
        self.iceberg_oi_threshold = iceberg_oi_threshold
        self.iceberg_volume_ratio = iceberg_volume_ratio
        self.sweep_time_window_sec = sweep_time_window_sec
        self.sweep_min_strikes = sweep_min_strikes
        self.sweep_oi_threshold = sweep_oi_threshold
        self.block_threshold_cr = block_threshold_cr
        self.delta_neutral_oi_threshold = delta_neutral_oi_threshold
        self.trapped_oi_threshold = trapped_oi_threshold
        self.trapped_price_move_pct = trapped_price_move_pct
        
        # In-memory state for sweep detection
        self._recent_oi_changes: Dict[str, List[Dict]] = defaultdict(list)  # index -> list of {strike, side, ts, oi_change}
        
    def _get_lot_size(self, index: str) -> int:
        return self.lot_sizes.get(index, 75)
    
    def _calculate_notional_cr(self, oi_change: int, ltp: float, lot_size: int) -> float:
        """Calculate notional value in Crores."""
        return abs(oi_change) * ltp * lot_size / 1_00_00_000
    
    def _prune_old_sweep_data(self, index: str, current_ts: datetime):
        """Remove sweep data older than time window."""
        cutoff = current_ts - timedelta(seconds=self.sweep_time_window_sec)
        self._recent_oi_changes[index] = [
            x for x in self._recent_oi_changes[index]
            if x["ts"] >= cutoff
        ]
    
    def analyze_tick(self, tick: TickData, spot_price: float) -> List[FlowSignal]:
        """
        Analyze a single tick and return detected signals.
        Also updates internal state for sweep detection.
        """
        signals = []
        
        if tick.prev_oi == 0:
            return signals
            
        oi_change = tick.oi - tick.prev_oi
        volume_in_period = tick.volume - tick.prev_volume
        price_change_pct = ((tick.ltp - tick.prev_ltp) / tick.prev_ltp * 100) if tick.prev_ltp > 0 else 0
        abs_oi_change = abs(oi_change)
        lot_size = self._get_lot_size(tick.index)
        notional_cr = self._calculate_notional_cr(oi_change, tick.ltp, lot_size)
        
        # Skip if no meaningful OI change
        if abs_oi_change < min(self.iceberg_oi_threshold, self.sweep_oi_threshold, self.block_threshold_cr * 1_00_00_000 / (tick.ltp * lot_size) if tick.ltp > 0 else 0):
            # Still track for sweep detection if above sweep threshold
            if abs_oi_change >= self.sweep_oi_threshold:
                self._track_for_sweep(tick, oi_change)
            return signals
        
        # 1. ICEBERG DETECTION
        # Large OI change but disproportionately small volume
        if abs_oi_change >= self.iceberg_oi_threshold and volume_in_period > 0:
            oi_to_vol_ratio = volume_in_period / abs_oi_change
            if oi_to_vol_ratio <= self.iceberg_volume_ratio:
                severity = SignalSeverity.WARNING if oi_to_vol_ratio < 0.05 else SignalSeverity.INFO
                signals.append(FlowSignal(
                    signal_type=FlowSignalType.ICEBERG,
                    severity=severity,
                    index=tick.index,
                    strike=tick.strike,
                    side=tick.side,
                    timestamp=tick.ts,
                    message=f"{tick.index} {tick.strike} {tick.side}: {oi_to_vol_ratio:.1%} vol/OI ratio → Iceberg {'writer' if oi_change > 0 else 'buyer'} ({format_oi(abs_oi_change)} OI, {volume_in_period:,} vol)",
                    details={
                        "oi_change": oi_change,
                        "volume": volume_in_period,
                        "oi_to_volume_ratio": round(oi_to_vol_ratio, 3),
                        "ltp": tick.ltp,
                        "spot": spot_price,
                        "direction": "writing" if oi_change > 0 else "buying",
                    },
                    notional_cr=round(notional_cr, 2),
                    oi_change=oi_change,
                    volume=volume_in_period,
                    oi_to_volume_ratio=round(oi_to_vol_ratio, 3),
                    confidence=min(1.0, (1 - oi_to_vol_ratio) * 2),
                ))
        
        # 2. BLOCK TRADE DETECTION
        # Single print with high notional value
        if notional_cr >= self.block_threshold_cr and volume_in_period > 0:
            # Check if this looks like a single large print (volume ≈ OI change)
            vol_oi_ratio = volume_in_period / abs_oi_change if abs_oi_change > 0 else 0
            is_single_print = 0.8 <= vol_oi_ratio <= 1.2  # volume ≈ OI change
            
            severity = SignalSeverity.CRITICAL if notional_cr >= self.block_threshold_cr * 3 else SignalSeverity.WARNING
            signals.append(FlowSignal(
                signal_type=FlowSignalType.BLOCK_TRADE,
                severity=severity,
                index=tick.index,
                strike=tick.strike,
                side=tick.side,
                timestamp=tick.ts,
                message=f"🔴 BLOCK {tick.index} {tick.strike} {tick.side}: ₹{notional_cr:.1f}Cr {'written' if oi_change > 0 else 'bought'} in 1 min ({format_oi(abs_oi_change)} OI @ ₹{tick.ltp:.1f})",
                details={
                    "oi_change": oi_change,
                    "volume": volume_in_period,
                    "notional_cr": round(notional_cr, 2),
                    "ltp": tick.ltp,
                    "spot": spot_price,
                    "is_single_print": is_single_print,
                    "vol_oi_ratio": round(vol_oi_ratio, 2),
                    "direction": "writing" if oi_change > 0 else "buying",
                },
                notional_cr=round(notional_cr, 2),
                oi_change=oi_change,
                volume=volume_in_period,
                oi_to_volume_ratio=round(vol_oi_ratio, 3),
                confidence=0.9 if is_single_print else 0.6,
            ))
        
        # 3. DELTA-NEUTRAL POSITIONING
        # Will be checked when we have both CE and PE data for same strike
        # Handled separately in analyze_strike_pair()
        
        # 4. TRAPPED WRITERS / AGGRESSIVE BUILD
        # OI rising but price moving against the writer
        if oi_change > self.trapped_oi_threshold:
            # For CE writers: price rising = trapped (they're short calls, market going up)
            # For PE writers: price falling = trapped (they're short puts, market going down)
            is_ce = tick.side == "CE"
            is_trapped = (is_ce and price_change_pct > self.trapped_price_move_pct) or \
                         (not is_ce and price_change_pct < -self.trapped_price_move_pct)
            is_aggressive = (is_ce and price_change_pct < -self.trapped_price_move_pct) or \
                           (not is_ce and price_change_pct > self.trapped_price_move_pct)
            
            if is_trapped:
                signals.append(FlowSignal(
                    signal_type=FlowSignalType.TRAPPED_WRITERS,
                    severity=SignalSeverity.WARNING,
                    index=tick.index,
                    strike=tick.strike,
                    side=tick.side,
                    timestamp=tick.ts,
                    message=f"⚠️ TRAPPED {tick.index} {tick.strike} {tick.side} writers: +{format_oi(oi_change)} OI but spot {'↑' if is_ce else '↓'} {abs(price_change_pct):.2f}%",
                    details={
                        "oi_change": oi_change,
                        "volume": volume_in_period,
                        "price_change_pct": round(price_change_pct, 2),
                        "ltp": tick.ltp,
                        "spot": spot_price,
                        "notional_cr": round(notional_cr, 2),
                    },
                    notional_cr=round(notional_cr, 2),
                    oi_change=oi_change,
                    volume=volume_in_period,
                    confidence=0.75,
                ))
            elif is_aggressive:
                signals.append(FlowSignal(
                    signal_type=FlowSignalType.AGGRESSIVE_BUILD,
                    severity=SignalSeverity.INFO,
                    index=tick.index,
                    strike=tick.strike,
                    side=tick.side,
                    timestamp=tick.ts,
                    message=f"🎯 AGGRESSIVE {tick.index} {tick.strike} {tick.side} {'buying' if oi_change > 0 else 'selling'}: +{format_oi(oi_change)} OI with spot {'↓' if is_ce else '↑'} {abs(price_change_pct):.2f}%",
                    details={
                        "oi_change": oi_change,
                        "volume": volume_in_period,
                        "price_change_pct": round(price_change_pct, 2),
                        "ltp": tick.ltp,
                        "spot": spot_price,
                        "notional_cr": round(notional_cr, 2),
                    },
                    notional_cr=round(notional_cr, 2),
                    oi_change=oi_change,
                    volume=volume_in_period,
                    confidence=0.7,
                ))
        
        # Track for sweep detection
        if abs_oi_change >= self.sweep_oi_threshold:
            self._track_for_sweep(tick, oi_change)
            sweep_signals = self._check_sweep(tick.index, tick.ts)
            signals.extend(sweep_signals)
        
        return signals
    
    def _track_for_sweep(self, tick: TickData, oi_change: int):
        """Track OI changes for sweep detection."""
        self._recent_oi_changes[tick.index].append({
            "strike": tick.strike,
            "side": tick.side,
            "ts": tick.ts,
            "oi_change": oi_change,
            "ltp": tick.ltp,
        })
    
    def _check_sweep(self, index: str, current_ts: datetime) -> List[FlowSignal]:
        """Check for sweep patterns across strikes."""
        self._prune_old_sweep_data(index, current_ts)
        events = self._recent_oi_changes[index]
        
        if len(events) < self.sweep_min_strikes:
            return []
        
        # Group by side and check for consecutive strikes
        by_side = defaultdict(list)
        for e in events:
            by_side[e["side"]].append(e)
        
        signals = []
        for side, side_events in by_side.items():
            if len(side_events) < self.sweep_min_strikes:
                continue
            
            # Sort by strike
            side_events.sort(key=lambda x: x["strike"])
            
            # Find consecutive strikes with same direction OI change
            for i in range(len(side_events) - self.sweep_min_strikes + 1):
                window = side_events[i:i + self.sweep_min_strikes]
                strikes = [e["strike"] for e in window]
                oi_changes = [e["oi_change"] for e in window]
                
                # Check if strikes are consecutive (within 2 steps)
                step = 50 if index == "NIFTY" else 100
                is_consecutive = all(
                    abs(strikes[j+1] - strikes[j]) <= step * 2
                    for j in range(len(strikes) - 1)
                )
                
                # Check if all OI changes are in same direction (all positive or all negative)
                same_direction = all(c > 0 for c in oi_changes) or all(c < 0 for c in oi_changes)
                
                if is_consecutive and same_direction:
                    total_oi = sum(abs(c) for c in oi_changes)
                    avg_ltp = sum(e["ltp"] for e in window) / len(window)
                    lot_size = self._get_lot_size(index)
                    total_notional = total_oi * avg_ltp * lot_size / 1_00_00_000
                    
                    direction = "BUYING" if oi_changes[0] > 0 else "SELLING"
                    signals.append(FlowSignal(
                        signal_type=FlowSignalType.SWEEP,
                        severity=SignalSeverity.CRITICAL if total_notional >= self.block_threshold_cr * 2 else SignalSeverity.WARNING,
                        index=index,
                        strike=strikes[len(strikes)//2],  # middle strike
                        side=side,
                        timestamp=current_ts,
                        message=f"🌊 SWEEP {index} {side} {direction}: {len(strikes)} strikes {strikes[0]}–{strikes[-1]} in {self.sweep_time_window_sec}s → {format_oi(total_oi)} OI (₹{total_notional:.1f}Cr)",
                        details={
                            "strikes": strikes,
                            "oi_changes": oi_changes,
                            "total_oi_change": total_oi,
                            "total_notional_cr": round(total_notional, 2),
                            "time_window_sec": self.sweep_time_window_sec,
                            "direction": direction,
                            "avg_ltp": round(avg_ltp, 2),
                        },
                        notional_cr=round(total_notional, 2),
                        oi_change=total_oi,
                        volume=0,  # sweep spans multiple strikes
                        related_strikes=strikes,
                        confidence=0.85,
                    ))
                    # Don't double-detect overlapping sweeps
                    break
        
        return signals
    
    def analyze_strike_pair(self, ce_tick: TickData, pe_tick: TickData, spot_price: float) -> List[FlowSignal]:
        """Analyze CE+PE pair at same strike for delta-neutral positioning."""
        signals = []
        
        ce_oi_change = ce_tick.oi - ce_tick.prev_oi
        pe_oi_change = pe_tick.oi - pe_tick.prev_oi
        
        abs_ce = abs(ce_oi_change)
        abs_pe = abs(pe_oi_change)
        
        # Both sides building OI significantly
        if abs_ce >= self.delta_neutral_oi_threshold and abs_pe >= self.delta_neutral_oi_threshold:
            # Check if both are writing (OI increasing on both sides)
            both_writing = ce_oi_change > 0 and pe_oi_change > 0
            both_buying = ce_oi_change < 0 and pe_oi_change < 0
            
            if both_writing:
                lot_size = self._get_lot_size(ce_tick.index)
                ce_notional = self._calculate_notional_cr(ce_oi_change, ce_tick.ltp, lot_size)
                pe_notional = self._calculate_notional_cr(pe_oi_change, pe_tick.ltp, lot_size)
                total_notional = ce_notional + pe_notional
                
                signals.append(FlowSignal(
                    signal_type=FlowSignalType.DELTA_NEUTRAL,
                    severity=SignalSeverity.WARNING if total_notional >= self.block_threshold_cr else SignalSeverity.INFO,
                    index=ce_tick.index,
                    strike=ce_tick.strike,
                    side="BOTH",
                    timestamp=max(ce_tick.ts, pe_tick.ts),
                    message=f"⚖️ DELTA-NEUTRAL {ce_tick.index} {ce_tick.strike}: CE +{format_oi(ce_oi_change)} / PE +{format_oi(pe_oi_change)} OI → Straddle writing (₹{total_notional:.1f}Cr)",
                    details={
                        "ce_oi_change": ce_oi_change,
                        "pe_oi_change": pe_oi_change,
                        "ce_ltp": ce_tick.ltp,
                        "pe_ltp": pe_tick.ltp,
                        "ce_notional_cr": round(ce_notional, 2),
                        "pe_notional_cr": round(pe_notional, 2),
                        "total_notional_cr": round(total_notional, 2),
                        "spot": spot_price,
                        "type": "straddle_writing",
                    },
                    notional_cr=round(total_notional, 2),
                    oi_change=ce_oi_change + pe_oi_change,
                    volume=0,
                    confidence=0.8,
                ))
            elif both_buying:
                lot_size = self._get_lot_size(ce_tick.index)
                ce_notional = self._calculate_notional_cr(ce_oi_change, ce_tick.ltp, lot_size)
                pe_notional = self._calculate_notional_cr(pe_oi_change, pe_tick.ltp, lot_size)
                total_notional = ce_notional + pe_notional
                
                signals.append(FlowSignal(
                    signal_type=FlowSignalType.DELTA_NEUTRAL,
                    severity=SignalSeverity.INFO,
                    index=ce_tick.index,
                    strike=ce_tick.strike,
                    side="BOTH",
                    timestamp=max(ce_tick.ts, pe_tick.ts),
                    message=f"📈 DELTA-NEUTRAL {ce_tick.index} {ce_tick.strike}: CE {format_oi(ce_oi_change)} / PE {format_oi(pe_oi_change)} OI → Straddle buying (₹{total_notional:.1f}Cr)",
                    details={
                        "ce_oi_change": ce_oi_change,
                        "pe_oi_change": pe_oi_change,
                        "ce_ltp": ce_tick.ltp,
                        "pe_ltp": pe_tick.ltp,
                        "ce_notional_cr": round(ce_notional, 2),
                        "pe_notional_cr": round(pe_notional, 2),
                        "total_notional_cr": round(total_notional, 2),
                        "spot": spot_price,
                        "type": "straddle_buying",
                    },
                    notional_cr=round(total_notional, 2),
                    oi_change=ce_oi_change + pe_oi_change,
                    volume=0,
                    confidence=0.75,
                ))
        
        return signals


def format_oi(oi: int) -> str:
    """Format OI with adaptive units."""
    abs_oi = abs(oi)
    sign = "+" if oi > 0 else ("-" if oi < 0 else "")
    if abs_oi >= 1_00_00_000:
        return f"{sign}{abs_oi/1_00_00_000:.1f}Cr"
    if abs_oi >= 1_00_000:
        return f"{sign}{abs_oi/1_00_000:.1f}L"
    if abs_oi >= 1_000:
        return f"{sign}{abs_oi/1_000:.1f}K"
    return f"{sign}{abs_oi}"


# Default analyzer instance factory
def create_default_analyzer(lot_sizes: Dict[str, int]) -> OrderFlowAnalyzer:
    """Create analyzer with sensible defaults for NSE indices."""
    return OrderFlowAnalyzer(
        lot_sizes=lot_sizes,
        iceberg_oi_threshold=50_000,
        iceberg_volume_ratio=0.15,
        sweep_time_window_sec=60,
        sweep_min_strikes=3,
        sweep_oi_threshold=20_000,
        block_threshold_cr=5.0,
        delta_neutral_oi_threshold=30_000,
        trapped_oi_threshold=40_000,
        trapped_price_move_pct=0.3,
    )