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
assert.equal(
  openLiveCount({
    positions: [{ quantity: 10, exited: true }],
  }),
  0,
);

console.log("positionsBookPoll.test.js ok");
