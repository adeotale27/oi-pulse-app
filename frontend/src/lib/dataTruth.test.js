import assert from "node:assert/strict";
import { nextRefreshInSeconds, buildDataTruth } from "./dataTruth.js";

assert.equal(nextRefreshInSeconds(4, 15000), 11);
assert.equal(nextRefreshInSeconds(0, 15000), 15);
assert.equal(nextRefreshInSeconds(15, 15000), 15);
assert.equal(nextRefreshInSeconds(14, 15000), 1);

const live = buildDataTruth({
  dataStatus: { is_live: true, data_date: "2026-08-19", cache_age_seconds: 4 },
  marketOpen: true,
  mode: "kite",
  snapshotTs: new Date(Date.now() - 4000).toISOString(),
  now: new Date(),
  pollMs: 15000,
});
assert.equal(live.mode, "LIVE");
assert.match(live.detail, /next \(\d+s\)/);
assert.equal(/Updated \d+s ago/.test(live.detail), false);

console.log("dataTruth.test.js ok");
