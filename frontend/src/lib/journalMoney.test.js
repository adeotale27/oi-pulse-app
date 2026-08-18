import assert from "node:assert/strict";
import { compactPnl, exactPnl, fmtInr } from "./journalMoney.js";

assert.equal(exactPnl(47489.15), "+₹47,489.15");
assert.equal(fmtInr(47489.15), "₹47,489.15");
assert.equal(compactPnl(47489.15), "+₹47.5k");
assert.equal(compactPnl(383000.4), "+₹3.8L");
assert.equal(compactPnl(-910.4), "−₹910");
assert.equal(compactPnl(50.6), "+₹51");
console.log("journalMoney.test.js ok");
