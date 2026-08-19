from oi_lookup import prefer_newer_snapshot, snapshot_ts


def test_prefer_newer_snapshot_picks_later_mongo_tick():
    memory = {"timestamp": "2026-08-19T04:08:32+00:00", "strikes": [{"ce_oi": 1}]}
    db_doc = {"timestamp": "2026-08-19T04:09:02+00:00", "strikes": [{"ce_oi": 99}]}
    out = prefer_newer_snapshot(memory, db_doc)
    assert out["strikes"][0]["ce_oi"] == 99
    assert snapshot_ts(out) == db_doc["timestamp"]


def test_prefer_newer_snapshot_keeps_memory_if_newer():
    memory = {"timestamp": "2026-08-19T04:10:00+00:00"}
    db_doc = {"timestamp": "2026-08-19T04:09:00+00:00"}
    assert prefer_newer_snapshot(memory, db_doc) is memory


def test_prefer_newer_snapshot_handles_missing():
    doc = {"timestamp": "2026-08-19T04:09:00+00:00"}
    assert prefer_newer_snapshot(None, doc) is doc
    assert prefer_newer_snapshot(doc, None) is doc
    assert prefer_newer_snapshot(None, None) is None
