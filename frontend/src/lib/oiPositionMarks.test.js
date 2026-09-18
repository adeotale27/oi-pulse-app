import assert from "node:assert/strict";
import { openOiMarks, optionMarkSide, peTopKey, ceTopKey } from "./oiPositionMarks.js";

assert.equal(optionMarkSide({ side: "CE" }), "CE");
assert.equal(optionMarkSide({ side: "PUT" }), "PE");

const rows = [
  { index: "NIFTY", strike: 23650, side: "CE", quantity: -455, exited: false },
  { index: "NIFTY", strike: 24800, side: "CE", quantity: 2275, exited: false },
  { index: "NIFTY", strike: 23000, side: "PE", quantity: -845, exited: false },
  { index: "NIFTY", strike: 23650, side: "CE", quantity: 0, exited: true },
  { index: "SENSEX", strike: 80000, side: "CE", quantity: -10, exited: false },
];
const nifty = openOiMarks(rows, "NIFTY");
assert.equal(nifty.length, 3);
assert.equal(nifty.find((m) => m.strike === 23650 && m.side === "CE").tag, "S");
assert.equal(nifty.find((m) => m.strike === 24800).tag, "B");
assert.equal(nifty.find((m) => m.strike === 23000).tag, "S");
assert.ok(!openOiMarks(rows, "NIFTY").some((m) => m.strike === 80000));
assert.equal(openOiMarks([], "NIFTY").length, 0);
assert.equal(openOiMarks(null, "NIFTY").length, 0);
assert.deepEqual(peTopKey({ pe_down: 10, pe_up: 1, pe_base: 5 }), "pe_down");
assert.deepEqual(ceTopKey({ ce_up: 3, ce_base: 2, ce_down: 0 }), "ce_up");

console.log("oiPositionMarks.test.js ok");
