"""Admin poll intervals. Clamp only to the SettingsModal range — never a tighter secret cap."""

STRADDLE_POLL_MIN_SECONDS = 5
STRADDLE_POLL_MAX_SECONDS = 120  # 15 / 30 / 60 / 120 on the form
STRADDLE_POLL_DEFAULT_SECONDS = 15


def clamp_straddle_poll_seconds(settings=None, default=STRADDLE_POLL_DEFAULT_SECONDS) -> int:
    """Seconds between ATM straddle samples from admin config."""
    src = settings if isinstance(settings, dict) else {}
    try:
        raw = int(src.get("straddle_poll_interval_seconds", default))
    except (TypeError, ValueError):
        raw = int(default)
    return max(STRADDLE_POLL_MIN_SECONDS, min(STRADDLE_POLL_MAX_SECONDS, raw))
