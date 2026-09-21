import assert from "node:assert/strict";
import {
  openOiMarks,
  strikeFromRow,
  sameChartExpiry,
  peTopKey,
  ceTopKey,
  parseOptionSymbol,
  formatMarkHover,
  isMarkNearAtm,
  strikeKey,
} from "./oiPositionMarks.js";

assert.equal(strikeFromRow({ strike: 23650 }), 23650);
assert.equal(strikeFromRow({ strike: "23650.4" }), 23650);
assert.equal(strikeFromRow({ display_name: "NIFTY 22ND SEP 23650 CE" }), 23650);
assert.equal(strikeFromRow({ tradingsymbol: "NIFTY26SEP23650CE" }), 23650);
assert.equal(strikeFromRow({ tradingsymbol: "NIFTY2692223350PE" }), 23350);
assert.equal(parseOptionSymbol("NIFTY2692223350PE").expiry, "2026-09-22");
assert.equal(parseOptionSymbol("NIFTY26SEP2223350PE").expiry, "2026-09-22");
assert.equal(parseOptionSymbol("NIFTY26SEP2223350PE").strike, 23350);
assert.equal(sameChartExpiry("2026-09-22", "2026-09-22"), true);
assert.equal(sameChartExpiry("2026-09-29", "2026-09-22"), false);
assert.equal(sameChartExpiry("2026-09-22", null), true);
assert.equal(strikeKey(23350.2), 23350);

const rows = [
  { index: "NIFTY", strike: 23650, side: "CE", quantity: -455, exited: false, expiry_iso: "2026-09-22", lot_size: 65, unrealised: 1432 },
  { index: "NIFTY", strike: 24800, side: "CE", quantity: 2275, exited: false, expiry_iso: "2026-09-22", lot_size: 65, unrealised: -371 },
  { index: "NIFTY", strike: 23000, side: "PE", quantity: -845, exited: false, expiry_iso: "2026-09-22", lot_size: 65, pnl: 2754 },
  { index: "NIFTY", strike: 25000, side: "CE", quantity: -65, exited: false, expiry_iso: "2026-09-29", lot_size: 65, unrealised: 10 },
  { index: "NIFTY", strike: 23650, side: "CE", quantity: 0, exited: true, expiry_iso: "2026-09-22" },
  { index: "SENSEX", strike: 80000, side: "CE", quantity: -10, exited: false, expiry_iso: "2026-09-22" },
  { index: "NIFTY", tradingsymbol: "NIFTY26OCT24000PE", side: "PE", quantity: -65, exited: false, expiry_iso: "2026-10-27", lot_size: 65, unrealised: 50 },
];
const nifty = openOiMarks(rows, "NIFTY", "2026-09-22");
assert.equal(nifty.length, 3);
assert.equal(nifty.find((m) => m.strike === 23650 && m.side === "CE").tag, "S");
assert.equal(nifty.find((m) => m.strike === 23650).lots, 7);
assert.equal(nifty.find((m) => m.strike === 24800).tag, "L");
assert.ok(!nifty.some((m) => m.strike === 25000));
assert.ok(!nifty.some((m) => m.strike === 80000));
assert.ok(!nifty.some((m) => m.strike === 24000));
assert.equal(openOiMarks(rows, "NIFTY", "2026-09-29").some((m) => m.strike === 25000), true);
assert.equal(openOiMarks(rows, "NIFTY", "2026-10-27").some((m) => m.strike === 24000 && m.side === "PE"), true);
assert.deepEqual(peTopKey({ pe_down: 10, pe_up: 1, pe_base: 5 }), "pe_down");
assert.deepEqual(ceTopKey({ ce_up: 3, ce_base: 2, ce_down: 0 }), "ce_up");

const hoverS = formatMarkHover({ tag: "S", lots: 7, pnl: 1432 });
assert.ok(hoverS.includes("Short 7 lots"));
assert.ok(hoverS.includes("P&L"));
assert.ok(hoverS.includes("1,432") || hoverS.includes("1432"));
const hoverL = formatMarkHover({ tag: "L", lots: 1, pnl: -371.5 });
assert.ok(hoverL.includes("Long 1 lot"));
assert.ok(hoverL.includes("-₹"));
assert.equal(isMarkNearAtm({ strike: 23650 }, 23420), true);
assert.equal(isMarkNearAtm({ strike: 23650 }, 23399), false);
assert.equal(isMarkNearAtm({ strike: 23650 }, null), false);

const windowStrikes = new Set([23000, 23650]);
const visible = nifty.filter((m) => windowStrikes.has(m.strike));
assert.equal(visible.length, 2);
assert.ok(!visible.some((m) => m.strike === 24800));

console.log("oiPositionMarks.test.js ok");
