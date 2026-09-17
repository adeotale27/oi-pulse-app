from datetime import datetime, timezone

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


def test_unseen_filter_uses_created_at_not_ts_bump():
    from error_log import unseen_filter
    assert unseen_filter(None) == {}
    q = unseen_filter("2026-09-17T10:00:00+00:00")
    assert q["$or"][0]["created_at"]["$gt"] == "2026-09-17T10:00:00+00:00"
    assert "ts" in q["$or"][1]


def test_count_unseen_and_mark_seen_per_admin():
    import asyncio
    from error_log import count_unseen, mark_seen, PREFS_COL, COLLECTION

    class Col:
        def __init__(self, rows=None):
            self.rows = list(rows or [])
            self.docs = {}
        async def count_documents(self, q):
            if not q:
                return len(self.rows)
            since = q["$or"][0]["created_at"]["$gt"]
            n = 0
            for r in self.rows:
                created = r.get("created_at")
                if created and created > since:
                    n += 1
                elif not created and (r.get("ts") or "") > since:
                    n += 1
            return n
        async def update_one(self, q, upd, upsert=False):
            sid = q.get("_id")
            self.docs[sid] = {**(self.docs.get(sid) or {}), **(upd.get("$set") or {}), "_id": sid}

    class Db:
        def __init__(self):
            self.cols = {
                COLLECTION: Col([
                    {"id": "a", "created_at": "2026-09-17T09:00:00+00:00", "ts": "2026-09-17T11:00:00+00:00"},
                    {"id": "b", "created_at": "2026-09-17T10:05:00+00:00", "ts": "2026-09-17T10:05:00+00:00"},
                    {"id": "c", "created_at": "2026-09-17T10:07:00+00:00", "ts": "2026-09-17T10:07:00+00:00"},
                    {"id": "d", "created_at": "2026-09-17T10:08:00+00:00", "ts": "2026-09-17T10:08:00+00:00"},
                ]),
                PREFS_COL: Col(),
            }
        def __getitem__(self, k):
            return self.cols[k]

    db = Db()

    async def run():
        assert await count_unseen(db, None) == 4
        assert await count_unseen(db, "2026-09-17T10:00:00+00:00") == 3
        iso = await mark_seen(db, "Adeotale", when=datetime(2026, 9, 17, 10, 9, tzinfo=timezone.utc))
        assert db[PREFS_COL].docs["Adeotale"]["last_error_log_seen_at"] == iso
        assert await count_unseen(db, iso) == 0
        db[COLLECTION].rows.append({"id": "e", "created_at": "2026-09-17T10:10:00+00:00", "ts": "2026-09-17T10:10:00+00:00"})
        assert await count_unseen(db, iso) == 1
        other = await count_unseen(db, None)
        assert other == 5

    asyncio.run(run())

