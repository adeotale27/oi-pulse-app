"""Deterministic, compact price/level interaction memory from existing OI snapshots."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

EVENTS_COL = "market_memory_events"
STATE_COL = "market_memory_state"
TRACKED = frozenset({"NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"})
STRUCTURE = {
    "NIFTY": (50, 10),
    "SENSEX": (100, 10),
    "BANKNIFTY": (100, 15),
    "FINNIFTY": (50, 10),
}


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _market_context(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only small, non-sensitive context already present in the OI snapshot."""
    context = {}
    for key in ("price", "pcr", "vix", "expiry", "mode"):
        value = snapshot.get(key)
        if value is not None and value != "":
            context[key] = value
    return context


def _levels(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Small, explainable level set — all values originate in the OI/Kite snapshot."""
    price = _number(snapshot.get("price"))
    step = max(1, int(abs(_number(snapshot.get("atm")) or 50) * 0 + 50))
    result = []
    for kind, raw in (("PREVIOUS_CLOSE", snapshot.get("prev_close")), ("ATM", snapshot.get("atm"))):
        value = _number(raw)
        if value:
            result.append({"level": value, "levelType": kind})
    # The opening range is built from the same existing snapshots, not a second feed.
    state = snapshot.get("_market_memory_day") or {}
    for kind in ("DAY_HIGH", "DAY_LOW"):
        value = _number(state.get(kind))
        if value:
            result.append({"level": value, "levelType": kind})
    strikes = snapshot.get("strikes") if isinstance(snapshot.get("strikes"), list) else []
    if strikes:
        ce = max(strikes, key=lambda row: _number(row.get("ce_oi")) or 0)
        pe = max(strikes, key=lambda row: _number(row.get("pe_oi")) or 0)
        for kind, row in (("CALL_OI", ce), ("PUT_OI", pe)):
            value = _number(row.get("strike"))
            if value:
                result.append({"level": value, "levelType": kind, "oi": (_number(row.get("ce_oi")) or 0) + (_number(row.get("pe_oi")) or 0)})
    seen = set()
    return [row for row in result if not (row["level"] in seen or seen.add(row["level"]))]


async def ensure_indexes(db) -> None:
    if db is None:
        return
    await db[EVENTS_COL].create_index([("index", 1), ("timestamp", -1)])
    await db[EVENTS_COL].create_index([("index", 1), ("level", 1), ("timestamp", -1)])


async def capture(db, index: str, snapshot: Dict[str, Any]) -> None:
    """Record touch then classify only after a measurable, reproducible reaction.

    A touch band is max(5 points, 0.02% of spot); a reaction needs two bands.
    This explicitly prevents a single touch being misreported as a rejection.
    """
    if db is None or index not in TRACKED:
        return
    price = _number(snapshot.get("price"))
    if price is None:
        return
    now = str(snapshot.get("timestamp") or datetime.now(timezone.utc).isoformat())
    state = await db[STATE_COL].find_one({"_id": index}) or {"_id": index, "active": {}, "day": ""}
    day = now[:10]
    if state.get("day") != day:
        state["day"] = day
        state["day_high"] = price
        state["day_low"] = price
    state["day_high"] = max(_number(state.get("day_high")) or price, price)
    state["day_low"] = min(_number(state.get("day_low")) or price, price)
    snapshot = {**snapshot, "_market_memory_day": {"DAY_HIGH": state["day_high"], "DAY_LOW": state["day_low"]}}
    previous_price = _number(state.get("previous_price"))
    band = max(5.0, abs(price) * 0.0002)
    reaction = band * 2
    active = state.get("active") if isinstance(state.get("active"), dict) else {}
    levels = _levels(snapshot)
    level_keys = set()
    for row in levels:
        level, level_type = row["level"], row["levelType"]
        key = str(round(level, 2))
        level_keys.add(key)
        prior = active.get(key)
        distance = price - level
        near = abs(distance) <= band
        if near and not prior:
            approach = "UP" if previous_price is not None and previous_price < level else "DOWN"
            event = {"index": index, "level": level, "levelType": level_type, "timestamp": now,
                     "interactionType": "TOUCH", "priceAtInteraction": price, "approachDirection": approach,
                     "priceBeforeInteraction": previous_price, "reaction5m": None, "reaction15m": None,
                     "reaction30m": None, "volume": None, "oi": row.get("oi"), "oiChange": None,
                     "context": _market_context(snapshot), "source": "kite_oi_snapshot", "dataQuality": "live"}
            await db[EVENTS_COL].insert_one(event)
            active[key] = {"level": level, "type": level_type, "touch": price, "approach": approach, "timestamp": now}
        elif prior and prior.get("phase") == "breakout":
            # A breakout is only marked failed when price returns through the
            # level by a full touch band; ordinary retracements stay neutral.
            approach = prior.get("approach")
            failed = (approach == "UP" and price < level - band) or (approach == "DOWN" and price > level + band)
            if failed:
                await db[EVENTS_COL].insert_one({"index": index, "level": level, "levelType": level_type, "timestamp": now,
                    "interactionType": "FAILED_BREAKOUT", "priceAtInteraction": price, "approachDirection": approach,
                    "priceBeforeInteraction": prior.get("breakout_price"), "reaction5m": round(price - prior.get("breakout_price", price), 2),
                    "reaction15m": None, "reaction30m": None, "volume": None, "oi": row.get("oi"), "oiChange": None,
                    "context": _market_context(snapshot), "source": "kite_oi_snapshot", "dataQuality": "live"})
                active.pop(key, None)
        elif prior and abs(distance) >= reaction:
            approach = prior.get("approach")
            crossed = (approach == "UP" and price > level + band) or (approach == "DOWN" and price < level - band)
            interaction = "BREAKOUT" if crossed else "REJECTION"
            event = {"index": index, "level": level, "levelType": level_type, "timestamp": now,
                     "interactionType": interaction, "priceAtInteraction": price, "approachDirection": approach,
                     "priceBeforeInteraction": prior.get("touch"), "reaction5m": round(price - prior.get("touch", price), 2),
                     "reaction15m": None, "reaction30m": None, "volume": None, "oi": row.get("oi"), "oiChange": None,
                     "context": _market_context(snapshot), "source": "kite_oi_snapshot", "dataQuality": "live"}
            await db[EVENTS_COL].insert_one(event)
            if interaction == "BREAKOUT":
                active[key] = {**prior, "phase": "breakout", "breakout_price": price}
            else:
                active.pop(key, None)
    # Levels that disappear from the live OI window do not remain armed.
    active = {key: value for key, value in active.items() if key in level_keys}
    await db[STATE_COL].update_one({"_id": index}, {"$set": {"active": active, "previous_price": price, "day": state["day"], "day_high": state["day_high"], "day_low": state["day_low"], "updated_at": now}}, upsert=True)


async def summary(db, index: str) -> Dict[str, Any]:
    if index not in TRACKED:
        return {"index": index, "levels": [], "interactions": []}
    state = await db[STATE_COL].find_one({"_id": index}) if db is not None else None
    price = _number((state or {}).get("previous_price"))
    docs = await db[EVENTS_COL].find({"index": index}, {"_id": 0}).sort("timestamp", -1).to_list(500) if db is not None else []
    by_level: Dict[float, List[Dict[str, Any]]] = {}
    now = datetime.now(timezone.utc)
    step, tolerance = STRUCTURE.get(index, (50, 10))
    for event in docs:
        raw = _number(event.get("level"))
        if raw is None:
            continue
        anchor = round(raw / step) * step
        if abs(raw - anchor) <= tolerance:
            by_level.setdefault(float(anchor), []).append({**event, "rawLevel": raw})
    levels = []
    for level, events in by_level.items():
        dated = [(event, datetime.fromisoformat(str(event["timestamp"]).replace("Z", "+00:00"))) for event in events]
        count5 = sum(1 for _, stamp in dated if stamp >= now - timedelta(days=5))
        count20 = sum(1 for _, stamp in dated if stamp >= now - timedelta(days=20))
        meaningful = []
        for event, stamp in sorted(dated, key=lambda item: item[1]):
            if not meaningful or (stamp - meaningful[-1][1]).total_seconds() >= 300:
                meaningful.append((event, stamp))
        kinds = {kind: sum(1 for event, _ in meaningful if event["interactionType"] == kind) for kind in ("TOUCH", "REJECTION", "BREAKOUT", "FAILED_BREAKOUT")}
        reactions = [_number(event.get("reaction5m")) for event in events if event.get("reaction5m") is not None]
        reactions = [value for value in reactions if value is not None]
        recent_reactions = [abs(value) for event, stamp in dated if stamp >= now - timedelta(days=5) for value in [_number(event.get("reaction5m"))] if value is not None]
        older_reactions = [abs(value) for event, stamp in dated if stamp >= now - timedelta(days=20) for value in [_number(event.get("reaction5m"))] if value is not None]
        last = events[0]
        recency = max(0.0, 1.0 - (now - dated[-1][1]).total_seconds() / 21600)
        score = min(100, round(20 + min(30, kinds["REJECTION"] * 8 + kinds["FAILED_BREAKOUT"] * 6)
                              + min(25, kinds["TOUCH"] * 5) + recency * 25))
        if score < 30:
            continue
        role = "SUPPORT" if price is not None and level <= price and kinds["REJECTION"] else (
            "RESISTANCE" if kinds["REJECTION"] else "STRUCTURAL")
        total_break_tests = kinds["REJECTION"] + kinds["BREAKOUT"] + kinds["FAILED_BREAKOUT"]
        failed_breakouts = kinds["FAILED_BREAKOUT"]
        avg_signed = round(sum(reactions) / len(reactions), 2) if reactions else None
        levels.append({"level": level, "zoneLow": level - tolerance, "zoneHigh": level + tolerance,
                       "levelType": role, "strength": "HIGH" if score >= 70 else "MEDIUM",
                       "relevanceScore": score, "todayCount": sum(1 for _, stamp in dated if stamp.date() == now.date()), "5DayCount": count5, "20DayCount": count20,
                       "touchCount": kinds["TOUCH"], "rejectionCount": kinds["REJECTION"], "breakoutCount": kinds["BREAKOUT"], "failedBreakoutCount": kinds["FAILED_BREAKOUT"],
                       "averageReaction": round(sum(abs(value) for value in reactions) / len(reactions), 2) if reactions else None,
                       "averageSignedReaction": avg_signed,
                       "averageUpReaction": round(sum(value for value in reactions if value > 0) / len([value for value in reactions if value > 0]), 2) if any(value > 0 for value in reactions) else None,
                       "averageDownReaction": round(sum(value for value in reactions if value < 0) / len([value for value in reactions if value < 0]), 2) if any(value < 0 for value in reactions) else None,
                       "recentAverageReaction": round(sum(recent_reactions) / len(recent_reactions), 2) if recent_reactions else None,
                       "historicalAverageReaction": round(sum(older_reactions) / len(older_reactions), 2) if older_reactions else None,
                       "largestReaction": max((abs(value) for value in reactions), default=None),
                       "failureRate": round((kinds["BREAKOUT"] / total_break_tests) * 100, 1) if total_break_tests else None,
                       "failedBreakoutRate": round((failed_breakouts / (kinds["BREAKOUT"] + failed_breakouts)) * 100, 1) if (kinds["BREAKOUT"] + failed_breakouts) else None,
                       "lastInteraction": last.get("timestamp"), "lastInteractionType": last.get("interactionType"), "lastContext": last.get("context") or {},
                       "currentDistance": round(price - level, 2) if price is not None else None,
                       "memoryStrength": score})
    levels.sort(key=lambda row: (abs(row["currentDistance"]) if row["currentDistance"] is not None else float("inf"), -row["relevanceScore"]))
    updated_at = (state or {}).get("updated_at")
    freshness_seconds = None
    if updated_at:
        try:
            freshness_seconds = max(0, round((now - datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))).total_seconds()))
        except (TypeError, ValueError):
            freshness_seconds = None
    return {"index": index, "price": price, "updatedAt": updated_at, "freshnessSeconds": freshness_seconds,
            "structure": {"step": step, "tolerance": tolerance},
            "levels": levels[:6], "interactions": docs[:100]}
