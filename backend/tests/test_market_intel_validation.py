import asyncio
import copy
from datetime import datetime, timedelta, timezone

from market_intel_validation import (
    classify_volatility_catalyst,
    compare_realized_ranges,
    directional_outcome,
    directional_strength_band,
    india_vix_outcome,
    nearest_snapshot,
    realized_range_pct,
    register_article_evaluation,
    resolve_pending_evaluations,
    summarize_evaluations,
)


def test_directional_outcome_scores_only_material_moves():
    supportive_up = directional_outcome("SUPPORTIVE", 100.0, 101.0)
    negative_up = directional_outcome("NEGATIVE", 100.0, 101.0)
    neutral = directional_outcome("SUPPORTIVE", 100.0, 100.02)
    unclear = directional_outcome("UNCLEAR", 100.0, 101.0)

    assert supportive_up == {"move": "UP", "change_pct": 1.0, "direction_hit": True}
    assert negative_up["direction_hit"] is False
    assert neutral["move"] == "FLAT"
    assert neutral["direction_hit"] is None
    assert unclear["direction_hit"] is None


def test_directional_strength_bands_are_heuristic_and_exclude_zero():
    assert directional_strength_band(-64) == "STRONG"
    assert directional_strength_band(49) == "MODERATE"
    assert directional_strength_band(24) == "WEAK"
    assert directional_strength_band(0) is None
    assert directional_strength_band("unknown") is None


def test_volatility_catalyst_classifier_keeps_specific_groups_separate():
    assert classify_volatility_catalyst("RBI keeps the repo rate unchanged") == "RBI"
    assert classify_volatility_catalyst("Brent crude surges after supply disruption") == "CRUDE"
    assert classify_volatility_catalyst("Federal Reserve signals higher rates") == "GLOBAL_RATES"
    assert classify_volatility_catalyst("Quarterly earnings beat estimates") == "EARNINGS"
    assert classify_volatility_catalyst("A company announces a new office") is None


def test_nearest_snapshot_respects_tolerance_and_prefers_earlier_on_tie():
    target = datetime(2026, 10, 9, 9, 30, tzinfo=timezone.utc)
    snapshots = [
        {"timestamp": (target + timedelta(minutes=2)).isoformat(), "price": 25001},
        {"timestamp": (target - timedelta(minutes=2)).isoformat(), "price": 24999},
        {"timestamp": (target + timedelta(minutes=6)).isoformat(), "price": 25006},
        {"timestamp": target.isoformat(), "price": 0},
    ]

    result = nearest_snapshot(snapshots, target, timedelta(minutes=5))

    assert result["price"] == 24999


def test_nearest_snapshot_returns_missing_when_no_valid_observation():
    target = datetime(2026, 10, 9, 9, 30, tzinfo=timezone.utc)
    snapshots = [
        {"timestamp": (target + timedelta(minutes=8)).isoformat(), "price": 25008},
        {"timestamp": target.isoformat(), "price": "not-a-price"},
    ]

    assert nearest_snapshot(snapshots, target, timedelta(minutes=5)) is None


def test_india_vix_volatility_response_uses_absolute_and_relative_thresholds():
    material = india_vix_outcome(10.0, 10.6)
    small_absolute_change = india_vix_outcome(20.0, 20.6)
    small_relative_change = india_vix_outcome(10.0, 10.4)

    assert material == {
        "change_points": 0.6,
        "change_pct": 6.0,
        "material_increase": True,
    }
    assert small_absolute_change["material_increase"] is False
    assert small_relative_change["material_increase"] is False
    assert india_vix_outcome(None, 12.0) is None


def test_realized_range_requires_window_edge_coverage_and_three_quotes():
    start = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=15)
    snapshots = [
        {"timestamp": start.isoformat(), "price": 100},
        {"timestamp": (start + timedelta(minutes=7)).isoformat(), "price": 100.5},
        {"timestamp": end.isoformat(), "price": 101},
    ]
    no_end_coverage = snapshots[:-1]

    assert realized_range_pct(snapshots, start, end) == 1.0
    assert realized_range_pct(no_end_coverage, start, end) is None
    assert compare_realized_ranges(0.1, 0.2) == {
        "increase_pct_points": 0.1,
        "range_increased": True,
    }
    assert compare_realized_ranges(0.1, 0.12)["range_increased"] is False


def test_performance_withholds_accuracy_until_minimum_sample_and_excludes_after_hours():
    outcome = {"direction_hit": True, "move": "UP"}
    below_threshold = [
        {
            "time_class": "IN_SESSION",
            "outcomes": {"NIFTY": {"15m": outcome}},
        }
        for _ in range(29)
    ]
    below_threshold.append({
        "time_class": "AFTER_CLOSE",
        "outcomes": {"NIFTY": {"15m": {"direction_hit": False, "move": "DOWN"}}},
    })
    below_threshold.append({
        "time_class": "IN_SESSION",
        "outcomes": {"NIFTY": {"15m": {"status": "NO_SNAPSHOT", "direction_hit": None}}},
    })
    early = summarize_evaluations(below_threshold)
    assert early["after_hours_story_count"] == 1
    assert early["results"][0]["sample_count"] == 29
    assert early["results"][0]["accuracy_pct"] is None
    assert early["results"][0]["status"] == "BUILDING_SAMPLE"
    assert early["results"][0]["unavailable_count"] == 1

    calibrated = summarize_evaluations(below_threshold[:29] + [
        {
            "time_class": "IN_SESSION",
            "outcomes": {"NIFTY": {"15m": {"direction_hit": False, "move": "DOWN"}}},
        }
    ])
    assert calibrated["results"][0]["sample_count"] == 30
    assert calibrated["results"][0]["accuracy_pct"] == 96.7
    assert calibrated["results"][0]["status"] == "CALIBRATED"


def test_volatility_results_keep_vix_and_index_range_rates_separate():
    events = [
        {
            "time_class": "IN_SESSION",
            "volatility_risk": "HIGH",
            "volatility_outcomes": {
                "india_vix": {
                    "15m": {"status": "OBSERVED", "material_increase": True, "change_points": 0.7},
                },
                "index_ranges": {
                    "NIFTY": {
                        "15m": {
                            "status": "OBSERVED",
                            "range_increased": True,
                            "pre_range_pct": 0.1,
                            "post_range_pct": 0.2,
                        },
                    },
                },
            },
            "outcomes": {"NIFTY": {"15m": {"direction_hit": True, "move": "UP"}}},
        }
        for _ in range(30)
    ]
    events.append({
        "time_class": "AFTER_CLOSE",
        "volatility_risk": "HIGH",
        "volatility_outcomes": {
            "india_vix": {"15m": {"status": "OBSERVED", "material_increase": False}},
        },
    })

    summary = summarize_evaluations(events)
    vix_result = next(
        row for row in summary["volatility"]["india_vix"]
        if row["risk_level"] == "HIGH" and row["horizon"] == "15m"
    )
    range_result = next(
        row for row in summary["volatility"]["index_ranges"]
        if row["risk_level"] == "HIGH" and row["index"] == "NIFTY" and row["horizon"] == "15m"
    )

    assert vix_result["sample_count"] == 30
    assert vix_result["material_increase_pct"] == 100.0
    assert vix_result["average_change_points"] == 0.7
    assert range_result["sample_count"] == 30
    assert range_result["range_increased_pct"] == 100.0
    assert range_result["average_pre_range_pct"] == 0.1
    assert range_result["average_post_range_pct"] == 0.2
    assert summary["results"][0]["accuracy_pct"] == 100.0


def test_confidence_comparison_uses_one_row_per_cluster_and_waits_for_samples():
    def event(event_id, band, hit):
        return {
            "event_cluster_id": event_id,
            "time_class": "IN_SESSION",
            "directional_strength_band": band,
            "outcomes": {"NIFTY": {"15m": {"direction_hit": hit, "move": "UP"}}},
        }

    events = [event(f"weak-{i}", "WEAK", i < 20) for i in range(30)]
    events += [event(f"strong-{i}", "STRONG", i < 24) for i in range(30)]
    events.append(event("weak-0", "WEAK", False))

    summary = summarize_evaluations(events)
    result = next(
        row for row in summary["results"]
        if row["index"] == "NIFTY" and row["horizon"] == "15m"
    )
    weak = next(row for row in result["strength_bands"] if row["band"] == "WEAK")
    strong = next(row for row in result["strength_bands"] if row["band"] == "STRONG")

    assert weak["sample_count"] == 30
    assert weak["accuracy_pct"] == 66.7
    assert strong["sample_count"] == 30
    assert strong["accuracy_pct"] == 80.0
    assert result["strength_comparison"] == {
        "strong_minus_weak_pct_points": 13.3,
        "higher_strength_more_accurate": True,
    }


def test_catalyst_volatility_breakdowns_hide_small_samples():
    def event(event_id, catalyst):
        return {
            "event_cluster_id": event_id,
            "time_class": "IN_SESSION",
            "catalyst": catalyst,
            "volatility_risk": "HIGH",
            "volatility_outcomes": {
                "india_vix": {
                    "15m": {
                        "status": "OBSERVED",
                        "material_increase": True,
                        "change_points": 0.6,
                    },
                },
                "index_ranges": {
                    "NIFTY": {
                        "15m": {
                            "status": "OBSERVED",
                            "range_increased": True,
                            "pre_range_pct": 0.1,
                            "post_range_pct": 0.2,
                        },
                    },
                },
            },
        }

    events = [event(f"rbi-{i}", "RBI") for i in range(30)]
    events += [event(f"crude-{i}", "CRUDE") for i in range(29)]
    volatility = summarize_evaluations(events)["volatility"]

    assert volatility["catalysts"]["india_vix"] == [{
        "catalyst": "RBI",
        "horizon": "15m",
        "sample_count": 30,
        "material_increase_pct": 100.0,
        "average_change_points": 0.6,
    }]
    assert volatility["catalysts"]["index_ranges"] == [{
        "catalyst": "RBI",
        "index": "NIFTY",
        "horizon": "15m",
        "sample_count": 30,
        "range_increased_pct": 100.0,
        "average_pre_range_pct": 0.1,
        "average_post_range_pct": 0.2,
    }]


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction):
        self.rows.sort(key=lambda row: row.get(key), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return self.rows[:length]


class _Collection:
    def __init__(self, rows, *, evaluations=False):
        self.rows = rows
        self.evaluations = evaluations

    @staticmethod
    def _nested_get(row, path):
        value = row
        for key in path.split("."):
            if not isinstance(value, dict):
                return None
            value = value.get(key)
        return value

    def find(self, query, _projection=None):
        rows = []
        for row in self.rows:
            if self.evaluations:
                if row.get("time_class") != query.get("time_class"):
                    continue
                expiry = query.get("expires_at", {}).get("$gt")
                if expiry and row.get("expires_at") <= expiry:
                    continue
                if "$or" in query and not any(
                    self._nested_get(row, next(iter(condition))) == "PENDING"
                    for condition in query["$or"]
                ):
                    continue
            else:
                if row.get("index") != query.get("index"):
                    continue
                bounds = query.get("timestamp", {})
                if row.get("timestamp") < bounds.get("$gte", ""):
                    continue
                if row.get("timestamp") > bounds.get("$lte", "\uffff"):
                    continue
            rows.append(copy.deepcopy(row))
        return _Cursor(rows)

    async def update_one(self, selector, update, upsert=False):
        row = next(
            (item for item in self.rows if item.get("event_cluster_id") == selector["event_cluster_id"]),
            None,
        )
        if row is None and upsert:
            row = copy.deepcopy(update["$setOnInsert"])
            self.rows.append(row)
        if row is None:
            return
        for path, value in update.get("$set", {}).items():
            target = row
            parts = path.split(".")
            for key in parts[:-1]:
                target = target.setdefault(key, {})
            target[parts[-1]] = value


class _EvaluationDb:
    def __init__(self, snapshots, evaluations):
        self.oi_snapshots = _Collection(snapshots)
        self.mi_direction_evaluations = _Collection(evaluations, evaluations=True)

    def __getitem__(self, name):
        return getattr(self, name)


def test_resolver_persists_vix_and_range_results_from_existing_snapshots():
    arrival = datetime(2026, 10, 9, 4, 0, tzinfo=timezone.utc)
    target = arrival + timedelta(minutes=15)
    now = target + timedelta(minutes=5)
    snapshots = []
    for index_id in ("NIFTY", "SENSEX", "BANKNIFTY"):
        values = (
            (arrival - timedelta(minutes=15), 100.0),
            (arrival - timedelta(minutes=7), 100.05),
            (arrival, 100.1),
            (arrival + timedelta(minutes=7), 100.2),
            (target, 100.5),
        )
        for observed_at, price in values:
            snapshots.append({
                "index": index_id,
                "timestamp": observed_at.isoformat(),
                "price": price,
                "vix": 10.0 if observed_at == arrival else 10.6 if observed_at == target else 10.0,
            })

    event = {
        "event_cluster_id": "story-1",
        "time_class": "IN_SESSION",
        "arrival_at": arrival,
        "expires_at": now + timedelta(days=1),
        "direction": "SUPPORTIVE",
        "volatility_risk": "HIGH",
        "baselines": {
            index_id: {"timestamp": arrival.isoformat(), "price": 100.1, "vix": 10.0}
            for index_id in ("NIFTY", "SENSEX", "BANKNIFTY")
        },
        "outcomes": {
            index_id: {
                "15m": {"status": "PENDING", "target_at": target.isoformat()},
                "1h": {"status": "NOT_APPLICABLE"},
                "session_close": {"status": "NOT_APPLICABLE"},
            }
            for index_id in ("NIFTY", "SENSEX", "BANKNIFTY")
        },
        "volatility_outcomes": {
            "india_vix": {
                "15m": {"status": "PENDING", "target_at": target.isoformat()},
                "1h": {"status": "NOT_APPLICABLE"},
                "session_close": {"status": "NOT_APPLICABLE"},
            },
            "index_ranges": {
                index_id: {
                    "15m": {"status": "PENDING", "target_at": target.isoformat()},
                    "1h": {"status": "NOT_APPLICABLE"},
                    "session_close": {"status": "NOT_APPLICABLE"},
                }
                for index_id in ("NIFTY", "SENSEX", "BANKNIFTY")
            },
        },
    }
    db = _EvaluationDb(snapshots, [event])

    resolved = asyncio.run(resolve_pending_evaluations(db, now))

    result = db.mi_direction_evaluations.rows[0]
    assert resolved == 7
    assert result["volatility_outcomes"]["india_vix"]["15m"]["material_increase"] is True
    assert result["volatility_outcomes"]["india_vix"]["15m"]["change_points"] == 0.6
    assert result["volatility_outcomes"]["index_ranges"]["NIFTY"]["15m"]["status"] == "OBSERVED"
    assert result["volatility_outcomes"]["index_ranges"]["NIFTY"]["15m"]["range_increased"] is True
    assert result["outcomes"]["NIFTY"]["15m"]["direction_hit"] is True


def test_register_article_evaluation_persists_strength_and_catalyst_once_per_cluster():
    arrival = datetime(2026, 10, 9, 4, 0, tzinfo=timezone.utc)
    snapshots = [
        {
            "index": index_id,
            "timestamp": arrival.isoformat(),
            "price": 100.0,
            "vix": 10.0,
        }
        for index_id in ("NIFTY", "SENSEX", "BANKNIFTY")
    ]
    db = _EvaluationDb(snapshots, [])
    article = {
        "event_cluster_id": "rbi-event",
        "title": "RBI cuts repo rate",
        "summary": "",
        "event_type": "india_macro",
        "impact_score": 80,
        "india_relevance_score": 80,
        "discovered_at": arrival.isoformat(),
    }

    async def register_twice():
        await register_article_evaluation(db, article)
        await register_article_evaluation(db, article)

    asyncio.run(register_twice())

    assert len(db.mi_direction_evaluations.rows) == 1
    stored = db.mi_direction_evaluations.rows[0]
    assert stored["directional_strength"] == 64
    assert stored["directional_strength_band"] == "STRONG"
    assert stored["catalyst"] == "RBI"
