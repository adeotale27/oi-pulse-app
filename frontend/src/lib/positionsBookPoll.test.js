import assert from "node:assert/strict";

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

function clampPositionsBookPollMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 5000;
  return Math.max(5000, Math.min(3_600_000, Math.round(n)));
}
assert.equal(clampPositionsBookPollMs(15_000), 15_000);
assert.equal(clampPositionsBookPollMs(1000), 5000);
assert.equal(clampPositionsBookPollMs(9999999), 3_600_000);

console.log("positionsBookPoll.test.js ok");
