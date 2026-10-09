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
    directional_market_impact,
    impact_band,
    impact_score,
    india_relevance_score,
    is_ist_today_item,
    item_ist_date,
    map_records,
    parse_news_datetime,
    popup_allowed,
    popup_matches_preferences,
    retention_cutoff,
    source_interval_seconds,
    source_is_due,
    should_store_article,
    similar_titles,
    user_prefs_with_defaults,
    validate_source_url,
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


def test_material_global_news_about_index_constituents_is_kept_and_india_relevant():
    headlines = (
        "US visa rules may affect Infosys and TCS hiring",
        "European steel import tariffs hit Tata Steel orders",
        "European chemical rules trigger investigation into Tata Chemicals",
        "Government order delay hits Larsen & Toubro construction projects",
    )
    constituents = [
        ("infosys", 4.0),
        ("tcs", 4.5),
        ("tata steel", 2.0),
        ("tata chemicals", 2.0),
        ("larsen & toubro", 3.0),
    ]
    for headline in headlines:
        matched, boost = constituent_boost(headline, constituents)
        assert matched
        assert boost == 45
        base_impact = impact_score(headline)
        applied_boost = max(boost, 75 - base_impact)
        assert should_store_article(base_impact + applied_boost)
        assert min(100, india_relevance_score(headline) + 55) >= 55
        assert base_impact + applied_boost >= 75

    matched, boost = constituent_boost(
        "European steel prices fall after routine industry survey",
        constituents,
    )
    assert not matched
    assert boost == 0


def test_geopolitics_and_india_event():
    geo = "Tariffs and sanctions escalate in the Middle East shipping lanes"
    ind = "RBI holds repo rate; SEBI issues market circular"
    assert classify_event_type(geo) == "geopolitics"
    assert classify_event_type(ind) == "india_macro"
    assert india_relevance_score(ind) >= 40


def test_geopolitical_conflict_and_oil_routes_to_desk():
    headline = "Iran conflict disrupts Hormuz shipping lanes and crude supply"
    assert classify_event_type(headline) == "oil"
    assert impact_score(headline) >= 75
    assert india_relevance_score(headline) >= 30


def test_noise_deprioritized():
    assert impact_band(impact_score("What to watch this week: opinion recap explained")) in ("NOISE", "LOW")


def test_india_desk_impact_grades_prioritise_policy_over_generic_commentary():
    assert impact_score("RBI cuts repo rate after policy decision") >= 55
    assert impact_score("SEBI issues margin circular for equity derivatives") >= 55
    assert impact_score("Analyst says Nifty may rally this week") < STORE_MIN_IMPACT
    assert impact_score("Apple previews its next phone") < STORE_MIN_IMPACT


def test_directional_news_read_separates_market_polarity_from_importance():
    supportive = directional_market_impact(
        "RBI cuts repo rates to support growth",
        impact=80,
        event_type="india_macro",
        india_relevance=80,
    )
    assert supportive["market_direction"] == "SUPPORTIVE"
    assert supportive["directional_impact_score"] == 64
    assert "Rate-cut" in supportive["direction_reason"]
    low_india_link = directional_market_impact(
        "RBI cuts repo rates to support growth",
        impact=80,
        event_type="india_macro",
        india_relevance=20,
    )
    assert low_india_link["market_direction"] == "SUPPORTIVE"
    assert low_india_link["directional_impact_score"] == 16

    inflation_shock = directional_market_impact(
        "US CPI comes in above expectations",
        impact=75,
        event_type="macro",
        india_relevance=70,
    )
    assert inflation_shock["market_direction"] == "NEGATIVE"
    assert inflation_shock["directional_impact_score"] < 0
    assert "Hotter inflation" in inflation_shock["direction_reason"]

    oil_relief = directional_market_impact("Crude oil falls sharply", impact=70, event_type="oil", india_relevance=70)
    oil_shock = directional_market_impact("Crude oil surges on supply disruption", impact=90, event_type="oil", india_relevance=70)
    assert oil_relief["market_direction"] == "SUPPORTIVE"
    assert oil_shock["market_direction"] == "NEGATIVE"


def test_directional_news_read_preserves_mixed_and_unclear_cases():
    mixed = directional_market_impact(
        "Fed cuts rates while inflation surges",
        impact=90,
        event_type="macro",
        india_relevance=70,
    )
    assert mixed["market_direction"] == "MIXED"
    assert mixed["directional_impact_score"] == 0
    assert "opposing market cues" in mixed["direction_reason"]

    unclear = directional_market_impact(
        "RBI holds repo rate unchanged",
        impact=65,
        event_type="india_macro",
    )
    assert unclear["market_direction"] == "UNCLEAR"
    assert unclear["directional_impact_score"] == 0

    no_cut = directional_market_impact("Fed rules out a rate cut", impact=80, event_type="macro")
    assert no_cut["market_direction"] == "NEGATIVE"


def test_directional_news_read_covers_india_relevant_market_drivers():
    cases = (
        ("Nifty falls after a sharp sell-off", "NEGATIVE"),
        ("FII net buying supports Indian equities", "SUPPORTIVE"),
        ("Rupee weakens against the dollar", "NEGATIVE"),
        ("GDP growth beats expectations", "SUPPORTIVE"),
        ("Unemployment rises sharply", "NEGATIVE"),
        ("Bond yields jump to a new high", "NEGATIVE"),
        ("US dollar strengthens as investors seek safety", "NEGATIVE"),
        ("Recession fears grow after output contracts", "NEGATIVE"),
        ("Ceasefire eases geopolitical tensions", "SUPPORTIVE"),
        ("Nifty not only rises but closes at a record high", "SUPPORTIVE"),
    )
    for headline, expected in cases:
        result = directional_market_impact(headline, impact=80, event_type="macro")
        assert result["market_direction"] == expected, headline


def test_directional_read_prioritizes_headline_and_does_not_promote_negated_cues():
    headline_first = directional_market_impact(
        "Oil prices rise",
        "Crude did not rise this week, while the RBI cut rates.",
        event_type="oil",
        impact=80,
    )
    assert headline_first["market_direction"] == "NEGATIVE"
    assert headline_first["direction_basis"] == "HEADLINE"
    assert "Higher or tighter crude" in headline_first["direction_reason"]
    assert "Rate-cut" not in headline_first["direction_reason"]

    negated = directional_market_impact(
        "Nifty did not fall",
        "RBI cuts rates and crude falls.",
        event_type="india_macro",
        impact=80,
    )
    assert negated["market_direction"] == "UNCLEAR"
    assert negated["direction_basis"] == "HEADLINE"

    summary_fallback = directional_market_impact(
        "Gold prices drop over 2%",
        "Rising Treasury yields and a strong US dollar weighed on markets.",
        event_type="macro",
        impact=80,
        india_relevance=70,
    )
    assert summary_fallback["market_direction"] == "NEGATIVE"
    assert summary_fallback["direction_basis"] == "SUMMARY"
    assert summary_fallback["directional_impact_score"] == -28
    assert "Summary-based cue" in summary_fallback["direction_reason"]


def test_directional_read_requires_india_link_for_company_specific_news():
    global_company = directional_market_impact(
        "Company earnings beat estimates",
        event_type="corporate",
        impact=80,
        india_relevance=10,
    )
    indian_company = directional_market_impact(
        "Company earnings beat estimates",
        event_type="corporate",
        impact=80,
        india_relevance=60,
    )
    assert global_company["market_direction"] == "UNCLEAR"
    assert "Indian-market link" in global_company["direction_reason"]
    assert indian_company["market_direction"] == "SUPPORTIVE"


def test_public_market_intel_item_computes_direction_for_existing_articles():
    from market_intel import public_article

    result = public_article({
        "title": "Rupee weakens as crude rises",
        "summary": "",
        "impact_score": 80,
        "india_relevance_score": 70,
        "event_type": "oil",
    })
    assert result["market_direction"] == "NEGATIVE"
    assert result["directional_impact_score"] < 0
    assert result["direction_basis"] == "HEADLINE"
    assert result["direction_reason"]


def test_market_intel_explains_volatility_and_india_transmission_separately():
    from market_intel import india_link_read, volatility_risk_read

    volatility = volatility_risk_read("RBI announces an emergency rate decision")
    india_link = india_link_read("US Treasury yields jump", "", 30)
    unclear_link = india_link_read("Local company launches a new product", "", 0)

    assert volatility["volatility_risk"] == "HIGH"
    assert volatility["volatility_risk_basis"] == "HEADLINE"
    assert "gap and volatility risk" in volatility["volatility_risk_reason"]
    assert india_link["india_link_status"] == "INDIRECT"
    assert "foreign flows" in india_link["india_link_reason"]
    assert unclear_link["india_link_status"] == "UNCLEAR"
    assert unclear_link["india_link_reason"].startswith("India link unclear")


def test_market_intel_source_identity_avoids_aggregator_and_collapses_wire_copies():
    from market_intel import _source_identity, enrich_item

    reuters = _source_identity({
        "source_name": "Reuters",
        "article_url": "https://www.reuters.com/world/markets/story",
    })
    reuters_syndicated = _source_identity({
        "source_name": "Reuters",
        "article_url": "https://finance.example.com/news/story",
    })
    aggregator = _source_identity({
        "source_name": "Google News",
        "article_url": "https://news.google.com/rss/articles/123",
    })
    uk_publisher = _source_identity({
        "source_name": "Publisher",
        "article_url": "https://markets.publisher.co.uk/story",
    })

    assert reuters["source_key"] == reuters_syndicated["source_key"] == "wire:reuters"
    assert aggregator is None
    assert uk_publisher["source_key"] == "domain:publisher.co.uk"
    enriched = enrich_item({
        "title": "RBI cuts repo rate",
        "source_name": "Reuters",
        "url": "https://news.google.com/rss/articles/123",
        "published_at": "2026-10-09",
    }, {"id": "google-news", "name": "Google News", "source_type": "RSS"})
    assert enriched["source_name"] == "Reuters"
    assert enriched["independent_sources"][0]["source_key"] == "wire:reuters"
    assert enriched["published_at_known"] is True
    assert enriched["published_at_precision"] == "DATE"


def test_market_timing_uses_shared_market_session_bounds(monkeypatch):
    from datetime import time
    import market_hours
    from market_intel import _market_timing

    monkeypatch.setattr(market_hours, "is_nse_cash_trading_day", lambda _dt: True)
    monkeypatch.setattr(
        market_hours,
        "session_display_bounds",
        lambda _dt: (time(9, 15), time(15, 40)),
    )

    assert _market_timing("2026-10-09T03:30:00+00:00") == "PRE_OPEN"
    assert _market_timing("2026-10-09T04:00:00+00:00") == "IN_SESSION"
    assert _market_timing("2026-10-09T10:11:00+00:00") == "AFTER_CLOSE"


def test_public_article_reports_independent_direction_agreement_and_unknown_publish_time():
    from market_intel import public_article

    base = {
        "title": "RBI cuts repo rate to support growth",
        "impact_score": 80,
        "india_relevance_score": 80,
        "event_type": "india_macro",
        "published_at": "2026-10-09T04:00:00+00:00",
        "published_at_known": False,
        "discovered_at": "2026-10-09T04:02:00+00:00",
        "independent_sources": [
            {"source_key": "domain:one.in", "source_name": "One", "direction": "SUPPORTIVE", "directional_score": 60},
            {"source_key": "domain:two.in", "source_name": "Two", "direction": "SUPPORTIVE", "directional_score": 50},
        ],
    }

    agreed = public_article(base)
    disagreed = public_article({
        **base,
        "independent_sources": [
            base["independent_sources"][0],
            {**base["independent_sources"][1], "direction": "NEGATIVE"},
        ],
    })

    assert agreed["market_direction"] == "SUPPORTIVE"
    assert agreed["source_direction_agreement"] == "AGREE"
    assert agreed["independent_source_count"] == 2
    assert agreed["news_freshness"] == "PUBLISH_TIME_UNKNOWN"
    assert agreed["published_age_minutes"] is None
    assert disagreed["market_direction"] == "MIXED"
    assert disagreed["source_direction_agreement"] == "DISAGREE"


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


def test_configurable_source_urls_reject_local_targets():
    assert validate_source_url("http://127.0.0.1:8000/feed") == "private_url_not_allowed"
    assert validate_source_url("http://169.254.169.254/latest/meta-data") == "private_url_not_allowed"
    assert validate_source_url("http://localhost/feed") == "local_url_not_allowed"
    assert validate_source_url("file:///etc/passwd") == "url_must_use_http"
    assert validate_source_url("https://example.com/feed") is None


def test_dns_resolution_rejects_private_addresses(monkeypatch):
    import market_intel

    monkeypatch.setattr(
        market_intel.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("127.0.0.1", 80))],
    )
    try:
        market_intel._validated_addresses("feed.example", 80)
        assert False, "expected private DNS result to be rejected"
    except ValueError as exc:
        assert str(exc) == "hostname_resolves_to_private_address"


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


def test_popup_honors_user_thresholds_and_keeps_critical_global_override():
    prefs = {"popup_min_impact": 75, "popup_min_india": 30}
    assert popup_matches_preferences({"impact_score": 78, "india_relevance_score": 35}, prefs)
    assert not popup_matches_preferences({"impact_score": 78, "india_relevance_score": 20}, prefs)
    assert not popup_matches_preferences({"impact_score": 70, "india_relevance_score": 90}, prefs)
    assert popup_matches_preferences({"impact_score": 92, "india_relevance_score": 0}, prefs)


def test_user_popup_defaults_migrate_without_overwriting_custom_thresholds():
    migrated = user_prefs_with_defaults({"popup_min_impact": 90, "popup_min_india": 70})
    assert migrated["popup_min_impact"] == 75
    assert migrated["popup_min_india"] == 30
    custom = user_prefs_with_defaults({"popup_min_impact": 85, "popup_min_india": 65})
    assert custom["popup_min_impact"] == 85
    assert custom["popup_min_india"] == 65


def test_source_cadence_accelerates_public_feeds_without_overpolling_keyed_providers():
    from datetime import datetime, timedelta, timezone

    now = datetime(2026, 9, 29, 9, 0, tzinfo=timezone.utc)
    rss = {"source_type": "RSS", "last_run": (now - timedelta(seconds=60)).isoformat()}
    api = {"source_type": "API", "last_run": (now - timedelta(seconds=60)).isoformat()}
    assert source_interval_seconds(rss, 60) == 60
    assert source_interval_seconds(api, 60) == 300
    assert source_is_due(rss, now, 60)
    assert not source_is_due(api, now, 60)


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
    assert db.c.docs["google-news-india-company-impact"]["enabled"] is True
    assert "H-1B" in db.c.docs["google-news-india-company-impact"]["endpoint"]
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


def test_freshly_discovered_overnight_item_is_visible_on_refresh_day():
    from datetime import datetime, timezone
    from market_intel import item_matches_feed_date

    row = {
        "published_at": "2026-09-21T12:30:00+00:00",
        "discovered_at": datetime(2026, 9, 22, 4, 45, tzinfo=timezone.utc),
    }
    assert item_matches_feed_date(row, date(2026, 9, 22)) is True


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
