from oi_tracker import resolve_desk_ai


def test_unmigrated_keeps_guest_off():
    flags = resolve_desk_ai({"desk_ai_admin": True, "desk_ai_public": False})
    assert flags["desk_ai_admin"] is True
    assert flags["desk_ai_public"] is False
    assert flags["desk_ai_show"] is True


def test_header_switch_applies_to_both():
    flags = resolve_desk_ai({"desk_ai_show": True, "desk_ai_admin": False, "desk_ai_public": False})
    assert flags["desk_ai_admin"] is True
    assert flags["desk_ai_public"] is True
    flags_off = resolve_desk_ai({"desk_ai_show": False})
    assert flags_off["desk_ai_admin"] is False
    assert flags_off["desk_ai_public"] is False
