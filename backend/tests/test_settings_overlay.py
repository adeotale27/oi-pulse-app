DEFAULT_SETTINGS = {
    "oi_poll_interval_seconds": 15,
    "straddle_poll_interval_seconds": 15,
    "positions_poll_interval_seconds": 30,
    "threshold_pct": 15.0,
}

INT_KEYS = (
    "oi_poll_interval_seconds",
    "straddle_poll_interval_seconds",
    "positions_poll_interval_seconds",
)


def coerce_settings_types(settings):
    for key in INT_KEYS:
        raw = settings.get(key)
        if raw is None or raw == "":
            continue
        settings[key] = int(raw)
    if settings.get("threshold_pct") not in (None, ""):
        settings["threshold_pct"] = float(settings["threshold_pct"])
    return settings


def overlay_settings_doc(settings, doc):
    if doc:
        settings.update({k: v for k, v in doc.items() if k != "_id"})
    return coerce_settings_types(settings)


def test_coerce_poll_seconds_from_string_and_float():
    s = {
        "positions_poll_interval_seconds": "15",
        "oi_poll_interval_seconds": 30.0,
        "threshold_pct": "12.5",
    }
    coerce_settings_types(s)
    assert s["positions_poll_interval_seconds"] == 15
    assert s["oi_poll_interval_seconds"] == 30
    assert s["threshold_pct"] == 12.5


def test_overlay_db_doc_wins_over_defaults():
    settings = dict(DEFAULT_SETTINGS)
    overlay_settings_doc(settings, {
        "_id": "alerts",
        "positions_poll_interval_seconds": "15",
        "oi_poll_interval_seconds": 60,
    })
    assert settings["positions_poll_interval_seconds"] == 15
    assert settings["oi_poll_interval_seconds"] == 60
    assert settings["straddle_poll_interval_seconds"] == DEFAULT_SETTINGS["straddle_poll_interval_seconds"]
