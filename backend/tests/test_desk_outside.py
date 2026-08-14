from desk_outside import is_material_move, parse_rss_items, score_mover, seller_note


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
