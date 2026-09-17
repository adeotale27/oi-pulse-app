import assert from "node:assert/strict";
import { casIepPopupActive, hmToMinutes, mergeIndicativeClose } from "./casIepPopup.js";

assert.equal(hmToMinutes("15:20", 0), 15 * 60 + 20);
assert.equal(hmToMinutes("bad", 99), 99);

assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 18, tradingDay: true }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 19, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 20, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 35, tradingDay: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 36, tradingDay: true }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 10 * 60, force: true }), true);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 25, enabled: false }), false);
assert.equal(casIepPopupActive({ minutesOfDay: 15 * 60 + 25, tradingDay: false }), false);

assert.equal(mergeIndicativeClose({}, { indicative_close_price: 24380.5 }), 24380.5);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380.5 }, {}, { keepLast: true }), 24380.5);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380.5 }, {}, { keepLast: false }), undefined);
assert.equal(mergeIndicativeClose({ indicative_close_price: 24380 }, { indicative_close_price: 0 }, { keepLast: true }), 24380);

console.log("casIepPopup.test.js ok");
