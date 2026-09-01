"""CAS status must not re-hit public IP APIs on every poll when lookup failed."""

import cas_bridge


def test_egress_caches_failed_lookup(monkeypatch):
    cas_bridge._EGRESS_CACHE = {"ip": None, "at": 0.0, "error": None, "checked": False}
    calls = {"n": 0}

    def boom(*_a, **_k):
        calls["n"] += 1
        raise TimeoutError("ipify down")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    first = cas_bridge.detect_backend_egress_ip()
    n = calls["n"]
    assert n >= 1
    assert first.get("ip") is None
    second = cas_bridge.detect_backend_egress_ip()
    assert calls["n"] == n
    assert second.get("source") == "cache"
