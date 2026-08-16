from pathlib import Path

from app_version import load_app_name, load_app_version, APP_NAME, APP_VERSION


def test_app_name_comes_from_repo_root_file():
    root = Path(__file__).resolve().parents[2]
    expected = (root / "APP_NAME").read_text(encoding="utf-8").strip().splitlines()[0].strip()
    assert expected == "StrikLenz"
    assert load_app_name() == expected
    assert APP_NAME == expected
    assert expected


def test_app_version_file_still_loads():
    root = Path(__file__).resolve().parents[2]
    expected = (root / "VERSION").read_text(encoding="utf-8").strip().splitlines()[0].strip()
    assert load_app_version() == expected
    assert APP_VERSION == expected
