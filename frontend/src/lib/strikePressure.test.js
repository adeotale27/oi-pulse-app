import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  scoreStrikePressure,
  positionImpact,
  computeStrikePressureForRow,
  PRESSURE_LABELS,
  computeAllStrikePressure,
  resetStrikePressureState,
} from "./strikePressure.js";

function pos(over = {}) {
  return {
    tradingsymbol: "X",
    isOpt: true,
    exited: false,
    index: "IDX_A",
    side: "PE",
    isShort: true,
    strike: 23100,
    spotUsed: 23201,
    expiry_iso: "2026-09-15",
    expiryIso: "2026-09-15",
    last_price: 4.2,
    ...over,
  };
}

beforeEach(() => resetStrikePressureState());

describe("strike pressure", () => {
  it("SHORT PE toward → TOWARD + HIGH RISK / CAUTION", () => {
    const s = scoreStrikePressure({ spot: 23090, strike: 23150, optionType: "PE", prevAbsDistance: 180 });
    assert.equal(pressureToward(s), true);
    assert.ok(["CAUTION", "HIGH RISK"].includes(positionImpact({ isShort: true, label: s.label })));
  });

  it("SHORT PE away → AWAY + FAVOURABLE", () => {
    const s = scoreStrikePressure({ spot: 22800, strike: 23150, optionType: "PE", prevAbsDistance: 90 });
    assert.equal(s.label, PRESSURE_LABELS.away);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "FAVOURABLE");
  });

  it("SHORT CE toward → caution/high risk", () => {
    const s = scoreStrikePressure({ spot: 23200, strike: 23150, optionType: "CE", prevAbsDistance: 200 });
    assert.equal(pressureToward(s), true);
    assert.ok(["CAUTION", "HIGH RISK"].includes(positionImpact({ isShort: true, label: s.label })));
  });

  it("SHORT CE away → favourable", () => {
    const s = scoreStrikePressure({ spot: 22900, strike: 23150, optionType: "CE", prevAbsDistance: 50 });
    assert.equal(s.label, PRESSURE_LABELS.away);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "FAVOURABLE");
  });

  it("LONG CE toward → favourable", () => {
    const s = scoreStrikePressure({ spot: 23120, strike: 23150, optionType: "CE", prevAbsDistance: 80, isShort: false });
    assert.equal(positionImpact({ isShort: false, label: s.label }), "FAVOURABLE");
  });

  it("LONG PE toward → favourable", () => {
    const s = scoreStrikePressure({ spot: 23100, strike: 23150, optionType: "PE", prevAbsDistance: 120 });
    assert.equal(positionImpact({ isShort: false, label: s.label }), "FAVOURABLE");
  });

  it("OI confirm strengthens toward", () => {
    const base = scoreStrikePressure({ spot: 23100, strike: 23150, optionType: "PE", prevAbsDistance: 120 });
    const conf = scoreStrikePressure({
      spot: 23100, strike: 23150, optionType: "PE", prevAbsDistance: 120, buildupCode: "SHORT_BUILD", oiChangePct: 8,
    });
    assert.ok(conf.score >= base.score);
    assert.equal(pressureToward(conf), true);
  });

  it("OI conflict does not cancel a clear approach", () => {
    const conf = scoreStrikePressure({
      spot: 23100, strike: 23150, optionType: "PE", prevAbsDistance: 120, buildupCode: "LONG_UNWIND",
    });
    assert.equal(pressureToward(conf), true);
  });

  it("missing spot → DATA UNAVAILABLE", () => {
    const s = scoreStrikePressure({ spot: null, strike: 23150 });
    assert.equal(s.label, PRESSURE_LABELS.unavailable);
  });

  it("SHORT 23100 PE near session low is TOWARD without last-tick delta", () => {
    const s = scoreStrikePressure({
      spot: 23201, strike: 23100, optionType: "PE",
      dayHigh: 23576, dayLow: 23195, dayOpen: 23550,
    });
    assert.equal(pressureToward(s), true);
    assert.equal(positionImpact({ isShort: true, label: s.label }), s.label === PRESSURE_LABELS.strongToward ? "HIGH RISK" : "CAUTION");
  });

  it("multi-window toward history", () => {
    const now = Date.now();
    const s = scoreStrikePressure({
      spot: 23110, strike: 23100, optionType: "PE",
      history: [
        { ts: now - 300000, dist: 150, spot: 23250 },
        { ts: now - 60000, dist: 70, spot: 23170 },
        { ts: now - 5000, dist: 20, spot: 23120 },
      ],
    });
    assert.equal(s.label, PRESSURE_LABELS.strongToward);
  });

  it("OI missing still toward when path is clear", () => {
    const r = computeStrikePressureForRow(pos({ tradingsymbol: "P1" }), {
      tickerByIndex: { IDX_A: { day_high: 23576, day_low: 23190, day_open: 23540 } },
      prevAbsDistance: 160,
    });
    assert.equal(pressureToward(r), true);
  });

  it("volume without underlying move is not TOWARD", () => {
    const s = scoreStrikePressure({
      spot: 23200, strike: 23100, optionType: "PE",
      volume: 90000,
      history: [
        { ts: Date.now() - 120000, dist: 100, volume: 1000 },
        { ts: Date.now() - 1000, dist: 100, volume: 90000 },
      ],
    });
    assert.equal(s.label, PRESSURE_LABELS.neutral);
  });

  it("indexes isolated", () => {
    const a = computeStrikePressureForRow(pos({ index: "IDX_A", tradingsymbol: "A" }), {
      oiByIndex: {
        IDX_B: { expiry: "2026-09-15", strikes: [{ strike: 23100, ce_oi: 1, pe_oi: 9e6, ce_ltp: 1, pe_ltp: 1 }] },
      },
      prevOiByIndex: {
        IDX_B: { expiry: "2026-09-15", strikes: [{ strike: 23100, ce_oi: 1, pe_oi: 1, ce_ltp: 1, pe_ltp: 1 }] },
      },
      prevAbsDistance: 200,
    });
    assert.ok(a.buildupCode == null);
  });

  it("expiries isolated", () => {
    const r = computeStrikePressureForRow(pos({ expiry_iso: "2026-09-15", expiryIso: "2026-09-15" }), {
      oiByIndex: {
        IDX_A: { expiry: "2026-09-22", strikes: [{ strike: 23100, ce_oi: 1, pe_oi: 9e6, ce_ltp: 10, pe_ltp: 1 }] },
      },
      prevOiByIndex: {
        IDX_A: { expiry: "2026-09-22", strikes: [{ strike: 23100, ce_oi: 1, pe_oi: 1, ce_ltp: 8, pe_ltp: 2 }] },
      },
      prevAbsDistance: 200,
    });
    assert.equal(r.buildupCode, null);
  });

  it("failure on row does not throw", () => {
    const r = computeStrikePressureForRow(null, {});
    assert.equal(r.label, PRESSURE_LABELS.neutral);
  });

  it("multi-index map stays independent", () => {
    const { bySymbol } = computeAllStrikePressure([
      pos({ tradingsymbol: "A", index: "IDX_A", spotUsed: 23120, strike: 23150 }),
      pos({ tradingsymbol: "B", index: "IDX_B", side: "CE", spotUsed: 45000, strike: 45100 }),
    ], { prevDistMap: new Map([["A", 180], ["B", 40]]) });
    assert.equal(pressureToward(bySymbol.A), true);
    assert.equal(bySymbol.B.label, PRESSURE_LABELS.away);
  });

  it("strike crossed is STRONG TOWARD for short PE", () => {
    const s = scoreStrikePressure({ spot: 23080, strike: 23100, optionType: "PE", prevAbsDistance: 40 });
    assert.equal(s.label, PRESSURE_LABELS.strongToward);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "HIGH RISK");
  });
});

function pressureToward(s) {
  return s.label === PRESSURE_LABELS.toward || s.label === PRESSURE_LABELS.strongToward;
}
