from guest_access import require_approval_flag


def test_require_approval_defaults_on():
    assert require_approval_flag(None) is True
    assert require_approval_flag({}) is True
    assert require_approval_flag({"open": True}) is True


def test_require_approval_explicit():
    assert require_approval_flag({"require_approval": True}) is True
    assert require_approval_flag({"require_approval": False}) is False
    assert require_approval_flag({"require_approval": 0}) is False
    assert require_approval_flag({"require_approval": 1}) is True
