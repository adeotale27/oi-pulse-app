import assert from "node:assert/strict";
import { bandClass, formatEventTypeLabel, impactScoreLabel, indiaImpactLabel, miMinimizeActive, MI_FILTERS, readMiFeedCache, writeMiFeedCache } from "./marketIntel.js";

assert.ok(MI_FILTERS.some((f) => f.id === "fed"));
assert.match(bandClass("CRITICAL"), /rose/);
assert.equal(/NIFTY|BANKNIFTY|SENSEX/.test(JSON.stringify(MI_FILTERS)), false);
assert.equal(impactScoreLabel(96), "Impact 96");
assert.equal(indiaImpactLabel(70), "Indian market impact 70");
assert.equal(formatEventTypeLabel("india_macro"), "INDIA MACRO");
assert.equal(formatEventTypeLabel("oil"), "OIL");
assert.equal(formatEventTypeLabel("fed-funds"), "FED FUNDS");
assert.equal(formatEventTypeLabel("geopolitics"), "GEOPOLITICS");
assert.equal(miMinimizeActive(100, 200), true);
assert.equal(miMinimizeActive(200, 200), false);
assert.equal(miMinimizeActive(201, 200), false);
writeMiFeedCache("2026-09-17", "all", [{ id: 1 }]);
assert.equal(readMiFeedCache("2026-09-17", "all").length, 1);
assert.equal(readMiFeedCache("2026-09-16", "all"), null);
console.log("marketIntel.test.js ok");
