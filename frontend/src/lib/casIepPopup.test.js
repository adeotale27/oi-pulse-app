import assert from "node:assert/strict";
import {
  casIepDisplayEndMinutes, casIepPopupActive, hmToMinutes, indicativeChangePct,
  mergeIndicativeClose, roundAtm, KITE_IEP_SETTLE_MINUTE,
} from "./casIepPopup.js";

assert.equal(hmToMinutes("15:20", 0), 15 * 60 + 20);
assert.equal(hmToMinutes("bad", 99), 99);
assert.equal(casIepDisplayEndMinutes("15:35"), KITE_IEP_SETTLE_MINUTE);
assert.equal(casIepDisplayEndMinutes("15:25"), 15 * 60 + 25);

assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 18, tradingDay: true }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 19, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 20, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 30, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 31, tradingDay: true, endIst: "15:35" }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 10 * 60, force: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 25, enabled: false }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 25, tradingDay: false }), false);

assert.equal(mergeIndicativeClose({}, { indicative_close_price: 24380.5 }), 24380.5);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380.5 }, {}, { keepLast: true }), 24380.5);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380.5 }, {}, { keepLast: false }), undefined);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380 }, { indicative_close_price: 0 }, { keepLast: true }), undefined);
assert.equal(indicativeChangePct({ indicative_close_price: 24400, prev_close: 24300 }), (24400 - 24300) / 24300 * 100);
assert.equal(indicativeChangePct({ indicative_change_pct: -1.2, indicative_close_price: 10 }), -1.2);
assert.equal(roundAtm(23270.6, 50), 23250);
assert.equal(roundAtm(23220, 50), 23200);

console.log("casIepPopup.test.js ok");
