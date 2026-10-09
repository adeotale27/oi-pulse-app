"""Outcome tracking for Market Intel direction estimates.

This reads existing OI snapshots only; it never fetches quotes or changes the
OI poller. Missing observations remain missing and are never interpolated.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional
from zoneinfo import ZoneInfo

from market_hours import session_poll_bounds
from universe import DESK_IDS

EVAL_COL = "mi_direction_evaluations"
HORIZONS = ("15m", "1h", "session_close")
MIN_SAMPLE_COUNT = 30
BASELINE_TOLERANCE = timedelta(minutes=5)
TARGET_TOLERANCE = timedelta(minutes=5)
FLAT_MOVE_PCT = 0.05
MIN_RANGE_OBSERVATIONS = 3
MIN_VIX_RISE_POINTS = 0.5
MIN_VIX_RISE_PCT = 5.0
MIN_INDEX_RANGE_EXPANSION_PCT = 0.05
MIN_INDEX_RANGE_EXPANSION_RATIO = 1.2
RETENTION_DAYS = 180
STRENGTH_BANDS = (
    ("WEAK", 1, 24),
    ("MODERATE", 25, 49),
    ("STRONG", 50, 100),
)
VOLATILITY_CATALYSTS = ("RBI", "CRUDE", "GLOBAL_RATES", "EARNINGS")


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _session_targets(arrival: datetime) -> Dict[str, datetime]:
    local = arrival.astimezone(ZoneInfo("Asia/Kolkata"))
    _, poll_close = session_poll_bounds(local)
    session_day = local.date()
    close_local = datetime.combine(session_day, poll_close, local.tzinfo)
    return {
        "15m": arrival + timedelta(minutes=15),
        "1h": arrival + timedelta(hours=1),
        "session_close": close_local.astimezone(timezone.utc),
    }


def nearest_snapshot(snapshots: Iterable[Dict[str, Any]], target: datetime, tolerance: timedelta) -> Optional[Dict[str, Any]]:
    """Return the closest valid quote, preferring the earlier quote on a tie."""
    candidates = []
    for row in snapshots:
        observed_at = _parse_dt(row.get("timestamp"))
        price = _positive_number(row.get("price"))
        if observed_at is None or price is None:
            continue
        delta = abs(observed_at - target)
        if delta <= tolerance:
            candidates.append((delta, observed_at > target, observed_at, row))
    return min(candidates, key=lambda item: (item[0], item[1]))[3] if candidates else None


def nearest_vix_snapshot(
    snapshots: Iterable[Dict[str, Any]],
    target: datetime,
    tolerance: timedelta,
) -> Optional[Dict[str, Any]]:
    """Return the closest snapshot containing a usable India VIX quote."""
    candidates = []
    for row in snapshots:
        observed_at = _parse_dt(row.get("timestamp"))
        if observed_at is None or _positive_number(row.get("vix")) is None:
            continue
        delta = abs(observed_at - target)
        if delta <= tolerance:
            candidates.append((delta, observed_at > target, observed_at, row))
    return min(candidates, key=lambda item: (item[0], item[1]))[3] if candidates else None


def directional_outcome(direction: str, baseline_price: float, observed_price: float) -> Dict[str, Any]:
    """Score direction only for moves larger than the explicit noise threshold."""
    change_pct = (observed_price - baseline_price) / baseline_price * 100
    move = "FLAT" if abs(change_pct) < FLAT_MOVE_PCT else ("UP" if change_pct > 0 else "DOWN")
    normalized = str(direction or "UNCLEAR").upper()
    hit = None
    if move != "FLAT" and normalized in ("SUPPORTIVE", "NEGATIVE"):
        hit = (normalized == "SUPPORTIVE" and move == "UP") or (
            normalized == "NEGATIVE" and move == "DOWN"
        )
    return {
        "move": move,
        "change_pct": round(change_pct, 4),
        "direction_hit": hit,
    }


def directional_strength_band(value: Any) -> Optional[str]:
    """Bucket the heuristic score magnitude; it is not a probability."""
    try:
        strength = abs(int(value))
    except (TypeError, ValueError):
        return None
    for band, lower, upper in STRENGTH_BANDS:
        if lower <= strength <= upper:
            return band
    return None


def classify_volatility_catalyst(title: str, summary: str = "", event_type: str = "") -> Optional[str]:
    """Assign one specific, explainable catalyst family for grouped outcomes."""
    text = f"{title or ''} {summary or ''}"
    if re.search(r"\b(?:rbi|reserve bank of india|repo rate|monetary policy committee)\b", text, re.I):
        return "RBI"
    if re.search(r"\b(?:crude|oil|brent|wti|opec)\b", text, re.I):
        return "CRUDE"
    if re.search(
        r"\b(?:fed|fomc|federal reserve|ecb|bank of england|boj|bank of japan|"
        r"us treasury yields?|global bond yields?)\b",
        text,
        re.I,
    ):
        return "GLOBAL_RATES"
    if re.search(r"\b(?:earnings|quarterly results|earnings guidance|results guidance)\b", text, re.I):
        return "EARNINGS"
    if str(event_type or "").lower() == "corporate" and re.search(
        r"\b(?:results|guidance)\b", text, re.I
    ):
        return "EARNINGS"
    return None


def _positive_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def india_vix_outcome(baseline_vix: Any, observed_vix: Any) -> Optional[Dict[str, Any]]:
    """Measure a material VIX rise; return None when either quote is unusable."""
    base = _positive_number(baseline_vix)
    observed = _positive_number(observed_vix)
    if base is None or observed is None:
        return None
    point_change = observed - base
    pct_change = point_change / base * 100
    return {
        "change_points": round(point_change, 3),
        "change_pct": round(pct_change, 3),
        "material_increase": (
            point_change >= MIN_VIX_RISE_POINTS
            and pct_change >= MIN_VIX_RISE_PCT
        ),
    }


def realized_range_pct(
    snapshots: Iterable[Dict[str, Any]],
    start: datetime,
    end: datetime,
    *,
    tolerance: timedelta = TARGET_TOLERANCE,
) -> Optional[float]:
    """Return sampled high-low range as % of start price with edge coverage."""
    if end <= start:
        return None
    rows = []
    for snapshot in snapshots:
        observed_at = _parse_dt(snapshot.get("timestamp"))
        price = _positive_number(snapshot.get("price"))
        if observed_at and price is not None:
            rows.append((observed_at, price))
    if len(rows) < MIN_RANGE_OBSERVATIONS:
        return None
    start_row = nearest_snapshot(
        [{"timestamp": ts, "price": price} for ts, price in rows],
        start,
        tolerance,
    )
    end_row = nearest_snapshot(
        [{"timestamp": ts, "price": price} for ts, price in rows],
        end,
        tolerance,
    )
    if start_row is None or end_row is None:
        return None
    start_price = _positive_number(start_row.get("price"))
    if start_price is None:
        return None
    window_start = start - tolerance
    window_end = end + tolerance
    prices = [
        price for ts, price in rows
        if window_start <= ts <= window_end
    ]
    if len(prices) < MIN_RANGE_OBSERVATIONS:
        return None
    return round((max(prices) - min(prices)) / start_price * 100, 4)


def compare_realized_ranges(pre_range_pct: Any, post_range_pct: Any) -> Optional[Dict[str, Any]]:
    """Compare equal-duration pre/post ranges, ignoring tiny range changes."""
    try:
        before = float(pre_range_pct)
        after = float(post_range_pct)
    except (TypeError, ValueError):
        return None
    increase = after - before
    return {
        "increase_pct_points": round(increase, 4),
        "range_increased": (
            increase >= MIN_INDEX_RANGE_EXPANSION_PCT
            and after >= before * MIN_INDEX_RANGE_EXPANSION_RATIO
        ),
    }


async def _baseline_snapshot(db, index_id: str, arrival: datetime) -> Optional[Dict[str, Any]]:
    after = (arrival - BASELINE_TOLERANCE).isoformat()
    before = arrival.isoformat()
    cursor = db.oi_snapshots.find(
        {"index": index_id, "timestamp": {"$gte": after, "$lte": before}},
        {"_id": 0, "index": 1, "timestamp": 1, "price": 1, "vix": 1},
    ).sort("timestamp", -1)
    rows = await cursor.to_list(length=100)
    for row in rows:
        try:
            if float(row.get("price")) > 0 and _parse_dt(row.get("timestamp")):
                return row
        except (TypeError, ValueError):
            continue
    return None


async def register_article_evaluation(db, article: Dict[str, Any]) -> None:
    """Save an arrival-time benchmark and target windows for a newly stored story."""
    if db is None:
        return
    from market_intel import directional_market_impact, volatility_risk_read, _safe_int

    arrival = _parse_dt(article.get("discovered_at"))
    if arrival is None:
        return
    direction_read = directional_market_impact(
        str(article.get("title") or ""),
        str(article.get("summary") or ""),
        str(article.get("event_type") or ""),
        _safe_int(article.get("impact_score"), 0),
        _safe_int(article.get("india_relevance_score"), 0),
    )
    direction = direction_read["market_direction"]
    directional_strength = abs(_safe_int(direction_read.get("directional_impact_score"), 0))
    strength_band = directional_strength_band(directional_strength)
    catalyst = classify_volatility_catalyst(
        str(article.get("title") or ""),
        str(article.get("summary") or ""),
        str(article.get("event_type") or ""),
    )
    volatility_read = volatility_risk_read(
        str(article.get("title") or ""),
        str(article.get("summary") or ""),
    )["volatility_risk"]
    from market_intel import _market_timing
    timing = _market_timing(arrival)
    outcomes: Dict[str, Any] = {}
    volatility_outcomes: Dict[str, Any] = {"india_vix": {}, "index_ranges": {}}
    baselines: Dict[str, Any] = {}
    targets = _session_targets(arrival)
    for index_id in DESK_IDS:
        baseline = await _baseline_snapshot(db, index_id, arrival) if timing == "IN_SESSION" else None
        if baseline:
            baselines[index_id] = {
                "timestamp": baseline["timestamp"],
                "price": float(baseline["price"]),
                "vix": _positive_number(baseline.get("vix")),
            }
        else:
            baselines[index_id] = None
        outcomes[index_id] = {}
        for horizon in HORIZONS:
            target_at = targets[horizon]
            applicable = timing == "IN_SESSION" and target_at > arrival
            outcomes[index_id][horizon] = {
                "target_at": target_at.isoformat(),
                "status": "PENDING" if applicable and baseline else (
                    "NO_BASELINE" if applicable else "NOT_APPLICABLE"
                ),
                "snapshot_at": None,
                "price": None,
                "move": None,
                "change_pct": None,
                "direction_hit": None,
            }
            duration = target_at - arrival
            range_applicable = applicable and duration >= timedelta(minutes=5)
            volatility_outcomes["index_ranges"].setdefault(index_id, {})[horizon] = {
                "target_at": target_at.isoformat(),
                "status": "PENDING" if range_applicable and baseline else (
                    "NO_BASELINE" if range_applicable else (
                        "NOT_APPLICABLE" if not applicable else "WINDOW_TOO_SHORT"
                    )
                ),
                "pre_range_pct": None,
                "post_range_pct": None,
                "increase_pct_points": None,
                "range_increased": None,
            }
    vix_baseline = (baselines.get("NIFTY") or {}).get("vix")
    for horizon in HORIZONS:
        target_at = targets[horizon]
        applicable = timing == "IN_SESSION" and target_at > arrival
        volatility_outcomes["india_vix"][horizon] = {
            "target_at": target_at.isoformat(),
            "status": "PENDING" if applicable and vix_baseline else (
                "NO_BASELINE" if applicable else "NOT_APPLICABLE"
            ),
            "baseline": vix_baseline,
            "observed": None,
            "observed_at": None,
            "change_points": None,
            "change_pct": None,
            "material_increase": None,
        }
    event_id = str(article.get("event_cluster_id") or article.get("duplicate_hash") or "")
    if not event_id:
        return
    await db[EVAL_COL].update_one(
        {"event_cluster_id": event_id},
        {
            "$setOnInsert": {
                "event_cluster_id": event_id,
                "arrival_at": arrival,
                "time_class": timing,
                "direction": direction,
                "directional_strength": directional_strength,
                "directional_strength_band": strength_band,
                "volatility_risk": volatility_read,
                "catalyst": catalyst,
                "baselines": baselines,
                "outcomes": outcomes,
                "volatility_outcomes": volatility_outcomes,
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=RETENTION_DAYS),
            }
        },
        upsert=True,
    )


async def _snapshots_near(db, index_id: str, target: datetime) -> list[Dict[str, Any]]:
    low = (target - TARGET_TOLERANCE).isoformat()
    high = (target + TARGET_TOLERANCE).isoformat()
    cursor = db.oi_snapshots.find(
        {"index": index_id, "timestamp": {"$gte": low, "$lte": high}},
        {"_id": 0, "index": 1, "timestamp": 1, "price": 1, "vix": 1},
    ).sort("timestamp", 1)
    return await cursor.to_list(length=500)


async def _snapshots_between(
    db,
    index_id: str,
    start: datetime,
    end: datetime,
) -> list[Dict[str, Any]]:
    low = (start - TARGET_TOLERANCE).isoformat()
    high = (end + TARGET_TOLERANCE).isoformat()
    cursor = db.oi_snapshots.find(
        {"index": index_id, "timestamp": {"$gte": low, "$lte": high}},
        {"_id": 0, "index": 1, "timestamp": 1, "price": 1, "vix": 1},
    ).sort("timestamp", 1)
    return await cursor.to_list(length=1000)


async def resolve_pending_evaluations(db, now: Optional[datetime] = None) -> int:
    """Resolve due target windows from persisted snapshots, without backfilling."""
    if db is None:
        return 0
    now_dt = _parse_dt(now or datetime.now(timezone.utc))
    if now_dt is None:
        raise ValueError("evaluation clock must be a valid datetime")
    pending_fields = [
        f"outcomes.{index_id}.{horizon}.status"
        for index_id in DESK_IDS
        for horizon in HORIZONS
    ]
    pending_fields.extend(
        [f"volatility_outcomes.india_vix.{horizon}.status" for horizon in HORIZONS]
    )
    pending_fields.extend(
        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.status"
        for index_id in DESK_IDS
        for horizon in HORIZONS
    )
    cursor = db[EVAL_COL].find(
        {
            "time_class": "IN_SESSION",
            "expires_at": {"$gt": now_dt},
            "$or": [{field: "PENDING"} for field in pending_fields],
        },
        {"_id": 0},
    ).sort("arrival_at", 1)
    rows = await cursor.to_list(length=5000)
    resolved = 0
    for event in rows:
        patch: Dict[str, Any] = {}
        for index_id in DESK_IDS:
            baseline = (event.get("baselines") or {}).get(index_id)
            if not baseline:
                continue
            base_price = float(baseline["price"])
            for horizon in HORIZONS:
                outcome = ((event.get("outcomes") or {}).get(index_id) or {}).get(horizon) or {}
                if outcome.get("status") != "PENDING":
                    continue
                target = _parse_dt(outcome.get("target_at"))
                if target is None or now_dt < target + TARGET_TOLERANCE:
                    continue
                snapshot = nearest_snapshot(await _snapshots_near(db, index_id, target), target, TARGET_TOLERANCE)
                if snapshot:
                    scored = directional_outcome(str(event.get("direction") or ""), base_price, float(snapshot["price"]))
                    patch.update({
                        f"outcomes.{index_id}.{horizon}.status": "OBSERVED",
                        f"outcomes.{index_id}.{horizon}.snapshot_at": snapshot["timestamp"],
                        f"outcomes.{index_id}.{horizon}.price": float(snapshot["price"]),
                        f"outcomes.{index_id}.{horizon}.move": scored["move"],
                        f"outcomes.{index_id}.{horizon}.change_pct": scored["change_pct"],
                        f"outcomes.{index_id}.{horizon}.direction_hit": scored["direction_hit"],
                    })
                else:
                    patch[f"outcomes.{index_id}.{horizon}.status"] = "NO_SNAPSHOT"
                resolved += 1
        vix_baseline = (event.get("baselines") or {}).get("NIFTY") or {}
        for horizon in HORIZONS:
            vix_outcome = ((event.get("volatility_outcomes") or {}).get("india_vix") or {}).get(horizon) or {}
            if vix_outcome.get("status") == "PENDING":
                target = _parse_dt(vix_outcome.get("target_at"))
                if target is not None and now_dt >= target + TARGET_TOLERANCE:
                    snapshot = nearest_vix_snapshot(
                        await _snapshots_near(db, "NIFTY", target),
                        target,
                        TARGET_TOLERANCE,
                    )
                    if snapshot:
                        measured = india_vix_outcome(vix_baseline.get("vix"), snapshot.get("vix"))
                        if measured:
                            patch.update({
                                f"volatility_outcomes.india_vix.{horizon}.status": "OBSERVED",
                                f"volatility_outcomes.india_vix.{horizon}.observed": _positive_number(snapshot.get("vix")),
                                f"volatility_outcomes.india_vix.{horizon}.observed_at": snapshot["timestamp"],
                                f"volatility_outcomes.india_vix.{horizon}.change_points": measured["change_points"],
                                f"volatility_outcomes.india_vix.{horizon}.change_pct": measured["change_pct"],
                                f"volatility_outcomes.india_vix.{horizon}.material_increase": measured["material_increase"],
                            })
                        else:
                            patch[f"volatility_outcomes.india_vix.{horizon}.status"] = "NO_VIX"
                    else:
                        patch[f"volatility_outcomes.india_vix.{horizon}.status"] = "NO_VIX"
                    resolved += 1
            for index_id in DESK_IDS:
                range_outcome = (
                    ((event.get("volatility_outcomes") or {}).get("index_ranges") or {})
                    .get(index_id, {})
                    .get(horizon, {})
                )
                if range_outcome.get("status") != "PENDING":
                    continue
                target = _parse_dt(range_outcome.get("target_at"))
                arrival = _parse_dt(event.get("arrival_at"))
                if target is None or arrival is None or now_dt < target + TARGET_TOLERANCE:
                    continue
                duration = target - arrival
                pre_start = arrival - duration
                pre_rows = await _snapshots_between(db, index_id, pre_start, arrival)
                post_rows = await _snapshots_between(db, index_id, arrival, target)
                pre_range = realized_range_pct(pre_rows, pre_start, arrival)
                post_range = realized_range_pct(post_rows, arrival, target)
                if pre_range is None or post_range is None:
                    patch[f"volatility_outcomes.index_ranges.{index_id}.{horizon}.status"] = "INSUFFICIENT_DATA"
                else:
                    compared = compare_realized_ranges(pre_range, post_range)
                    if compared is None:
                        patch[f"volatility_outcomes.index_ranges.{index_id}.{horizon}.status"] = "INSUFFICIENT_DATA"
                        resolved += 1
                        continue
                    patch.update({
                        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.status": "OBSERVED",
                        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.pre_range_pct": pre_range,
                        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.post_range_pct": post_range,
                        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.increase_pct_points": compared["increase_pct_points"],
                        f"volatility_outcomes.index_ranges.{index_id}.{horizon}.range_increased": compared["range_increased"],
                    })
                resolved += 1
        if patch:
            await db[EVAL_COL].update_one(
                {"event_cluster_id": event["event_cluster_id"]},
                {"$set": patch},
            )
    return resolved


def summarize_evaluations(events: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Report directional accuracy only after a useful sample exists."""
    # The unique Mongo index normally guarantees this; keep event-level sample
    # counts safe if legacy or test data contains multiple rows for one cluster.
    unique_events: Dict[str, Dict[str, Any]] = {}
    unkeyed_events = []
    for event in events:
        event_id = str(event.get("event_cluster_id") or "")
        if event_id:
            unique_events.setdefault(event_id, event)
        else:
            unkeyed_events.append(event)
    events = list(unique_events.values()) + unkeyed_events
    rows = []
    for index_id in DESK_IDS:
        for horizon in HORIZONS:
            eligible = [
                (event.get("outcomes") or {}).get(index_id, {}).get(horizon, {})
                for event in events
                if event.get("time_class") == "IN_SESSION"
            ]
            scored = [outcome for outcome in eligible if outcome.get("direction_hit") is not None]
            neutral = sum(outcome.get("move") == "FLAT" for outcome in eligible)
            unavailable = sum(
                outcome.get("status") in ("PENDING", "NO_BASELINE", "NO_SNAPSHOT")
                for outcome in eligible
            )
            correct = sum(outcome.get("direction_hit") is True for outcome in scored)
            count = len(scored)
            strength_rows = []
            for band, _, _ in STRENGTH_BANDS:
                band_events = [
                    event for event in events
                    if event.get("time_class") == "IN_SESSION"
                    and event.get("directional_strength_band") == band
                ]
                band_outcomes = [
                    (event.get("outcomes") or {}).get(index_id, {}).get(horizon, {})
                    for event in band_events
                ]
                band_scored = [
                    outcome for outcome in band_outcomes
                    if outcome.get("direction_hit") is not None
                ]
                band_correct = sum(outcome.get("direction_hit") is True for outcome in band_scored)
                band_count = len(band_scored)
                strength_rows.append({
                    "band": band,
                    "sample_count": band_count,
                    "correct_count": band_correct,
                    "accuracy_pct": (
                        round(band_correct / band_count * 100, 1)
                        if band_count >= MIN_SAMPLE_COUNT else None
                    ),
                })
            weak = next(row for row in strength_rows if row["band"] == "WEAK")
            strong = next(row for row in strength_rows if row["band"] == "STRONG")
            strength_comparison = None
            if weak["accuracy_pct"] is not None and strong["accuracy_pct"] is not None:
                difference = round(strong["accuracy_pct"] - weak["accuracy_pct"], 1)
                strength_comparison = {
                    "strong_minus_weak_pct_points": difference,
                    "higher_strength_more_accurate": difference > 0,
                }
            rows.append({
                "index": index_id,
                "horizon": horizon,
                "sample_count": count,
                "correct_count": correct,
                "neutral_count": neutral,
                "unavailable_count": unavailable,
                "accuracy_pct": round(correct / count * 100, 1) if count >= MIN_SAMPLE_COUNT else None,
                "status": "CALIBRATED" if count >= MIN_SAMPLE_COUNT else "BUILDING_SAMPLE",
                "strength_bands": strength_rows,
                "strength_comparison": strength_comparison,
            })
    volatility = summarize_volatility_evaluations(events)
    return {
        "minimum_sample_count": MIN_SAMPLE_COUNT,
        "market_hours_story_count": sum(event.get("time_class") == "IN_SESSION" for event in events),
        "after_hours_story_count": sum(
            event.get("time_class") in ("AFTER_CLOSE", "PRE_OPEN") for event in events
        ),
        "weekend_or_holiday_story_count": sum(
            event.get("time_class") == "WEEKEND_OR_HOLIDAY" for event in events
        ),
        "unknown_timing_story_count": sum(
            event.get("time_class") == "UNKNOWN" for event in events
        ),
        "results": rows,
        "volatility": volatility,
    }


def summarize_volatility_evaluations(events: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    events = [
        event for event in events
        if event.get("time_class") == "IN_SESSION"
        and event.get("volatility_risk") in ("HIGH", "ELEVATED", "LOW")
    ]
    vix_rows = []
    range_rows = []
    catalyst_vix_rows = []
    catalyst_range_rows = []
    for risk_level in ("HIGH", "ELEVATED", "LOW"):
        tier_events = [event for event in events if event.get("volatility_risk") == risk_level]
        for horizon in HORIZONS:
            vix_samples = [
                ((event.get("volatility_outcomes") or {}).get("india_vix") or {}).get(horizon) or {}
                for event in tier_events
            ]
            observed_vix = [row for row in vix_samples if row.get("status") == "OBSERVED"]
            increases = sum(row.get("material_increase") is True for row in observed_vix)
            vix_rows.append({
                "risk_level": risk_level,
                "horizon": horizon,
                "sample_count": len(observed_vix),
                "unavailable_count": sum(
                    row.get("status") in ("NO_BASELINE", "NO_VIX", "INSUFFICIENT_DATA", "WINDOW_TOO_SHORT")
                    for row in vix_samples
                ),
                "material_increase_count": increases,
                "material_increase_pct": (
                    round(increases / len(observed_vix) * 100, 1)
                    if len(observed_vix) >= MIN_SAMPLE_COUNT else None
                ),
                "average_change_points": (
                    round(sum(float(row.get("change_points") or 0) for row in observed_vix) / len(observed_vix), 3)
                    if observed_vix else None
                ),
                "status": "CALIBRATED" if len(observed_vix) >= MIN_SAMPLE_COUNT else "BUILDING_SAMPLE",
            })
            for index_id in DESK_IDS:
                range_samples = [
                    (
                        (event.get("volatility_outcomes") or {})
                        .get("index_ranges", {})
                        .get(index_id, {})
                        .get(horizon, {})
                    )
                    for event in tier_events
                ]
                observed_ranges = [row for row in range_samples if row.get("status") == "OBSERVED"]
                grew_count = sum(row.get("range_increased") is True for row in observed_ranges)
                sample_count = len(observed_ranges)
                range_rows.append({
                    "risk_level": risk_level,
                    "index": index_id,
                    "horizon": horizon,
                    "sample_count": sample_count,
                    "unavailable_count": sum(
                        row.get("status") in ("NO_BASELINE", "INSUFFICIENT_DATA", "WINDOW_TOO_SHORT")
                        for row in range_samples
                    ),
                    "range_increased_count": grew_count,
                    "range_increased_pct": (
                        round(grew_count / sample_count * 100, 1)
                        if sample_count >= MIN_SAMPLE_COUNT else None
                    ),
                    "average_pre_range_pct": (
                        round(sum(float(row["pre_range_pct"]) for row in observed_ranges) / sample_count, 4)
                        if sample_count else None
                    ),
                    "average_post_range_pct": (
                        round(sum(float(row["post_range_pct"]) for row in observed_ranges) / sample_count, 4)
                        if sample_count else None
                    ),
                    "status": "CALIBRATED" if sample_count >= MIN_SAMPLE_COUNT else "BUILDING_SAMPLE",
                })
    for catalyst in VOLATILITY_CATALYSTS:
        catalyst_events = [event for event in events if event.get("catalyst") == catalyst]
        for horizon in HORIZONS:
            vix_samples = [
                ((event.get("volatility_outcomes") or {}).get("india_vix") or {}).get(horizon) or {}
                for event in catalyst_events
            ]
            observed_vix = [row for row in vix_samples if row.get("status") == "OBSERVED"]
            if len(observed_vix) >= MIN_SAMPLE_COUNT:
                increases = sum(row.get("material_increase") is True for row in observed_vix)
                catalyst_vix_rows.append({
                    "catalyst": catalyst,
                    "horizon": horizon,
                    "sample_count": len(observed_vix),
                    "material_increase_pct": round(increases / len(observed_vix) * 100, 1),
                    "average_change_points": round(
                        sum(float(row.get("change_points") or 0) for row in observed_vix)
                        / len(observed_vix),
                        3,
                    ),
                })
            for index_id in DESK_IDS:
                range_samples = [
                    (
                        (event.get("volatility_outcomes") or {})
                        .get("index_ranges", {})
                        .get(index_id, {})
                        .get(horizon, {})
                    )
                    for event in catalyst_events
                ]
                observed_ranges = [row for row in range_samples if row.get("status") == "OBSERVED"]
                if len(observed_ranges) < MIN_SAMPLE_COUNT:
                    continue
                wider_count = sum(row.get("range_increased") is True for row in observed_ranges)
                catalyst_range_rows.append({
                    "catalyst": catalyst,
                    "index": index_id,
                    "horizon": horizon,
                    "sample_count": len(observed_ranges),
                    "range_increased_pct": round(wider_count / len(observed_ranges) * 100, 1),
                    "average_pre_range_pct": round(
                        sum(float(row["pre_range_pct"]) for row in observed_ranges) / len(observed_ranges),
                        4,
                    ),
                    "average_post_range_pct": round(
                        sum(float(row["post_range_pct"]) for row in observed_ranges) / len(observed_ranges),
                        4,
                    ),
                })
    return {
        "india_vix": vix_rows,
        "index_ranges": range_rows,
        "catalysts": {
            "india_vix": catalyst_vix_rows,
            "index_ranges": catalyst_range_rows,
        },
    }


async def performance_summary(db) -> Dict[str, Any]:
    cursor = db[EVAL_COL].find(
        {"expires_at": {"$gt": datetime.now(timezone.utc)}},
        {"_id": 0, "time_class": 1, "direction": 1, "outcomes": 1,
         "directional_strength_band": 1, "catalyst": 1,
         "volatility_risk": 1, "volatility_outcomes": 1, "event_cluster_id": 1},
    ).sort("arrival_at", -1)
    events = await cursor.to_list(length=20000)
    return summarize_evaluations(events)


async def ensure_indexes(db) -> None:
    if db is None:
        return
    await db[EVAL_COL].create_index("event_cluster_id", unique=True)
    await db[EVAL_COL].create_index([("time_class", 1), ("arrival_at", -1)])
    await db[EVAL_COL].create_index("expires_at", expireAfterSeconds=0)
