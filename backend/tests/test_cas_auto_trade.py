"""CAS Auto Trade: NSE indicative vs frozen NIFTY, one ATM BUY."""

from datetime import datetime

import pytest

from cas_auto_trade import CasAutoTrade, decide_signal
from cas_indicative_nse import extract_indicative, indicative_is_sane
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
