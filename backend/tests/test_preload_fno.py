import asyncio
from oi_tracker import OITracker


class _NoDb:
    pass


def test_preload_fno_noop_without_kite():
    t = OITracker(_NoDb())
    assert t.mode == "offline"
    assert asyncio.run(t.preload_fno_dump(force=True)) == 0
    t.schedule_fno_preload(force=True)
