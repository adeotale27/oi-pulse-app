import assert from "node:assert/strict";
import { nextRefreshInSeconds, buildDataTruth, clampConfiguredPollMs } from "./dataTruth.js";

assert.equal(nextRefreshInSeconds(4, 15000), 11);
assert.equal(nextRefreshInSeconds(0, 15000), 15);
assert.equal(nextRefreshInSeconds(15, 15000), 15);
assert.equal(nextRefreshInSeconds(14, 15000), 1);
assert.equal(nextRefreshInSeconds(10, 60000), 50);

assert.equal(clampConfiguredPollMs(60000), 60000);
assert.equal(clampConfiguredPollMs(120000), 120000);
assert.equal(clampConfiguredPollMs(15000), 15000);
assert.equal(clampConfiguredPollMs(1000), 5000);
assert.equal(clampConfiguredPollMs(NaN), 15000);

const live = buildDataTruth({
  dataStatus: { is_live: true, data_date: "2026-08-19", cache_age_seconds: 4 },
  marketOpen: true,
  mode: "kite",
  snapshotTs: new Date(Date.now() - 4000).toISOString(),
  now: new Date(),
  pollMs: 15000,
});
assert.equal(live.mode, "LIVE");
assert.match(live.detail, /Market Open · Next Pull \(\d+s\)/);
assert.equal(/Market open · next \(/.test(live.detail), false);

const preMarket = buildDataTruth({
  dataStatus: {
    is_live: false,
    data_date: "2026-08-18",
    cache_age_seconds: 60000,
    stale_reason: "stale_cache",
  },
  marketOpen: true,
  preMarket: true,
  pollStartsAt: "09:15",
  mode: "kite",
  snapshotTs: "2026-08-18T10:00:00.000Z",
  now: new Date("2026-08-19T03:30:00.000Z"),
});
assert.equal(preMarket.mode, "PRE_MARKET");
assert.equal(preMarket.badge, "PRE-MARKET");
assert.equal(preMarket.tone, "premarket");
assert.match(preMarket.detail, /polling starts at 09:15 IST/);

const regularSessionStale = buildDataTruth({
  dataStatus: { is_live: false, stale_reason: "stale_cache" },
  marketOpen: true,
  mode: "kite",
  snapshotTs: "2026-08-19T03:30:00.000Z",
  now: new Date("2026-08-19T03:32:00.000Z"),
});
assert.equal(regularSessionStale.mode, "STALE");

console.log("dataTruth.test.js ok");
