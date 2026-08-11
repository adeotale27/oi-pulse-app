"""Kite / Zerodha maintenance detection helpers."""

from kite_maintenance import looks_like_maintenance, merge_maintenance, notice_from_error


def test_looks_like_maintenance_phrases():
    assert looks_like_maintenance("Kite is under maintenance until 10:00")
    assert looks_like_maintenance("503 Service Unavailable")
    assert looks_like_maintenance("No server is available to handle this request")
    assert not looks_like_maintenance("TokenException: Incorrect `api_key` or `access_token`.")


def test_notice_from_error():
    n = notice_from_error("NetworkException: under maintenance")
    assert n and n["active"] is True
    assert "maintenance" in n["message"].lower()
    assert notice_from_error("hello") is None


def test_merge_prefers_api_over_bulletin():
    bulletin = {
        "active": True,
        "message": "Bulletin: scheduled maintenance tonight",
        "source": "zerodha_bulletin",
    }
    out = merge_maintenance(None, api_error="503 Service Unavailable", bulletin=bulletin)
    assert out["source"] == "kite_api"
    out2 = merge_maintenance(None, bulletin=bulletin)
    assert out2["source"] == "zerodha_bulletin"
