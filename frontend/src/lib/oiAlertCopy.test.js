import assert from "node:assert/strict";
import { hugeShiftCopy, oiPctCopy, oiPressureCopy, hugeShiftToastCopy } from "./oiAlertCopy.js";

const p = oiPressureCopy({ index: "NIFTY", bullish: true, windowLabel: "5 min" });
assert.equal(p.title, "NIFTY · Puts adding — bullish");
assert.equal(p.description, "Last 5 min");

const bear = oiPressureCopy({ index: "SENSEX", bullish: false, windowLabel: "1 min" });
assert.equal(bear.title, "SENSEX · Calls adding — bearish");

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
