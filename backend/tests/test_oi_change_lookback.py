from datetime import datetime, timedelta, timezone

from oi_change_lookback import lookback_floor, pick_baseline_ts

IST = timezone(timedelta(hours=5, minutes=30))


def test_fifteen_min_picks_tick_from_fifteen_min_ago_not_last_four():
    current = datetime(2026, 8, 19, 10, 30, tzinfo=IST)
    session_open = datetime(2026, 8, 19, 9, 15, tzinfo=IST)
    old = current - timedelta(minutes=16)
    recent = current - timedelta(minutes=4)
    picked = pick_baseline_ts([old, recent], current, 15, session_open)
    assert picked == old
    floor = lookback_floor(current, 15, session_open)
    assert floor == current - timedelta(minutes=15)


def test_window_slides_with_current_time():
    session_open = datetime(2026, 8, 19, 9, 15, tzinfo=IST)
    t0 = datetime(2026, 8, 19, 10, 29, 45, tzinfo=IST)
    t1 = datetime(2026, 8, 19, 10, 30, 0, tzinfo=IST)
    ticks = [t0 - timedelta(minutes=15), t0, t1 - timedelta(minutes=15), t1]
    a = pick_baseline_ts(ticks, t0, 15, session_open)
    b = pick_baseline_ts(ticks, t1, 15, session_open)
    assert a == t0 - timedelta(minutes=15)
    assert b == t1 - timedelta(minutes=15)


def test_before_full_window_uses_session_open():
    current = datetime(2026, 8, 19, 9, 20, tzinfo=IST)
    session_open = datetime(2026, 8, 19, 9, 15, tzinfo=IST)
    floor = lookback_floor(current, 15, session_open)
    assert floor == session_open
