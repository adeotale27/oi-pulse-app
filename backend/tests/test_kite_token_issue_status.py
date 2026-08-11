# kite_token_issue must mean dead token, not merely missing credentials.
# Mirrors OITracker.get_status token_bad / kite_token_issue rules.

def compute_kite_flags(*, kite_service, mode, last_error):
    err = (last_error or "").lower()
    token_bad = bool(
        kite_service
        and any(
            k in err
            for k in (
                "tokenexception",
                "invalid token",
                "access_token",
                "incorrect `api_key`",
                "incorrect api_key",
                "unauthorized",
                "forbidden",
                "signature mismatch",
            )
        )
    )
    has_kite_credentials = kite_service is not None
    kite_ok = mode == "kite" and kite_service is not None and not token_bad
    kite_token_issue = bool(token_bad)
    return {
        "has_kite_credentials": has_kite_credentials,
        "kite_ok": kite_ok,
        "kite_token_issue": kite_token_issue,
    }


def test_missing_creds_is_not_token_issue():
    s = compute_kite_flags(kite_service=None, mode="offline", last_error=None)
    assert s["has_kite_credentials"] is False
    assert s["kite_token_issue"] is False
    assert s["kite_ok"] is False


def test_tokenexception_is_token_issue():
    s = compute_kite_flags(
        kite_service=object(),
        mode="kite",
        last_error="TokenException: Incorrect 'api_key' or 'access_token'.",
    )
    assert s["has_kite_credentials"] is True
    assert s["kite_token_issue"] is True
    assert s["kite_ok"] is False


def test_healthy_session():
    s = compute_kite_flags(kite_service=object(), mode="kite", last_error=None)
    assert s["kite_token_issue"] is False
    assert s["kite_ok"] is True
