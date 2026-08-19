"""Admin poll intervals from settings (_id: alerts). No env / secret caps."""

OI_POLL_DEFAULT_SECONDS = 15
STRADDLE_POLL_DEFAULT_SECONDS = 15
POSITIONS_POLL_DEFAULT_SECONDS = 30

STRADDLE_POLL_MIN_SECONDS = 5
STRADDLE_POLL_MAX_SECONDS = 120  # form: 15 / 30 / 60 / 120
OI_POLL_MIN_SECONDS = 1
OI_POLL_MAX_SECONDS = 60  # form: 15 / 30 / 60
POSITIONS_POLL_MIN_SECONDS = 5
POSITIONS_POLL_MAX_SECONDS = 3600

POLL_FIELD_KEYS = (
    "oi_poll_interval_seconds",
    "straddle_poll_interval_seconds",
    "positions_poll_interval_seconds",
)


def apply_poll_fields_from_doc(settings, doc):
    """Copy poll seconds from the Mongo settings doc onto tracker.settings."""
    if not isinstance(settings, dict) or not isinstance(doc, dict):
        return settings
    for key in POLL_FIELD_KEYS:
        raw = doc.get(key)
        if raw is None or raw == "":
            continue
        try:
            settings[key] = int(raw)
        except (TypeError, ValueError):
            pass
    return settings


def _int_or(src, key, default):
    try:
        return int(src.get(key, default))
    except (TypeError, ValueError):
        return int(default)


def clamp_oi_poll_seconds(settings=None, default=OI_POLL_DEFAULT_SECONDS) -> int:
    src = settings if isinstance(settings, dict) else {}
    raw = _int_or(src, "oi_poll_interval_seconds", default)
    return max(OI_POLL_MIN_SECONDS, min(OI_POLL_MAX_SECONDS, raw))


def clamp_straddle_poll_seconds(settings=None, default=STRADDLE_POLL_DEFAULT_SECONDS) -> int:
    src = settings if isinstance(settings, dict) else {}
    raw = _int_or(src, "straddle_poll_interval_seconds", default)
    return max(STRADDLE_POLL_MIN_SECONDS, min(STRADDLE_POLL_MAX_SECONDS, raw))


def clamp_positions_poll_seconds(settings=None, default=POSITIONS_POLL_DEFAULT_SECONDS) -> int:
    src = settings if isinstance(settings, dict) else {}
    raw = _int_or(src, "positions_poll_interval_seconds", default)
    return max(POSITIONS_POLL_MIN_SECONDS, min(POSITIONS_POLL_MAX_SECONDS, raw))
