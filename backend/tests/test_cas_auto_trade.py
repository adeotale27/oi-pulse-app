"""CAS Auto Trade: NSE indicative vs frozen NIFTY, one ATM BUY."""

from datetime import datetime

import pytest

from cas_auto_trade import CasAutoTrade, decide_signal
from cas_indicative_nse import (
    accept_first_indicative,
    extract_indicative,
    extract_indicative_hits,
    indicative_is_sane,
    parse_nse_stamp,
)
from cas_rule_expiry_automation.expiry_calendar import INDEX_META
from cas_rule_expiry_automation.strike_resolver import Leg, StrikeCache, round_atm
from cas_rule_expiry_automation.time_utils import IST


PRE = 23980.55
IND_FIRST = 24007.50  # 15:20:01 CSV
IND_LATER = 24125.20
CLOSE_PRINT = 24055.80


class FakeClient:
    def __init__(self, spot=PRE):
        self.spot = spot
        self.kite = object()
        self.buys = []

    def quote(self, keys):
        key = keys[0]
        return {key: {"last_price": self.spot}}

    def place_market_buy(self, **kwargs):
        self.buys.append(kwargs)
        return "DRY-BUY-1"


def _plant_atm_legs(cache: StrikeCache, spot: float) -> int:
    gap = INDEX_META["NIFTY"]["strike_gap"]
    atm = round_atm(spot, gap)
    for opt in ("CE", "PE"):
        cache._legs[("NIFTY", opt, atm)] = Leg(
            index="NIFTY",
            opt_type=opt,
            strike=atm,
            tradingsymbol=f"NIFTY{atm}{opt}",
            exchange="NFO",
            instrument_token=1,
            lot_size=65,
        )
    return 2


@pytest.fixture
def auto(monkeypatch):
    monkeypatch.setattr(
        StrikeCache,
        "prewarm",
        lambda self, kite, index, spot, ce_steps=0, pe_steps=0, radius=2: _plant_atm_legs(self, spot),
    )
    return CasAutoTrade()


def test_round_atm_from_frozen_live_not_indicative():
    gap = INDEX_META["NIFTY"]["strike_gap"]
    assert round_atm(PRE, gap) == 24000
    assert round_atm(IND_FIRST, gap) == 24000
    # 15:20:30 print would have been a different ATM if we re-rounded from indicative.
    assert round_atm(IND_LATER, gap) == 24150


def test_decide_signal_today_csv_15_fires_ce_50_would_skip():
    sig, delta, opt = decide_signal(
        pre_signal=PRE, indicative=IND_FIRST, bullish_pts=15, bearish_pts=15
    )
    assert opt == "CE"
    assert sig == "BULLISH"
    assert 26 < delta < 28

    sig50, _, opt50 = decide_signal(
        pre_signal=PRE, indicative=IND_FIRST, bullish_pts=50, bearish_pts=50
    )
    assert sig50 == "NO_TRADE"
    assert opt50 is None


def test_decide_signal_bearish_pe():
    sig, delta, opt = decide_signal(
        pre_signal=PRE, indicative=PRE - 20, bullish_pts=15, bearish_pts=15
    )
    assert sig == "BEARISH"
    assert opt == "PE"
    assert delta <= -15


def test_extract_indicative_and_reject_close():
    live = {
        "indicativenifty50": {
            "indexName": "NIFTY 50",
            "indexLast": IND_FIRST,
            "status": "OPEN",
            "indicativeTime": "01-Sep-2026 15:20:01",
        }
    }
    hit = extract_indicative(live)
    assert hit["value"] == IND_FIRST
    assert hit["field"] == "indexLast"

    now = datetime(2026, 9, 1, 15, 20, 2, tzinfo=IST)
    ok, why = indicative_is_sane(hit, now=now)
    assert ok, why

    closed = {
        "indicativenifty50": {
            "indexName": "NIFTY 50",
            "indexLast": CLOSE_PRINT,
            "status": "CLOSE",
        }
    }
    chit = extract_indicative(closed)
    ok2, why2 = indicative_is_sane(chit, now=now)
    assert not ok2
    assert why2 == "stale_close"


def test_inject_buys_locked_atm_ce_once(auto):
    settings = {
        "auto_trade_mode": "paper",
        "auto_trade_enabled": True,
        "lots": 1,
        "product": "NRML",
        "auto_bullish_pts": 15,
        "auto_bearish_pts": 15,
    }
    client = FakeClient()
    snap = auto.inject_indicative(IND_FIRST, settings, client)
    assert snap["status"] == "EXECUTED"
    assert snap["locked_atm"] == 24000
    assert snap["opt_type"] == "CE"
    assert snap["tradingsymbol"] == "NIFTY24000CE"
    assert snap["pre_signal_nifty"] == PRE
    assert client.buys and client.buys[0]["live"] is False
    assert client.buys[0]["tradingsymbol"] == "NIFTY24000CE"

    with pytest.raises(RuntimeError, match="Already executed"):
        auto.inject_indicative(IND_LATER, settings, client)
    assert len(client.buys) == 1


def test_inject_inside_threshold_is_no_trade(auto):
    settings = {
        "auto_trade_mode": "paper",
        "lots": 1,
        "product": "NRML",
        "auto_bullish_pts": 15,
        "auto_bearish_pts": 15,
    }
    client = FakeClient()
    snap = auto.inject_indicative(PRE + 10, settings, client)
    assert snap["status"] == "NO_TRADE"
    assert client.buys == []


def test_inject_refuses_live(auto):
    settings = {"auto_trade_mode": "live"}
    with pytest.raises(RuntimeError, match="Paper"):
        auto.inject_indicative(IND_FIRST, settings, FakeClient())


def test_parse_nse_stamp_keeps_seconds():
    dt = parse_nse_stamp("01-Sep-2026 15:20:01")
    assert dt is not None
    assert dt.hour == 15 and dt.minute == 20 and dt.second == 1
    iso = parse_nse_stamp("2026-09-01T15:20:01.123+05:30")
    assert iso is not None
    assert iso.hour == 15 and iso.minute == 20 and iso.second == 1


def test_extract_hits_skip_frozen_index_last_use_closing_value():
    payload = {
        "indicativenifty50": {
            "indexName": "NIFTY 50",
            "indexLast": PRE,
            "closingValue": IND_FIRST,
            "status": "OPEN",
            "indicativeTime": "01-Sep-2026 15:20:01",
        }
    }
    hits = extract_indicative_hits(payload)
    assert [h["value"] for h in hits] == [PRE, IND_FIRST]
    now = datetime(2026, 9, 1, 15, 20, 2, tzinfo=IST)
    chosen = None
    last_why = None
    for hit in hits:
        ok, why = accept_first_indicative(hit, freeze=PRE, now=now)
        last_why = why
        if ok:
            chosen = hit
            break
    assert chosen is not None, last_why
    assert chosen["field"] == "closingValue"
    assert chosen["value"] == IND_FIRST


def test_closing_value_without_stamp_is_not_first_print():
    payload = {
        "indicativenifty50": {
            "indexName": "NIFTY 50",
            "indexLast": PRE,
            "closingValue": CLOSE_PRINT,
            "status": "OPEN",
        }
    }
    now = datetime(2026, 9, 1, 15, 20, 2, tzinfo=IST)
    chosen = None
    for hit in extract_indicative_hits(payload):
        ok, why = accept_first_indicative(hit, freeze=PRE, now=now)
        if ok:
            chosen = hit
            break
        if hit["field"] == "closingValue":
            assert why == "closing_without_stamp"
    assert chosen is None


def test_reject_frozen_live_print_keep_waiting():
    now = datetime(2026, 9, 1, 15, 20, 1, tzinfo=IST)
    leftover = {
        "value": PRE,
        "field": "indexLast",
        "status": "OPEN",
        "index_name": "NIFTY 50",
        "indicative_time": "01-Sep-2026 15:19:59",
    }
    ok, why = accept_first_indicative(leftover, freeze=PRE, now=now)
    assert not ok
    assert why in ("stamp_before_signal", "same_as_freeze")

    same_px = {
        "value": PRE,
        "field": "indexLast",
        "status": "OPEN",
        "index_name": "NIFTY 50",
        "indicative_time": "01-Sep-2026 15:20:00",
    }
    ok2, why2 = accept_first_indicative(same_px, freeze=PRE, now=now)
    assert not ok2
    assert why2 == "same_as_freeze"

    real = {
        "value": IND_FIRST,
        "field": "indexLast",
        "status": "OPEN",
        "index_name": "NIFTY 50",
        "indicative_time": "01-Sep-2026 15:20:01",
    }
    ok3, why3 = accept_first_indicative(real, freeze=PRE, now=now)
    assert ok3, why3


def test_skip_freeze_then_first_real_print_buys_ce(auto):
    settings = {
        "auto_trade_mode": "paper",
        "lots": 1,
        "product": "NRML",
        "auto_bullish_pts": 15,
        "auto_bearish_pts": 15,
    }
    client = FakeClient()
    auto._prepare(settings, client)
    auto._state["status"] = "ARMED"
    now = datetime(2026, 9, 1, 15, 20, 1, tzinfo=IST)
    leftover = {
        "value": PRE,
        "field": "indexLast",
        "status": "OPEN",
        "index_name": "NIFTY 50",
        "indicative_time": "01-Sep-2026 15:20:00",
        "received_at": now.isoformat(),
    }
    ok, why = accept_first_indicative(leftover, freeze=PRE, now=now)
    assert not ok
    assert auto.snapshot()["status"] == "ARMED"
    assert client.buys == []

    real = {
        "value": IND_FIRST,
        "field": "indexLast",
        "status": "OPEN",
        "index_name": "NIFTY 50",
        "indicative_time": "01-Sep-2026 15:20:01",
        "received_at": now.isoformat(),
    }
    assert accept_first_indicative(real, freeze=PRE, now=now)[0]
    auto._on_indicative(real, settings, client)
    snap = auto.snapshot()
    assert snap["status"] == "EXECUTED"
    assert snap["opt_type"] == "CE"
    assert snap["locked_atm"] == 24000
    assert len(client.buys) == 1
    assert client.buys[0]["live"] is False


def test_prepare_retries_after_kite_blip(auto):
    settings = {"auto_trade_mode": "paper", "lots": 1, "product": "NRML"}
    auto._prepare(settings, client=None)
    assert auto.snapshot()["status"] == "FAILED"
    auto._prepare(settings, FakeClient())
    assert auto.snapshot()["status"] == "PREPARING"
    assert auto.snapshot()["locked_atm"] == 24000
