import assert from "node:assert/strict";
import { bandClass, impactScoreLabel, indiaImpactLabel, miMinimizeActive, MI_FILTERS } from "./marketIntel.js";

assert.ok(MI_FILTERS.some((f) => f.id === "fed"));
assert.match(bandClass("CRITICAL"), /rose/);
assert.equal(/NIFTY|BANKNIFTY|SENSEX/.test(JSON.stringify(MI_FILTERS)), false);
assert.equal(impactScoreLabel(96), "Impact 96");
assert.equal(indiaImpactLabel(70), "Indian market impact 70");
assert.equal(miMinimizeActive(100, 200), true);
assert.equal(miMinimizeActive(200, 200), false);
assert.equal(miMinimizeActive(201, 200), false);
console.log("marketIntel.test.js ok");
