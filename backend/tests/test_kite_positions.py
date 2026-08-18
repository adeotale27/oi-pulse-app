"""Kite net/day merge — exited legs must stay flat (Kite Positions parity)."""

from kite_positions import booked_pnl_from_kite_row, merge_kite_net_day


def _row(**kwargs):
    base = {
        "exchange": "NFO",
        "tradingsymbol": "NIFTY2581124150PE",
        "product": "NRML",
        "quantity": 0,
        "overnight_quantity": -325,
        "average_price": 0,
        "last_price": 2.15,
        "pnl": 2957.5,
        "realised": 2957.5,
        "unrealised": 0,
        "buy_quantity": 325,
        "sell_quantity": 325,
        "buy_price": 3.55,
        "sell_price": 12.65,
        "buy_value": 1153.75,
        "sell_value": 4111.25,
        "multiplier": 1,
    }
    base.update(kwargs)
    return base


def test_square_off_carry_forward_keeps_net_flat():
    """Zerodha scenario: CF short squared today → net qty 0, day qty +325."""
    net = [
        _row(
            quantity=0,
            overnight_quantity=-325,
            average_price=0,
            pnl=2957.5,
            realised=2957.5,
        )
    ]
    # Day bucket shows only today's square-off buy (+325), which looks "open"
    # if wrongly preferred over flat net.
    day = [
        _row(
            quantity=325,
            overnight_quantity=0,
            average_price=3.55,
            pnl=-455,
            realised=0,
            unrealised=-455,
            buy_quantity=325,
            sell_quantity=0,
            buy_price=3.55,
            sell_price=0,
            buy_value=1153.75,
            sell_value=0,
        )
    ]
    merged = merge_kite_net_day(net, day)
    assert len(merged) == 1
    row = merged[0]
    assert int(row["quantity"]) == 0, "net quantity must win — exited stays flat"
    assert int(row["day_quantity"]) == 325
    assert float(row["buy_quantity"]) == 325
    # Day buy/sell enrichment when net already has both sides is fine either way;
    # critical invariant is quantity stays 0.


def test_open_position_net_qty_preserved():
    net = [_row(quantity=-325, overnight_quantity=-325, average_price=12.65, buy_quantity=0, sell_quantity=325)]
    day = [_row(quantity=0, overnight_quantity=0, buy_quantity=0, sell_quantity=0)]
    merged = merge_kite_net_day(net, day)
    assert len(merged) == 1
    assert int(merged[0]["quantity"]) == -325


def test_merge_tolerates_shadowed_net_float():
    """Regression: margins code once overwrote positions net with equity float → 500."""
    day = [_row(quantity=-50, buy_quantity=0, sell_quantity=50)]
    # Float net must not TypeError; treated as empty net so day-only rows still merge.
    merged = merge_kite_net_day(12345.67, day)
    assert len(merged) == 1
    assert int(merged[0]["quantity"]) == -50
    assert merge_kite_net_day(None, None) == []
    assert merge_kite_net_day("bad", []) == []



def test_booked_pnl_exited_uses_buy_sell_value():
    bits = booked_pnl_from_kite_row(
        qty=0,
        buy_qty=325,
        sell_qty=325,
        buy_price=3.55,
        sell_price=12.65,
        pnl=0,
        realised=0,
        unrealised=0,
        exited=True,
        buy_value=1153.75,
        sell_value=4111.25,
        last_price=2.15,
        multiplier=1,
    )
    assert bits["booked_pnl"] == 2957.5
    assert bits["pnl"] == 2957.5
    assert bits["unrealised"] == 0.0


def test_booked_pnl_exited_prefers_realised():
    bits = booked_pnl_from_kite_row(
        qty=0,
        buy_qty=325,
        sell_qty=325,
        buy_price=3.55,
        sell_price=12.65,
        pnl=100,
        realised=2957.5,
        unrealised=0,
        exited=True,
    )
    assert bits["booked_pnl"] == 2957.5
    assert bits["pnl_source"] == "realised"


def test_partial_close_books_kite_realised():
    """Still-open short, some lots bought back today — realised is booked, MTM is not."""
    bits = booked_pnl_from_kite_row(
        qty=-650,
        buy_qty=195,
        sell_qty=845,
        buy_price=40.0,
        sell_price=80.0,
        pnl=19000.0,
        realised=12600.0,
        unrealised=6400.0,
        exited=False,
    )
    assert bits["partial"] is True
    assert bits["closed_quantity"] == 195
    assert bits["booked_pnl"] == 12600.0
    assert bits["realised"] == 12600.0
    assert bits["pnl"] == 19000.0


def test_partial_close_falls_back_to_matched_buy_sell():
    bits = booked_pnl_from_kite_row(
        qty=-650,
        buy_qty=195,
        sell_qty=845,
        buy_price=40.0,
        sell_price=80.0,
        pnl=19000.0,
        realised=0,
        unrealised=6400.0,
        exited=False,
        last_price=50.0,
        mark_to_market=True,
    )
    assert bits["partial"] is True
    # (80 - 40) * 195 — closed lots only, not pnl minus a lagging unrealised.
    assert bits["booked_pnl"] == 7800.0
    # MTM can move; booked must not.
    bits2 = booked_pnl_from_kite_row(
        qty=-650,
        buy_qty=195,
        sell_qty=845,
        buy_price=40.0,
        sell_price=80.0,
        pnl=19000.0,
        realised=0,
        unrealised=6400.0,
        exited=False,
        last_price=20.0,
        mark_to_market=True,
    )
    assert bits2["booked_pnl"] == bits["booked_pnl"]


def test_booked_today_from_row_sums_exit_and_partial():
    from kite_positions import booked_today_from_row
    assert booked_today_from_row({"exited": True, "booked_pnl": 8400}) == 8400.0
    assert booked_today_from_row({"exited": False, "realised": 12600, "pnl": 19000, "booked_pnl": 12600}) == 12600.0
    assert booked_today_from_row({"exited": False, "realised": 0, "pnl": 800, "booked_pnl": 0}) == 0.0


def test_open_mtm_prefers_quote_over_stale_kite_pnl():
    bits = booked_pnl_from_kite_row(
        qty=-50,
        buy_qty=0,
        sell_qty=50,
        buy_price=0,
        sell_price=100,
        pnl=800,
        realised=0,
        unrealised=800,
        exited=False,
        buy_value=0,
        sell_value=5000,
        last_price=80,
        multiplier=1,
        mark_to_market=True,
    )
    # (5000 - 0) + (-50 * 80) = 1000, not stale kite 800
    assert bits["pnl"] == 1000.0
    assert bits["pnl_source"] == "quote_mtm"
    assert bits["booked_pnl"] == 0.0


def test_open_mtm_does_not_move_booked_when_ltp_changes():
    kwargs = dict(
        qty=-25,
        buy_qty=25,
        sell_qty=50,
        buy_price=80,
        sell_price=100,
        pnl=0,
        realised=500,
        unrealised=0,
        exited=False,
        buy_value=2000,
        sell_value=5000,
        multiplier=1,
        mark_to_market=True,
    )
    a = booked_pnl_from_kite_row(**kwargs, last_price=90)
    b = booked_pnl_from_kite_row(**kwargs, last_price=40)
    assert a["booked_pnl"] == b["booked_pnl"] == 500.0
    assert a["pnl"] != b["pnl"]


def test_apply_live_ltp_updates_open_row():
    from kite_positions import apply_live_ltp_to_open_rows
    row = {
        "exited": False,
        "exchange": "NFO",
        "tradingsymbol": "NIFTY2581824200PE",
        "quantity": -50,
        "buy_quantity": 0,
        "sell_quantity": 50,
        "buy_price": 0,
        "sell_price": 100,
        "pnl": 800,
        "realised": 0,
        "unrealised": 800,
        "buy_value": 0,
        "sell_value": 5000,
        "last_price": 90,
        "multiplier": 1,
    }
    apply_live_ltp_to_open_rows(
        [row],
        {"NFO:NIFTY2581824200PE": {"last_price": 80}},
    )
    assert row["last_price"] == 80
    assert row["pnl"] == 1000.0

