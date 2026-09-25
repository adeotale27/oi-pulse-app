"""Token updates trigger a fresh live snapshot instead of serving stale cache."""
import asyncio

from oi_tracker import OITracker


def test_schedule_live_refresh_polls_immediately_when_session_is_open():
    async def scenario():
        tracker = OITracker.__new__(OITracker)
        tracker.mode = "kite"
        tracker.kite_service = object()
        tracker._live_refresh_task = None
        calls = []

        async def instruments():
            calls.append("instruments")

        async def poll():
            calls.append("poll")

        tracker.oi_session_open = lambda: True
        tracker.ensure_instruments_fresh = instruments
        tracker._poll_once = poll

        tracker.schedule_live_refresh()
        await tracker._live_refresh_task

        assert calls == ["instruments", "poll"]

    asyncio.run(scenario())


def test_schedule_live_refresh_does_not_poll_closed_session():
    async def scenario():
        tracker = OITracker.__new__(OITracker)
        tracker.mode = "kite"
        tracker.kite_service = object()
        tracker._live_refresh_task = None
        calls = []

        async def poll():
            calls.append("poll")

        tracker.oi_session_open = lambda: False
        tracker._poll_once = poll

        tracker.schedule_live_refresh()
        await tracker._live_refresh_task

        assert calls == []

    asyncio.run(scenario())
