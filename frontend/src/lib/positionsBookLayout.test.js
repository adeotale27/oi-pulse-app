import assert from "node:assert/strict";
import { loadBookSlot, saveBookSlot, BOOK_SLOT_KEY, BOOK_PLACE_KEY } from "./positionsBookLayout.js";

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

assert.equal(loadBookSlot(), "top", "default top");
mem[BOOK_PLACE_KEY] = "below";
assert.equal(loadBookSlot(), "bottom", "legacy below → bottom");
assert.equal(saveBookSlot("after-live"), "after-live");
assert.equal(mem[BOOK_SLOT_KEY], "after-live");
assert.equal(loadBookSlot(), "after-live");
assert.equal(saveBookSlot("nope"), "top");
console.log("positionsBookLayout.test.js ok");
