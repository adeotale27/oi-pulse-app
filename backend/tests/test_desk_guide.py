from desk_guide import compact_snapshot, compose_rules_guide, llm_configured, reset_cache, status, carry_outside
import asyncio
from desk_guide import maybe_guide


def test_compact_strips_noise_and_caps_lists():
    snap = compact_snapshot({
        "why": ["a" * 400, "ok"],
        "whyNot": ["gap"],
        "results": [{"name": "MAXHEALTH", "date": "2026-08-14", "token": "SECRET"}] * 20,
        "book": {"openCount": 2, "shortCount": 2, "byIndex": {"NIFTY": {"ce": 1, "pe": 1, "n": 2}}},
        "vix": "11.4",
        "giftPct": "-0.12",
        "weekday": 5,
        "band": "REDUCE",
        "journal": {
            "booked_pnl": 1200,
            "win_rate": 55,
            "trading_days": 12,
            "access_token": "nope",
        },
        "memory": {
            "lines": ["NIFTY CE shorts on Friday: 5/7 paid (71%)"],
            "token": "SECRET",
        },
        "sells": [{"s": "NIFTY 24300 CE", "why": "IV Rank 72, fresh writing", "token": "x", "chain": [1]}],
        "kite_access_token": "should-not-copy",
        "fii": {"date": "2026-08-13", "fiiNet": "-1200.5", "diiNet": "800", "secret": "x"},
        "oi": [{
            "idx": "NIFTY", "px": 24501.2, "atm": 24500, "pcr": 0.92,
            "ceChg": 120000, "peChg": -30000, "callWall": 24600, "putWall": 24300,
            "strikes": [{"strike": 1, "ce_oi": 9}],
        }],
        "outside": {
            "movers": [{"symbol": "RELIANCE", "pct": -1.5, "weightage": 9, "token": "x"}],
            "news": [{"title": "RBI", "url": "http://secret"}],
        },
        "adjust": {
            "netDelta": "12.4",
            "adjustCount": 1,
            "shortCount": 2,
            "kite_access_token": "nope",
            "legs": [{"s": "NIFTY25814C24500", "side": "CE", "K": 24500, "close": True, "itm": False, "token": "x"}] * 12,
        },
    })
    assert "kite_access_token" not in snap
    assert snap["adjust"] is not None
    assert "kite_access_token" not in snap["adjust"]
    assert snap["fii"]["fiiNet"] == -1200.5
    assert "secret" not in snap["fii"]
    assert len(snap["why"][0]) <= 240
    assert len(snap["results"]) == 8
    assert len(snap["adjust"]["legs"]) == 8
    assert "token" not in snap["adjust"]["legs"][0]
    assert snap["book"]["byIndex"]["NIFTY"]["pe"] == 1
    assert snap["vix"] == 11.4
    assert snap["memory"]["lines"][0].startswith("NIFTY CE")
    assert "token" not in snap["memory"]
    assert snap["sells"][0]["s"] == "NIFTY 24300 CE"
    assert "token" not in snap["sells"][0]
    assert "chain" not in snap["sells"][0]
    assert "SECRET" not in str(snap["results"])
    assert snap["oi"][0]["idx"] == "NIFTY"
    assert "strikes" not in snap["oi"][0]
    assert snap["outside"]["movers"][0]["symbol"] == "RELIANCE"
    assert "token" not in snap["outside"]["movers"][0]
    assert "url" not in snap["outside"]["news"][0]


def test_rules_guide_mentions_results():
    text = compose_rules_guide({
        "surface": "carry",
        "why": ["VIX calm"],
        "whyNot": ["Friday gap"],
        "holidays": [{"name": "Ganesh Chaturthi"}],
        "outside": {
            "movers": [{"symbol": "RELIANCE", "pct": -1.8, "weightage": 9.1, "impact": -0.164}],
            "events": [{"priority": "HIGH", "event": "MAXHEALTH result tomorrow", "symbol": "MAXHEALTH"}],
        },
    })
    assert "MAXHEALTH" in text
    assert "RELIANCE" in text
    assert "DO" in text
    assert "DON'T" in text or "DONT" in text.replace("'", "")
    assert "WHAT CHANGED" not in text
    assert "OPTION BUYER" not in text
    assert "Why carry" not in text


def test_rules_guide_adjust_first():
    text = compose_rules_guide({
        "adjust": {
            "netDelta": 22,
            "adjustCount": 1,
            "shortCount": 2,
            "legs": [{"s": "NIFTY25814C24500", "side": "CE", "K": 24500, "close": True, "itm": False}],
        },
    })
    assert "Adjust first" in text
    assert "NIFTY25814C24500" in text
    assert "Net Δ" in text
    assert "Why carry" not in text


def test_rules_guide_uses_outside_tape_not_oi_dump():
    text = compose_rules_guide({
        "oi": [{
            "idx": "NIFTY", "px": 24500, "atm": 24500, "pcr": 1.25,
            "ceChg": 80000, "peChg": 120000, "callWall": 24600, "putWall": 24300,
        }],
        "outside": {
            "movers": [{
                "symbol": "RELIANCE", "pct": -1.8, "weightage": 9.1, "index": "NIFTY",
                "note": "9.1% wt dumping — index can slip the put wall; do not add PE shorts",
            }],
            "news": [{"title": "RBI holds rates, rupee slides"}],
        },
    })
    assert "RELIANCE" in text
    assert "RBI" in text
    assert "PCR 1.25" in text
    assert "WHAT CHANGED" in text or "TAPE" in text or "DO" in text
    assert "Why carry" not in text


def test_carry_desk_radar_guides_differ():
    carry = compose_rules_guide({
        "surface": "carry",
        "why": ["VIX calm"],
        "whyNot": ["Friday gap"],
        "outside": {"movers": [{"symbol": "RELIANCE", "pct": -1.8, "weightage": 9.1, "impact": -0.164}]},
    })
    desk = compose_rules_guide({
        "surface": "desk",
        "outside": {"movers": [{"symbol": "RELIANCE", "pct": -1.8, "index": "NIFTY"}]},
    })
    radar = compose_rules_guide({
        "surface": "positions",
        "adjust": {"shortCount": 2, "adjustCount": 0, "netDelta": 1},
        "outside": {"movers": [{"symbol": "RELIANCE", "pct": -1.8}]},
    })
    assert "RELIANCE" in carry
    assert "DO" in carry
    assert "WHAT CHANGED" not in carry
    assert "OPTION BUYER" not in carry
    assert "RELIANCE" in desk
    assert "TAPE" in desk or "WHAT CHANGED" in desk or "DO" in desk
    assert "Why carry" not in desk
    assert "still OK" in radar or "WATCH NEXT" in radar
    assert carry != desk
    assert radar != desk
    assert compact_snapshot({"surface": "desk-panel"})["surface"] == "desk"


def test_carry_outside_keeps_impact_only():
    pack = carry_outside({
        "movers": [
            {"symbol": "RELIANCE", "pct": -1.8, "weightage": 9.1},
            {"symbol": "TINY", "pct": 0.2, "weightage": 0.4},
        ],
        "news": [
            {"title": "RBI holds rates"},
            {"title": "A random stock up 2%"},
        ],
        "events": [
            {"priority": "HIGH", "event": "HDFCBANK result tomorrow"},
            {"priority": "LOW", "event": "ignore me"},
        ],
        "breadth": {"NIFTY": {"adv": 9, "n": 48}},
    })
    assert [m["symbol"] for m in pack["movers"]] == ["RELIANCE"]
    assert pack["news"][0]["title"].startswith("RBI")
    assert len(pack["news"]) == 1
    assert pack["events"][0]["event"].startswith("HDFCBANK")
    assert "breadth" not in pack


def test_skip_llm_even_if_key(monkeypatch):
    reset_cache()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    async def boom(_snap):
        raise AssertionError("LLM must not run when skip_llm")

    monkeypatch.setattr("desk_guide._call_llm", boom)

    async def run():
        return await maybe_guide({
            "surface": "desk",
            "skip_llm": True,
            "outside": {"movers": [{"symbol": "HDFCBANK", "pct": 1.5, "weightage": 11}]},
        })

    out = asyncio.run(run())
    assert out["source"] == "rules"
    assert "HDFCBANK" in out["guide"]


def test_status_without_key(monkeypatch):
    reset_cache()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DESK_GUIDE_API_KEY", raising=False)
    assert llm_configured() is False
    st = status()
    assert st["enabled"] is False
    assert st["source"] == "rules"


def test_cache_is_per_surface(monkeypatch):
    reset_cache()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DESK_GUIDE_API_KEY", raising=False)

    async def run():
        carry = await maybe_guide({
            "surface": "carry",
            "outside": {"events": [{"priority": "HIGH", "event": "VIX calm overnight"}]},
        })
        pos = await maybe_guide({
            "surface": "positions",
            "adjust": {
                "adjustCount": 1,
                "shortCount": 1,
                "legs": [{"s": "BANKNIFTY", "side": "PE", "K": 55000, "itm": True}],
            },
        })
        again = await maybe_guide({
            "surface": "carry",
            "outside": {"events": [{"priority": "HIGH", "event": "should refresh"}]},
        })
        forced = await maybe_guide({
            "surface": "carry",
            "force": True,
            "outside": {"events": [{"priority": "HIGH", "event": "forced"}]},
        })
        return carry, pos, again, forced

    carry, pos, again, forced = asyncio.run(run())
    assert again.get("cached") is False
    assert "should refresh" in again["guide"]
    assert forced.get("cached") is False
    assert "forced" in forced["guide"]
    assert "VIX calm" in carry["guide"]
    assert "Adjust first" in pos["guide"]
    assert carry["guide"] != pos["guide"]


def test_desk_guide_uses_oi_journal_and_greeks():
    text = compose_rules_guide({
        "surface": "desk",
        "session_focus": "NIFTY",
        "oi": [{
            "idx": "NIFTY", "px": 24219, "atm": 24200, "pcr": 0.71,
            "ceChg": 535800, "peChg": -94500, "callWall": 24300, "putWall": 24000,
        }],
        "book": {"shortCount": 7, "openCount": 7, "byIndex": {"NIFTY": {"ce": 4, "pe": 3, "n": 7}}},
        "adjust": {"netDelta": -18, "netTheta": 420, "avgIv": 14.5, "shortCount": 7, "adjustCount": 0},
        "journal": {"booked_pnl": 25400, "win_rate": 62, "trading_days": 11},
        "outside": {"news": [{"title": "Nifty ends in the red"}]},
    })
    assert "TAPE" in text
    assert "PCR 0.71" in text
    assert "call writers" in text
    assert "BOOK" in text
    assert "JOURNAL" in text
    assert "DO" in text
    assert "CE shorts" in text

    carry = compose_rules_guide({
        "surface": "carry",
        "band": "REDUCE",
        "vix": 19.2,
        "giftPct": -0.4,
        "adjust": {"netDelta": 22, "avgIv": 24, "netTheta": 200, "shortCount": 4, "adjustCount": 0,
                   "legs": [{"s": "NIFTY25C24500", "side": "CE", "K": 24500, "itm": True, "close": True}]},
        "oi": [{"idx": "NIFTY", "ceChg": 100, "peChg": 10, "pcr": 0.8}],
        "journal": {"win_rate": 55, "trading_days": 8, "booked_pnl": 12000},
    })
    assert "DON'T" in carry or "DONT" in carry.replace("'", "")
    assert "VIX" in carry
    assert "Adjust first" in carry
    assert "Journal" in carry


def test_named_hold_cut_and_sells_memory():
    from desk_guide import named_leg_actions

    named = named_leg_actions({
        "legs": [
            {"s": "NIFTY25AUG24300CE", "side": "CE", "itm": False, "close": False},
            {"s": "NIFTY25AUG24400PE", "side": "PE", "itm": False, "close": False},
            {"s": "NIFTY25AUG24200CE", "side": "CE", "itm": True, "close": True},
            {"s": "NIFTY25AUG24100PE", "side": "PE", "itm": False, "close": True},
        ],
    }, "call_writers")
    assert named["holds"] == ["NIFTY25AUG24300CE"]
    assert named["fight"] == ["NIFTY25AUG24400PE"]
    assert named["cuts"] == ["NIFTY25AUG24200CE"]
    assert named["rolls"] == ["NIFTY25AUG24100PE"]

    carry = compose_rules_guide({
        "surface": "carry",
        "index": "NIFTY",
        "oi": [{"idx": "NIFTY", "ceChg": 100000, "peChg": 1000}],
        "adjust": {"legs": [
            {"s": "NIFTY25AUG24300CE", "side": "CE"},
            {"s": "NIFTY25AUG24400PE", "side": "PE"},
        ]},
        "memory": {"lines": ["NIFTY CE shorts on Friday: 5/7 paid (71%)"]},
    })
    assert "Hold NIFTY25AUG24300CE" in carry
    assert "NIFTY25AUG24400PE" in carry
    assert "Book memory" in carry

    desk = compose_rules_guide({
        "surface": "desk",
        "sells": [{"s": "NIFTY 24300 CE", "why": "IV Rank 72, fresh writing"}],
        "oi": [{"idx": "NIFTY", "ceChg": 1, "peChg": 9}],
    })
    assert "Sell ideas (your ranker)" in desk
    assert "IV Rank 72" in desk

    radar = compose_rules_guide({
        "surface": "positions",
        "adjust": {
            "netDelta": 22,
            "shortCount": 2,
            "adjustCount": 1,
            "legs": [{"s": "NIFTY25814C24500", "side": "CE", "itm": True, "close": True}],
        },
    })
    assert "Buy back / roll: NIFTY25814C24500" in radar
    assert "Hedge |Δ|" in radar


def test_desk_put_writers_marks_short_calls_as_fight():
    from desk_guide import _tape_side_from_oi, named_leg_actions

    snap = {"oi": [{"idx": "NIFTY", "ceChg": -10000, "peChg": 200000}]}
    assert _tape_side_from_oi(snap) == "put_writers"
    named = named_leg_actions(
        {
            "legs": [
                {"s": "NIFTY24000CE", "side": "CE", "close": False, "itm": False},
                {"s": "NIFTY23800PE", "side": "PE", "close": False, "itm": False},
            ]
        },
        "put_writers",
    )
    assert "NIFTY23800PE" in named["holds"]
    assert "NIFTY24000CE" in named["fight"]

