import assert from "node:assert/strict";
import { bandClass, impactScoreLabel, indiaImpactLabel, MI_FILTERS } from "./marketIntel.js";

assert.ok(MI_FILTERS.some((f) => f.id === "fed"));
assert.match(bandClass("CRITICAL"), /rose/);
assert.equal(/NIFTY|BANKNIFTY|SENSEX/.test(JSON.stringify(MI_FILTERS)), false);
assert.equal(impactScoreLabel(96), "Impact 96");
assert.equal(indiaImpactLabel(70), "Indian market impact 70");
console.log("marketIntel.test.js ok");
