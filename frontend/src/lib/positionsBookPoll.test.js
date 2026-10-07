import assert from "node:assert/strict";
import {
  clampPositionsBookPollMs,
  positionsBookPollDelayMs,
} from "./positionsBookPoll.js";

function openLiveCount(payload) {
  const rows = payload?.positions;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => !r.exited && Number(r.quantity) !== 0).length;
}

assert.equal(openLiveCount(null), 0);
assert.equal(openLiveCount({}), 0);
assert.equal(
  openLiveCount({
    positions: [
      { quantity: 50, exited: false },
      { quantity: 0, exited: true },
      { quantity: -25, exited: false },
    ],
  }),
  2,
);
assert.equal(openLiveCount({ positions: [{ quantity: 10, exited: true }] }), 0);

assert.equal(clampPositionsBookPollMs(15_000), 15_000);
assert.equal(clampPositionsBookPollMs(2000), 2000);
assert.equal(clampPositionsBookPollMs(1000), 1000);
assert.equal(clampPositionsBookPollMs(0), 2000);
assert.equal(clampPositionsBookPollMs(9999999), 3_600_000);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: true,
    sessionOpen: true,
    pollMs: 2000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  500,
);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: true,
    sessionOpen: true,
    pollMs: 1000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  0,
);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: false,
    sessionOpen: false,
    pollMs: 2000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  1500,
);

console.log("positionsBookPoll.test.js ok");
