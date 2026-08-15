from desk_outside import (
    is_material_move,
    parse_rss_items,
    score_mover,
    seller_note,
    _as_quote,
    _flags,
    _priority,
    _briefing_text,
    focus_is_mcx,
)


def test_parse_rss_items():
    xml = """<?xml version="1.0"?><rss><channel>
    <item><title>RBI keeps repo unchanged</title><source>ET</source></item>
    <item><title>Reliance slips 2% on margin miss</title></item>
    </channel></rss>"""
    items = parse_rss_items(xml)
    assert items[0]["title"].startswith("RBI")
    assert "Reliance" in items[1]["title"]


def test_material_heavyweight():
    assert is_material_move(9.0, -1.0) is True
    assert is_material_move(0.4, 0.3) is False
    assert score_mover(9, -2) > score_mover(1, -2)
    note = seller_note(-2.0, 9.0)
    assert "PE" in note or "put" in note.lower() or "dump" in note.lower()


def test_quote_dict_and_tuple_compat():
    q = _as_quote({"last": 100.0, "prev": 98.0, "pct": 2.04})
    assert q["last"] == 100.0
    t = _as_quote((2500.0, 2400.0))
    assert t["last"] == 2500.0
    assert t["pct"] == 4.17


def test_flags_and_priority():
    flags = _flags({"last": 100, "high": 100, "low": 90, "vwap": 98, "open": 99, "prev": 98, "pct": 2.0})
    assert "day high" in flags
    assert "above VWAP" in flags
    assert _priority(30, flags, 2.0) in ("CRITICAL", "HIGH")
    assert _priority(0.2, [], 0.1) == "LOW"


def test_briefing_does_not_ask_upload_when_constituents_exist():
    msg = _briefing_text([], heavies=[{"symbol": "RELIANCE"}], quotes={}, news=[], source="none")
    assert "on file" in msg.lower()
    assert "Admin → Upload" not in msg
    quiet = _briefing_text([], heavies=[{"symbol": "RELIANCE"}], quotes={"RELIANCE": {"last": 1}}, news=[], source="kite")
    assert "loaded" in quiet.lower()
    assert "Admin → Upload" not in quiet


def test_focus_is_mcx_only_when_that_name_is_on():
    from oi_service import merge_index_config
    try:
        merge_index_config({
            "GOLD": {
                "quote_symbol": "MCX:GOLD26AUGFUT",
                "segment": "MCX-OPT",
                "quote_kind": "mcx_fut",
                "step": 100,
            }
        })
        assert focus_is_mcx("GOLD") is True
        assert focus_is_mcx("NIFTY") is False
        assert focus_is_mcx("") is False
        assert focus_is_mcx("FINNIFTY") is False
    finally:
        merge_index_config({})
