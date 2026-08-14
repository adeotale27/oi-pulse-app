from desk_guide import compact_snapshot, compose_rules_guide, llm_configured, reset_cache, status


def test_compact_strips_noise_and_caps_lists():
    snap = compact_snapshot({
        "why": ["a" * 400, "ok"],
        "whyNot": ["gap"],
        "results": [{"name": "MAXHEALTH", "date": "2026-08-14", "token": "SECRET"}] * 20,
        "book": {"openCount": 2, "shortCount": 2, "byIndex": {"NIFTY": {"ce": 1, "pe": 1, "n": 2}}},
        "vix": "11.4",
        "giftPct": "-0.12",
        "weekday": 5,
        "band": "REDUCE",
        "kite_access_token": "should-not-copy",
    })
    assert "kite_access_token" not in snap
    assert len(snap["why"][0]) <= 240
    assert len(snap["results"]) == 8
    assert snap["book"]["byIndex"]["NIFTY"]["pe"] == 1
    assert snap["vix"] == 11.4
    assert "SECRET" not in str(snap["results"])


def test_rules_guide_mentions_results():
    text = compose_rules_guide({
        "why": ["VIX calm"],
        "whyNot": ["Friday gap"],
        "results": [{"name": "MAXHEALTH · NIFTY"}],
    })
    assert "Why carry" in text
    assert "MAXHEALTH" in text


def test_status_without_key(monkeypatch):
    reset_cache()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DESK_GUIDE_API_KEY", raising=False)
    assert llm_configured() is False
    st = status()
    assert st["enabled"] is False
    assert st["source"] == "rules"
