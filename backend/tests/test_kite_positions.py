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
