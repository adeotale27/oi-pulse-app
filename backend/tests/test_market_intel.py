from datetime import date

from market_intel import (
    STORE_MIN_IMPACT,
    articles_window_query,
    clamp_retention,
    classify_event_type,
    cluster_id_for,
    cluster_rows,
    constituent_boost,
    duplicate_hash,
    impact_band,
    impact_score,
    india_relevance_score,
    is_ist_today_item,
    item_ist_date,
    map_records,
    parse_news_datetime,
    popup_allowed,
    retention_cutoff,
    should_store_article,
    similar_titles,
)


def test_us_cpi_high_india():
    t = "US CPI comes in above expectations"
    assert impact_score(t) >= 55
    assert india_relevance_score(t) >= 40
    assert classify_event_type(t) == "macro"


def test_fed_decision():
    t = "Federal Reserve cuts rates 50bp in emergency move"
    assert impact_score(t) >= 90


def test_oil_shock_not_routine():
    shock = "OPEC production cut and major crude supply disruption"
    chatter = "Analyst says oil could rise this week in a newsletter recap"
    assert impact_score(shock) > impact_score(chatter)
    assert impact_score(chatter) < 55
    assert classify_event_type(shock) == "oil"


def test_should_store_skips_low_impact():
    assert STORE_MIN_IMPACT == 50
    assert not should_store_article(22)
    assert not should_store_article(49)
    assert should_store_article(50)
    hit, extra = constituent_boost("HDFC Bank results miss estimates", [("hdfc bank", 11.2)])
    assert hit and extra >= 14


def test_geopolitics_and_india_event():
    geo = "Tariffs and sanctions escalate in the Middle East shipping lanes"
    ind = "RBI holds repo rate; SEBI issues market circular"
    assert classify_event_type(geo) == "geopolitics"
    assert classify_event_type(ind) == "india_macro"
    assert india_relevance_score(ind) >= 40


def test_noise_deprioritized():
    assert impact_band(impact_score("What to watch this week: opinion recap explained")) in ("NOISE", "LOW")


def test_dedup_and_cluster():
    a = "Fed cuts rates 50bps"
    b = "Federal Reserve cuts rates"
    c = "Fed announces 50bp cut"
    assert similar_titles(a, c)
    h = duplicate_hash(a)
    assert duplicate_hash(a, "https://a.example/1") == h
    cid = cluster_id_for(b, [{"title": a, "event_cluster_id": "x1"}])
    assert cid == "x1"


def test_underlyings_not_hardcoded_in_scoring():
    t = "China PMI slump hits global liquidity and USD"
    assert india_relevance_score(t) >= 30


def test_api_field_mapping():
    payload = {"results": [{"title": "Hello", "url": "https://x.test", "description": "d", "published_at": "2026-09-15"}]}
    rows = map_records(payload, {"list": "results", "title": "title", "url": "url", "description": "description", "published_at": "published_at"})
    assert rows[0]["title"] == "Hello"


def test_retention_five_day_window():
    cut = retention_cutoff(date(2026, 9, 15), 5, 2)
    assert cut == date(2026, 9, 11)
    # new day 16 drops day 11
    assert retention_cutoff(date(2026, 9, 16), 5, 2) == date(2026, 9, 12)


def test_min_history_validation():
    ret, mn = clamp_retention(3, 5)
    assert ret >= mn == 5
    r0, m0 = clamp_retention(0, 0)
    assert r0 == 0 and m0 == 0
    assert retention_cutoff(date(2026, 9, 15), 0, 0) == date(2026, 9, 16)


def test_weekend_context_inside_five_days():
    # Monday 15 Sep 2026 — 5 calendar days still include Sat/Sun
    cut = retention_cutoff(date(2026, 9, 14), 5, 2)  # Monday
    assert cut <= date(2026, 9, 12)


def test_ranking_prefers_impact_not_only_time():
    docs = [
        {"title": "old", "impact_score": 95, "india_relevance_score": 90, "source_priority": 50, "published_at": "2026-01-01", "event_cluster_id": "a"},
        {"title": "new noise", "impact_score": 20, "india_relevance_score": 10, "source_priority": 50, "published_at": "2026-09-15", "event_cluster_id": "b"},
    ]
    ranked = cluster_rows(docs)
    assert ranked[0]["title"] == "old"


def test_item_ist_date_uses_published_prefix():
    assert item_ist_date({"published_at": "2026-09-14T18:53"}) == date(2026, 9, 14)
    assert is_ist_today_item({"published_at": "2026-09-14T08:19"}, today=date(2026, 9, 14)) is True
    assert is_ist_today_item({"published_at": "2026-09-14T08:19"}, today=date(2026, 9, 15)) is False
    assert is_ist_today_item({"published_at": "2026-09-15T04:00:00"}, today=date(2026, 9, 15)) is True


def test_rss_rfc822_and_iso_published_are_today():
    rss = "Tue, 15 Sep 2026 07:30:00 GMT"
    dt = parse_news_datetime(rss)
    assert dt is not None
    assert item_ist_date({"published_at": rss}) == date(2026, 9, 15)
    assert is_ist_today_item({"published_at": rss}, today=date(2026, 9, 15)) is True
    assert parse_news_datetime("20260915T073000") is not None


def test_popup_allowed_independent_of_page_and_ingest():
    prefs_off = {"page_enabled": False, "popup_enabled": False}
    prefs_guest = {"page_enabled": False, "popup_enabled": True}
    assert popup_allowed(False, prefs_guest, is_admin=True) is False
    assert popup_allowed(True, prefs_off, is_admin=True) is True
    assert popup_allowed(True, prefs_off, is_admin=False) is False
    assert popup_allowed(True, prefs_guest, is_admin=False) is True


def test_top_two_are_highest():
    docs = [
        {"title": "1", "impact_score": 98, "india_relevance_score": 94, "source_priority": 80, "published_at": "t", "event_cluster_id": "1"},
        {"title": "2", "impact_score": 96, "india_relevance_score": 97, "source_priority": 80, "published_at": "t", "event_cluster_id": "2"},
        {"title": "3", "impact_score": 91, "india_relevance_score": 80, "source_priority": 10, "published_at": "t", "event_cluster_id": "3"},
    ]
    ranked = cluster_rows(docs)
    titles = {r["title"] for r in ranked[:2]}
    assert "3" not in titles
    assert "1" in titles and "2" in titles


def test_ensure_default_sources_seeds_rss_without_overwrite():
    import asyncio
    from market_intel import ensure_default_sources, RSS_TEMPLATES, PUBLIC_API_CATALOG

    class Col:
        def __init__(self):
            self.docs = {}
        async def find_one(self, q):
            return self.docs.get(q.get("id"))
        async def update_one(self, q, upd, upsert=False):
            sid = q["id"]
            if sid in self.docs:
                self.docs[sid].update(upd.get("$set") or {})
            elif upsert:
                self.docs[sid] = {**(upd.get("$set") or {}), "id": sid}

    class Db:
        def __init__(self):
            self.c = Col()
        def __getitem__(self, _k):
            return self.c

    db = Db()
    asyncio.run(ensure_default_sources(db))
    assert db.c.docs["google-news-in"]["enabled"] is True
    db.c.docs["google-news-in"]["enabled"] = False
    asyncio.run(ensure_default_sources(db))
    assert db.c.docs["google-news-in"]["enabled"] is False
    assert len(db.c.docs) >= len(RSS_TEMPLATES) + len(PUBLIC_API_CATALOG)


def test_parse_feed_date_valid_invalid_and_missing():
    from market_intel import parse_feed_date
    assert parse_feed_date(None) is None
    assert parse_feed_date("") is None
    assert parse_feed_date("2026-09-17") == date(2026, 9, 17)
    try:
        parse_feed_date("17-09-2026")
        assert False, "expected ValueError"
    except ValueError:
        pass
    try:
        parse_feed_date("2026-13-40")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_articles_window_query_is_ist_day():
    q = articles_window_query(date(2026, 9, 17))
    assert q["status"] == {"$ne": "gone"}
    blob = str(q)
    assert "2026-09-17" in blob
    assert "$or" in q


def test_feed_for_user_date_filter_empty_and_populated():
    import asyncio
    from datetime import datetime, timezone
    from market_intel import feed_for_user, ART_COL

    docs = [
        {
            "title": "RBI holds repo",
            "impact_score": 80,
            "india_relevance_score": 70,
            "impact_band": "HIGH",
            "event_type": "india_macro",
            "published_at": "2026-09-17T08:00:00+05:30",
            "discovered_at": datetime(2026, 9, 17, 3, 0, tzinfo=timezone.utc),
            "event_cluster_id": "a",
            "source_name": "t",
            "status": "ok",
        },
        {
            "title": "Old story",
            "impact_score": 80,
            "india_relevance_score": 70,
            "impact_band": "HIGH",
            "event_type": "macro",
            "published_at": "2026-09-16T08:00:00+05:30",
            "discovered_at": "2026-09-16T03:00:00+00:00",
            "event_cluster_id": "b",
            "source_name": "t",
            "status": "ok",
        },
    ]

    class Cur:
        def __init__(self, rows):
            self.rows = rows
        def sort(self, *a, **k):
            return self
        async def to_list(self, n):
            return list(self.rows)

    class Col:
        def find(self, *a, **k):
            return Cur(docs)

    class Db:
        def __getitem__(self, k):
            assert k == ART_COL
            return Col()

    prefs = {"show_moderate": True, "show_high": True, "show_critical": True, "min_impact": 0, "min_india": 0}

    async def run():
        today = await feed_for_user(Db(), prefs, "all", 40, date_str="2026-09-17")
        assert len(today) == 1
        assert today[0]["title"] == "RBI holds repo"
        assert isinstance(today[0]["discovered_at"], str)
        empty = await feed_for_user(Db(), prefs, "all", 40, date_str="2026-09-18")
        assert empty == []
        try:
            await feed_for_user(Db(), prefs, "all", 40, date_str="not-a-date")
            assert False, "expected ValueError"
        except ValueError:
            pass

    asyncio.run(run())


def test_popup_feed_dates_overnight_vs_session():
    from datetime import datetime, timezone, timedelta
    from market_intel import popup_feed_dates, ist_today

    IST = timezone(timedelta(hours=5, minutes=30))
    fri_am = datetime(2026, 8, 14, 10, 0, tzinfo=IST)
    fri_pm = datetime(2026, 8, 14, 14, 0, tzinfo=IST)
    pre = datetime(2026, 8, 14, 9, 7, tzinfo=IST)
    assert popup_feed_dates(fri_am) == {ist_today(fri_am)}
    assert len(popup_feed_dates(fri_pm)) == 2
    assert ist_today(fri_pm) in popup_feed_dates(fri_pm)
    assert len(popup_feed_dates(pre)) == 2

