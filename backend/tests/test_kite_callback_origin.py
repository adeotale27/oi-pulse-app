from types import SimpleNamespace

from kite_callback_origin import CANONICAL_APP_ORIGIN, is_legacy_app_host, kite_spa_origin


class _Headers(dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _req(**headers):
    return SimpleNamespace(headers=_Headers(headers), url=SimpleNamespace(scheme="https"))


def test_legacy_host_is_detected():
    assert is_legacy_app_host("aaisnamkeen.com")
    assert is_legacy_app_host("www.aaisnamkeen.com")
    assert not is_legacy_app_host("striklenz.com")


def test_live_host_wins():
    req = _req(host="striklenz.com")
    assert kite_spa_origin(req, env_get=lambda k: "https://aaisnamkeen.com") == "https://striklenz.com"


def test_stale_env_falls_back_to_canonical():
    req = _req(host="aaisnamkeen.com")
    env = {"FRONTEND_URL": "https://aaisnamkeen.com"}
    assert kite_spa_origin(req, env_get=env.get) == CANONICAL_APP_ORIGIN


def test_forwarded_host():
    req = _req(**{"x-forwarded-host": "striklenz.com, localhost", "x-forwarded-proto": "https"})
    assert kite_spa_origin(req, env_get=lambda k: None) == "https://striklenz.com"
