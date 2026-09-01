import assert from "node:assert/strict";
import {
  computePositionsBrain,
  isShortItm,
  normalizeBrainOrder,
  openShortOptions,
  stressScore,
  strikeDistancePct,
} from "./positionsBrain.js";

const farPut = {
  exited: false,
  isShort: true,
  isOpt: true,
  tradingsymbol: "NIFTY25SEP24000PE",
  side: "PE",
  strike: 24000,
  quantity: -50,
  delta: -0.12,
  thetaInr: 400,
  dte: 10,
  distancePct: 4.0,
  spotUsed: 25000,
  breachedAdjust: false,
  greeksHealth: "ok",
};
const nearCall = {
  exited: false,
  isShort: true,
  isOpt: true,
  tradingsymbol: "NIFTY25SEP25100CE",
  side: "CE",
  strike: 25100,
  quantity: -75,
  delta: 0.42,
  thetaInr: 200,
  dte: 2,
  distancePct: 0.4,
  spotUsed: 25000,
  breachedAdjust: true,
  greeksHealth: "ok",
};
const farCall = {
  ...nearCall,
  tradingsymbol: "NIFTY25SEP26000CE",
  strike: 26000,
  delta: 0.08,
  quantity: -25,
  distancePct: 4.0,
  breachedAdjust: false,
  dte: 10,
};

assert.equal(openShortOptions([farPut, { ...farPut, exited: true }]).length, 1);
assert.equal(isShortItm({ ...nearCall, strike: 24900, side: "CE", spotUsed: 25000 }), true);
assert.equal(isShortItm({ ...farPut, strike: 24000, side: "PE", spotUsed: 25000 }), false);
assert.ok(stressScore(nearCall) > stressScore(farPut), "too-close call ranks above far put");
assert.equal(strikeDistancePct(nearCall), 0.4);

const empty = computePositionsBrain({ rows: [], stats: {} });
assert.equal(empty.mode, "EMPTY");
assert.equal(empty.heat, 0);
assert.match(empty.action, /Nothing to manage/i);

const healthy = computePositionsBrain({
  rows: [farPut, farCall],
  stats: { netDelta: 2, netTheta: 900, adjustCount: 0, shortCount: 2, premiumLeft: 8000, netPnl: 1200 },
});
assert.equal(healthy.mode, "SAFE");
assert.ok(healthy.heat < 45, `healthy heat ${healthy.heat}`);
assert.equal(healthy.putCount, 1);
assert.equal(healthy.callCount, 1);
assert.ok(healthy.plan.some((p) => /24000/.test(p) && /26000/.test(p)), "plan names real short strikes");
assert.ok(!healthy.contributors.some((c) => c.id === "theta"), "positive theta is not heat");

const stressed = computePositionsBrain({
  rows: [nearCall, farPut],
  stats: { netDelta: 38, netTheta: -80, adjustCount: 1, shortCount: 2, premiumLeft: 400, netPnl: -900 },
  vix: 23,
});
assert.ok(stressed.heat >= 45, `stressed heat ${stressed.heat}`);
assert.match(stressed.worst.symbol, /25100CE/);
assert.equal(stressed.threat.direction, "upside", "short-call sensitivity is upside threat");
assert.ok(stressed.contributors.some((c) => c.id === "close"));
assert.equal(stressed.overnightBand, "HIGH");
assert.ok(!stressed.plan.some((p) => /24,000|24500/.test(p) && !/24000|25100/.test(p)));

const onlyPuts = computePositionsBrain({
  rows: [{ ...farPut, distancePct: 0.5, breachedAdjust: true, delta: -0.4, dte: 1, strike: 24800, spotUsed: 24900 }],
  stats: { netDelta: -30, netTheta: 100, adjustCount: 1, shortCount: 1 },
});
assert.equal(onlyPuts.threat.direction, "downside");
assert.equal(onlyPuts.putShare, 100);

const putHeavy = computePositionsBrain({
  rows: [farPut, { ...farPut, tradingsymbol: "NIFTY25SEP24100PE", strike: 24100, quantity: -80, delta: -0.2 }],
  stats: { netDelta: -12, netTheta: 400, shortCount: 2 },
});
assert.equal(putHeavy.threat.direction, "downside");
assert.ok(putHeavy.putShare > putHeavy.callShare);

const order = normalizeBrainOrder(["watch", "nope", "verdict", "watch"]);
assert.deepEqual(order.slice(0, 2), ["watch", "verdict"]);
assert.ok(order.includes("plan"));

console.log("positionsBrain.test.js: all assertions passed");
