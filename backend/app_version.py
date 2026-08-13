"""Canonical product version (keep in lockstep with repo-root VERSION)."""
from pathlib import Path

_FALLBACK = "5.10"


def load_app_version() -> str:
    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent / "VERSION",
        Path("/app/VERSION"),
        Path.cwd() / "VERSION",
    ]
    for path in candidates:
        try:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text.splitlines()[0].strip()
        except Exception:
            continue
    return _FALLBACK


APP_VERSION = load_app_version()
APP_VERSION_LABEL = f"V{APP_VERSION}"
APP_NAME = "OI Pulse"
