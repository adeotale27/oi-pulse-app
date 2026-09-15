import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreStrikePressure,
  positionImpact,
  computeStrikePressureForRow,
  PRESSURE_LABELS,
  computeAllStrikePressure,
} from "./strikePressure.js";

function pos(over = {}) {
  return {
    tradingsymbol: "X",
    isOpt: true,
    exited: false,
    index: "IDX_A",
    side: "PE",
    isShort: true,
    strike: 23150,
    spotUsed: 23000,
    expiry_iso: "2026-09-15",
    expiryIso: "2026-09-15",
    ...over,
  };
}

describe("strike pressure", () => {
  it("SHORT PE toward → TOWARD + HIGH RISK / CAUTION", () => {
    const s = scoreStrikePressure({ spot: 23090, strike: 23150, prevAbsDistance: 180 });
    assert.equal(s.label, PRESSURE_LABELS.toward);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "CAUTION");
  });

  it("SHORT PE away → AWAY + FAVOURABLE", () => {
    const s = scoreStrikePressure({ spot: 22800, strike: 23150, prevAbsDistance: 90 });
    assert.equal(s.label, PRESSURE_LABELS.away);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "FAVOURABLE");
  });

  it("SHORT CE toward → caution/high risk", () => {
    const s = scoreStrikePressure({ spot: 23200, strike: 23150, prevAbsDistance: 200 });
    assert.equal(pressureToward(s), true);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "CAUTION");
  });

  it("SHORT CE away → favourable", () => {
    const s = scoreStrikePressure({ spot: 22900, strike: 23150, prevAbsDistance: 50 });
    assert.equal(s.label, PRESSURE_LABELS.away);
    assert.equal(positionImpact({ isShort: true, label: s.label }), "FAVOURABLE");
  });

  it("LONG CE toward → favourable", () => {
    const s = scoreStrikePressure({ spot: 23120, strike: 23150, prevAbsDistance: 80 });
    assert.equal(positionImpact({ isShort: false, label: s.label }), "FAVOURABLE");
  });

  it("LONG PE toward → favourable", () => {
    const s = scoreStrikePressure({ spot: 23100, strike: 23150, prevAbsDistance: 120 });
    assert.equal(positionImpact({ isShort: false, label: s.label }), "FAVOURABLE");
  });

  it("OI confirm strengthens toward", () => {
    const base = scoreStrikePressure({ spot: 23100, strike: 23150, prevAbsDistance: 120 });
    const conf = scoreStrikePressure({
      spot: 23100, strike: 23150, prevAbsDistance: 120, buildupCode: "SHORT_BUILD", oiChangePct: 8,
    });
    assert.ok(conf.score > base.score);
    assert.equal(conf.label, PRESSURE_LABELS.strongToward);
  });

  it("OI conflict reduces toward toward NEUTRAL", () => {
    const conf = scoreStrikePressure({
      spot: 23100, strike: 23150, prevAbsDistance: 120, buildupCode: "LONG_UNWIND",
    });
    assert.equal(conf.label, PRESSURE_LABELS.neutral);
  });

  it("missing spot → DATA UNAVAILABLE", () => {
    const s = scoreStrikePressure({ spot: null, strike: 23150 });
    assert.equal(s.label, PRESSURE_LABELS.unavailable);
  });

  it("indexes isolated", () => {
    const a = computeStrikePressureForRow(pos({ index: "IDX_A", tradingsymbol: "A" }), {
      oiByIndex: {
        IDX_B: { expiry: "2026-09-15", strikes: [{ strike: 23150, ce_oi: 1, pe_oi: 9e6, ce_ltp: 1, pe_ltp: 1 }] },
      },
      prevOiByIndex: {
        IDX_B: { expiry: "2026-09-15", strikes: [{ strike: 23150, ce_oi: 1, pe_oi: 1, ce_ltp: 1, pe_ltp: 1 }] },
      },
      prevAbsDistance: 200,
    });
    assert.ok(!String(a.reasons || []).includes("OI Change") || a.buildupCode == null);
  });

  it("expiries isolated", () => {
    const r = computeStrikePressureForRow(pos({ expiry_iso: "2026-09-15", expiryIso: "2026-09-15" }), {
      oiByIndex: {
        IDX_A: { expiry: "2026-09-22", strikes: [{ strike: 23150, ce_oi: 1, pe_oi: 9e6, ce_ltp: 10, pe_ltp: 1 }] },
      },
      prevOiByIndex: {
        IDX_A: { expiry: "2026-09-22", strikes: [{ strike: 23150, ce_oi: 1, pe_oi: 1, ce_ltp: 8, pe_ltp: 2 }] },
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
    assert.equal(bySymbol.A.label, PRESSURE_LABELS.toward);
    assert.equal(bySymbol.B.label, PRESSURE_LABELS.away);
  });
});

function pressureToward(s) {
  return s.label === PRESSURE_LABELS.toward || s.label === PRESSURE_LABELS.strongToward;
}
