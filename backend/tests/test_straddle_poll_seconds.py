from poll_intervals import clamp_straddle_poll_seconds


def test_admin_60s_is_not_capped_at_15_or_30():
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 60}) == 60
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 120}) == 120
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 15}) == 15
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 30}) == 30


def test_straddle_poll_clamp_range_only():
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 1}) == 5
    assert clamp_straddle_poll_seconds({"straddle_poll_interval_seconds": 999}) == 120
    assert clamp_straddle_poll_seconds({}) == 15
    assert clamp_straddle_poll_seconds(None) == 15
