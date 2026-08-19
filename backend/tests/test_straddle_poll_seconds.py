from poll_intervals import (
    clamp_straddle_poll_seconds,
    clamp_oi_poll_seconds,
    clamp_positions_poll_seconds,
    apply_poll_fields_from_doc,
)


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


def test_mongo_doc_overrides_in_memory_defaults():
    settings = {
        "oi_poll_interval_seconds": 15,
        "straddle_poll_interval_seconds": 15,
        "positions_poll_interval_seconds": 30,
    }
    apply_poll_fields_from_doc(settings, {
        "oi_poll_interval_seconds": 60,
        "straddle_poll_interval_seconds": 60,
        "positions_poll_interval_seconds": 45,
    })
    assert clamp_oi_poll_seconds(settings) == 60
    assert clamp_straddle_poll_seconds(settings) == 60
    assert clamp_positions_poll_seconds(settings) == 45
