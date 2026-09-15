import assert from "node:assert/strict";
import { bandClass, MI_FILTERS } from "./marketIntel.js";

assert.ok(MI_FILTERS.some((f) => f.id === "fed"));
assert.match(bandClass("CRITICAL"), /rose/);
assert.equal(/NIFTY|BANKNIFTY|SENSEX/.test(JSON.stringify(MI_FILTERS)), false);
console.log("marketIntel.test.js ok");
