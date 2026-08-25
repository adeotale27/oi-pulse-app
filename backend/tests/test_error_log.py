from error_log import build_doc, fingerprint, redact


def test_redact_tokens():
    s = redact("X-Admin-Token: abcdef123456 Authorization: Bearer secret.jwt.value")
    assert "abcdef123456" not in s
    assert "secret.jwt.value" not in s
    assert "<redacted>" in s


def test_fingerprint_stable():
    a = fingerprint("api", "/api/oi/NIFTY", "ValueError", "bad atm")
    b = fingerprint("api", "/api/oi/NIFTY", "ValueError", "bad atm")
    assert a == b
    assert fingerprint("api", "/api/oi/NIFTY", "ValueError", "other") != a


def test_build_doc_caps_and_version():
    doc = build_doc(
        source="ui",
        message="x" * 5000,
        traceback_text="tb" * 10000,
        path="/desk",
        kind="TypeError",
    )
    assert len(doc["message"]) <= 2000
    assert len(doc["traceback"]) <= 8000
    assert doc["source"] == "ui"
    assert doc["kind"] == "TypeError"
    assert doc["fingerprint"]
    assert doc["app_version"]
