"""
Unit tests for Order Flow Analyzer detection algorithms.
"""
import pytest
from datetime import datetime, timezone, timedelta
from order_flow_analyzer import (
    OrderFlowAnalyzer,
    TickData,
    FlowSignalType,
    SignalSeverity,
    create_default_analyzer,
    format_oi,
)


@pytest.fixture
def analyzer():
    """Create analyzer with test configuration."""
    return create_default_analyzer({"NIFTY": 75, "SENSEX": 20, "BANKNIFTY": 35})


@pytest.fixture
def base_tick():
    """Create a base tick for testing."""
    now = datetime.now(timezone.utc)
    return TickData(
        index="NIFTY",
        strike=24000,
        side="CE",
        ts=now,
        oi=100000,
        volume=50000,
        ltp=150.0,
        prev_oi=50000,
        prev_volume=10000,
        prev_ltp=140.0,
    )


class TestIcebergDetection:
    """Tests for iceberg order detection."""

    def test_iceberg_detected_large_oi_small_volume(self, analyzer):
        """Large OI change with disproportionately small volume should trigger iceberg."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=100000,
            volume=5000,
            ltp=150.0,
            prev_oi=50000,
            prev_volume=1000,
            prev_ltp=140.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        iceberg_signals = [s for s in signals if s.signal_type == FlowSignalType.ICEBERG]
        assert len(iceberg_signals) == 1
        assert iceberg_signals[0].severity in (SignalSeverity.WARNING, SignalSeverity.INFO)
        assert iceberg_signals[0].oi_to_volume_ratio <= 0.15
        assert "Iceberg" in iceberg_signals[0].message

    def test_no_iceberg_when_volume_matches_oi(self, analyzer):
        """Volume proportional to OI change should NOT trigger iceberg."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=100000,
            volume=45000,
            ltp=150.0,
            prev_oi=50000,
            prev_volume=5000,
            prev_ltp=140.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        iceberg_signals = [s for s in signals if s.signal_type == FlowSignalType.ICEBERG]
        assert len(iceberg_signals) == 0

    def test_iceberg_pe_side(self, analyzer):
        """Iceberg detection should work for PE side too."""
        tick = TickData(
            index="NIFTY",
            strike=23800,
            side="PE",
            ts=datetime.now(timezone.utc),
            oi=80000,
            volume=3000,
            ltp=120.0,
            prev_oi=30000,
            prev_volume=500,
            prev_ltp=115.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        iceberg_signals = [s for s in signals if s.signal_type == FlowSignalType.ICEBERG]
        assert len(iceberg_signals) == 1
        assert iceberg_signals[0].side == "PE"
        assert iceberg_signals[0].strike == 23800


class TestBlockTradeDetection:
    """Tests for block trade detection."""

    def test_block_trade_detected_high_notional(self, analyzer):
        """Single print with notional > threshold should trigger block trade."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=200000,
            volume=150000,
            ltp=200.0,
            prev_oi=50000,
            prev_volume=5000,
            prev_ltp=190.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        block_signals = [s for s in signals if s.signal_type == FlowSignalType.BLOCK_TRADE]
        assert len(block_signals) == 1
        assert block_signals[0].severity in (SignalSeverity.WARNING, SignalSeverity.CRITICAL)
        assert block_signals[0].notional_cr >= 5.0
        assert "BLOCK" in block_signals[0].message

    def test_no_block_trade_below_threshold(self, analyzer):
        """Notional below threshold should NOT trigger block trade."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=100000,
            volume=80000,
            ltp=50.0,
            prev_oi=50000,
            prev_volume=10000,
            prev_ltp=45.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        block_signals = [s for s in signals if s.signal_type == FlowSignalType.BLOCK_TRADE]
        assert len(block_signals) == 0


class TestSweepDetection:
    """Tests for sweep order detection."""

    def test_sweep_detected_multiple_strikes(self, analyzer):
        """Multiple consecutive strikes with OI changes in same direction within time window."""
        now = datetime.now(timezone.utc)
        
        for strike in [23900, 24000, 24100]:
            tick = TickData(
                index="NIFTY",
                strike=strike,
                side="CE",
                ts=now,
                oi=100000,
                volume=80000,
                ltp=150.0,
                prev_oi=50000,
                prev_volume=10000,
                prev_ltp=140.0,
            )
            analyzer.analyze_tick(tick, 24000)

        signals = analyzer.analyze_tick(
            TickData(
                index="NIFTY",
                strike=24200,
                side="CE",
                ts=now + timedelta(seconds=30),
                oi=100000,
                volume=80000,
                ltp=150.0,
                prev_oi=50000,
                prev_volume=10000,
                prev_ltp=140.0,
            ),
            24000
        )

        sweep_signals = [s for s in signals if s.signal_type == FlowSignalType.SWEEP]
        assert len(sweep_signals) == 1
        assert len(sweep_signals[0].related_strikes) >= 3
        assert "SWEEP" in sweep_signals[0].message

    def test_no_sweep_insufficient_strikes(self, analyzer):
        """Less than minimum strikes should NOT trigger sweep."""
        now = datetime.now(timezone.utc)
        
        for strike in [23900, 24000]:
            tick = TickData(
                index="NIFTY",
                strike=strike,
                side="CE",
                ts=now,
                oi=100000,
                volume=80000,
                ltp=150.0,
                prev_oi=50000,
                prev_volume=10000,
                prev_ltp=140.0,
            )
            analyzer.analyze_tick(tick, 24000)

        signals = analyzer.analyze_tick(
            TickData(
                index="NIFTY",
                strike=24100,
                side="CE",
                ts=now + timedelta(seconds=30),
                oi=100000,
                volume=80000,
                ltp=150.0,
                prev_oi=50000,
                prev_volume=10000,
                prev_ltp=140.0,
            ),
            24000
        )

        sweep_signals = [s for s in signals if s.signal_type == FlowSignalType.SWEEP]
        assert len(sweep_signals) == 0


class TestDeltaNeutralDetection:
    """Tests for delta-neutral positioning detection."""

    def test_delta_neutral_straddle_writing(self, analyzer):
        """Both CE and PE OI rising at same strike should trigger delta-neutral."""
        now = datetime.now(timezone.utc)
        
        ce_tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=now,
            oi=100000,
            volume=80000,
            ltp=150.0,
            prev_oi=50000,
            prev_volume=10000,
            prev_ltp=140.0,
        )
        
        pe_tick = TickData(
            index="NIFTY",
            strike=24000,
            side="PE",
            ts=now,
            oi=90000,
            volume=70000,
            ltp=140.0,
            prev_oi=40000,
            prev_volume=8000,
            prev_ltp=130.0,
        )

        signals = analyzer.analyze_strike_pair(ce_tick, pe_tick, 24000)

        dn_signals = [s for s in signals if s.signal_type == FlowSignalType.DELTA_NEUTRAL]
        assert len(dn_signals) == 1
        assert dn_signals[0].details["type"] == "straddle_writing"
        assert "DELTA-NEUTRAL" in dn_signals[0].message
        assert dn_signals[0].side == "BOTH"

    def test_delta_neutral_straddle_buying(self, analyzer):
        """Both CE and PE OI falling at same strike should trigger delta-neutral (buying)."""
        now = datetime.now(timezone.utc)
        
        ce_tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=now,
            oi=50000,
            volume=30000,
            ltp=150.0,
            prev_oi=100000,
            prev_volume=10000,
            prev_ltp=140.0,
        )
        
        pe_tick = TickData(
            index="NIFTY",
            strike=24000,
            side="PE",
            ts=now,
            oi=40000,
            volume=25000,
            ltp=140.0,
            prev_oi=90000,
            prev_volume=8000,
            prev_ltp=130.0,
        )

        signals = analyzer.analyze_strike_pair(ce_tick, pe_tick, 24000)

        dn_signals = [s for s in signals if s.signal_type == FlowSignalType.DELTA_NEUTRAL]
        assert len(dn_signals) == 1
        assert dn_signals[0].details["type"] == "straddle_buying"


class TestTrappedWritersDetection:
    """Tests for trapped writers detection."""

    def test_trapped_ce_writers_price_rising(self, analyzer):
        """CE writers trapped when OI rises but spot price rises."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=150000,
            volume=50000,
            ltp=180.0,
            prev_oi=50000,
            prev_volume=10000,
            prev_ltp=120.0,
        )

        signals = analyzer.analyze_tick(tick, 24100)

        trapped_signals = [s for s in signals if s.signal_type == FlowSignalType.TRAPPED_WRITERS]
        assert len(trapped_signals) == 1
        assert "TRAPPED" in trapped_signals[0].message
        assert trapped_signals[0].side == "CE"

    def test_trapped_pe_writers_price_falling(self, analyzer):
        """PE writers trapped when OI rises but spot price falls."""
        tick = TickData(
            index="NIFTY",
            strike=23800,
            side="PE",
            ts=datetime.now(timezone.utc),
            oi=150000,
            volume=50000,
            ltp=180.0,
            prev_oi=50000,
            prev_volume=10000,
            prev_ltp=120.0,
        )

        signals = analyzer.analyze_tick(tick, 23700)

        trapped_signals = [s for s in signals if s.signal_type == FlowSignalType.TRAPPED_WRITERS]
        assert len(trapped_signals) == 1
        assert trapped_signals[0].side == "PE"

    def test_aggressive_build_ce_price_falling(self, analyzer):
        """CE aggressive build when OI rises and price falls (buyers accumulating)."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=150000,
            volume=50000,
            ltp=120.0,
            prev_oi=50000,
            prev_volume=10000,
            prev_ltp=180.0,
        )

        signals = analyzer.analyze_tick(tick, 23900)

        agg_signals = [s for s in signals if s.signal_type == FlowSignalType.AGGRESSIVE_BUILD]
        assert len(agg_signals) == 1
        assert "AGGRESSIVE" in agg_signals[0].message


class TestFormatOI:
    """Tests for OI formatting utility."""

    def test_format_oi_crores(self):
        assert format_oi(15000000) == "+1.5Cr"
        assert format_oi(-20000000) == "-2.0Cr"

    def test_format_oi_lakhs(self):
        assert format_oi(500000) == "+5.0L"
        assert format_oi(-750000) == "-7.5L"

    def test_format_oi_thousands(self):
        assert format_oi(5000) == "+5.0K"
        assert format_oi(-2500) == "-2.5K"

    def test_format_oi_small(self):
        assert format_oi(500) == "+500"
        assert format_oi(0) == "0"


class TestAnalyzerConfiguration:
    """Tests for analyzer configuration."""

    def test_custom_thresholds(self):
        """Custom thresholds should be respected."""
        custom_analyzer = OrderFlowAnalyzer(
            lot_sizes={"NIFTY": 75},
            iceberg_oi_threshold=100000,
            iceberg_volume_ratio=0.1,
            block_threshold_cr=10.0,
        )
        
        assert custom_analyzer.iceberg_oi_threshold == 100000
        assert custom_analyzer.iceberg_volume_ratio == 0.1
        assert custom_analyzer.block_threshold_cr == 10.0

    def test_different_indices_lot_sizes(self, analyzer):
        """Different indices should use correct lot sizes."""
        assert analyzer._get_lot_size("NIFTY") == 75
        assert analyzer._get_lot_size("SENSEX") == 20
        assert analyzer._get_lot_size("BANKNIFTY") == 35
        assert analyzer._get_lot_size("UNKNOWN") == 75  # default


class TestSignalStructure:
    """Tests for signal data structure completeness."""

    def test_signal_has_all_required_fields(self, analyzer):
        """All signals should have required fields populated."""
        tick = TickData(
            index="NIFTY",
            strike=24000,
            side="CE",
            ts=datetime.now(timezone.utc),
            oi=200000,
            volume=150000,
            ltp=200.0,
            prev_oi=50000,
            prev_volume=5000,
            prev_ltp=190.0,
        )

        signals = analyzer.analyze_tick(tick, 24000)

        for sig in signals:
            assert sig.signal_type is not None
            assert sig.severity is not None
            assert sig.index == "NIFTY"
            assert sig.strike == 24000
            assert sig.side in ("CE", "PE", "BOTH")
            assert sig.timestamp is not None
            assert sig.message is not None
            assert isinstance(sig.details, dict)
            assert sig.notional_cr >= 0
            assert sig.confidence >= 0 and sig.confidence <= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])