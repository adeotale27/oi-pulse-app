"""Canonical product version and display name.

Name: repo-root ``APP_NAME`` (one line). Change that file to rename the desk.
Version: repo-root ``VERSION``.
"""
from pathlib import Path

_VERSION_FALLBACK = "6.45"
_NAME_FALLBACK = "StrikLenz"


def _first_line(filename: str, fallback: str) -> str:
    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent / filename,
        Path("/app") / filename,
        Path.cwd() / filename,
    ]
    for path in candidates:
        try:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text.splitlines()[0].strip()
        except Exception:
            continue
    return fallback


def load_app_version() -> str:
    return _first_line("VERSION", _VERSION_FALLBACK)


def load_app_name() -> str:
    return _first_line("APP_NAME", _NAME_FALLBACK)


APP_VERSION = load_app_version()
APP_VERSION_LABEL = f"V{APP_VERSION}"
APP_NAME = load_app_name()
