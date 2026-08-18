import assert from "node:assert/strict";
import {
  formatOiDelta,
  hugeShiftCopy,
  oiBoardAlertCopy,
  oiPctCopy,
  oiPressureCopy,
  hugeShiftToastCopy,
  oiSellerRead,
} from "./oiAlertCopy.js";

const p = oiPressureCopy({
  index: "NIFTY",
  bullish: true,
  windowLabel: "15 mins",
  pe: 3.49e7,
  ce: 4.56e7,
});
assert.equal(p.title, "NIFTY · Puts adding — bullish");
assert.match(p.description, /Put selling increase — bullish further/);
assert.match(p.description, /Bullish pressure \(Put OI building\) in last 15 mins/);
assert.match(p.description, /PE \+3\.49Cr · CE \+4\.56Cr/);

const bear = oiPressureCopy({ index: "SENSEX", bullish: false, windowLabel: "1 min" });
assert.equal(bear.title, "SENSEX · Calls adding — bearish");
assert.match(bear.description, /Call selling increase — bearish further/);

assert.equal(oiSellerRead(true), "Put selling increase — bullish further");
assert.equal(formatOiDelta(3.49e7), "+3.49Cr");

const board = oiBoardAlertCopy({
  index: "NIFTY",
  direction: "Bearish pressure (Call OI building)",
  windowLabel: "15 mins",
  pe: 3.49e7,
  ce: 4.56e7,
});
assert.equal(board.title, "NIFTY: Bearish pressure (Call OI building) in last 15 mins");
assert.match(board.description, /PE \+3\.49Cr · CE \+4\.56Cr/);
assert.match(board.description, /Call selling increase/);

const pct = oiPctCopy({ index: "NIFTY", side: "CE", pct: -5.21, windowLabel: "5 min" });
assert.equal(pct.title, "NIFTY · Calls down 5.2%");

const pctUp = oiPctCopy({ index: "BANKNIFTY", side: "PE", pct: 4, windowLabel: "3 min" });
assert.equal(pctUp.title, "BANKNIFTY · Puts up 4.0%");

const ceAdd = hugeShiftCopy("CE", 1e7);
assert.equal(ceAdd.tone, "rose");
const peCut = hugeShiftCopy("PE", -1);
assert.equal(peCut.headline, "Puts cut near ATM");

const toast = hugeShiftToastCopy({ index: "NIFTY", side: "CE", value: 1, window: 3 });
assert.equal(toast.title, "NIFTY · Calls added near ATM");
assert.equal(toast.description, "3 min window");

console.log("oiAlertCopy.test.js ok");
