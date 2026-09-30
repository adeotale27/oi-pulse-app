import assert from "node:assert/strict";
import {
  aggregateRiskScenario,
  calculateRiskBook,
  estimatePositionScenario,
  normalizeRiskSettings,
  positionRiskInputs,
  summarizeOpenShortCapture,
  summarizeSellerDecay,
} from "./positionsRisk.js";

const base = {
  exchange: "NFO",
  tradingsymbol: "NIFTY26OCT25000CE",
  display_name: "NIFTY 25,000 CE",
  index: "NIFTY",
  side: "CE",
  isOpt: true,
  strike: 25000,
  expiry_iso: "2026-10-29",
  spotUsed: 25000,
  last_price: 125,
  average_price: 110,
  unrealised: 1125,
  quantity: 75,
  lot_size: 75,
  multiplier: 1,
  dte: 7,
  iv: 20,
  delta: 0.5,
  gamma: 0.001,
  theta: -10,
  greeksHealth: "ok",
};

function position(overrides = {}) {
  return { ...base, ...overrides };
}

// Decay runway includes only valid open shorts; a partial total would be misleading.
{
  const summary = summarizeSellerDecay([
    position({ quantity: -75, extrinsicLeft: 480 }),
    position({ quantity: 75, extrinsicLeft: 260 }),
    position({ quantity: -25, extrinsicLeft: 120 }),
    position({ quantity: -10, extrinsicLeft: null }),
    position({ quantity: -5, exited: true, extrinsicLeft: 90 }),
  ]);
  assert.deepEqual(summary, { value: null, shortCount: 3, missingCount: 1 });
  assert.deepEqual(
    summarizeSellerDecay([position({ quantity: -75, extrinsicLeft: 480 })]),
    { value: 480, shortCount: 1, missingCount: 0 },
  );
  assert.deepEqual(summarizeSellerDecay([position({ quantity: 75 })]), {
    value: 0,
    shortCount: 0,
    missingCount: 0,
  });
}

// Captured credit is open short entry minus LTP, weighted by actual open units.
{
  const summary = summarizeOpenShortCapture([
    position({ quantity: -75, average_price: 100, last_price: 70, multiplier: 1 }),
    position({ quantity: -25, average_price: 200, last_price: 100, multiplier: 2 }),
    position({ quantity: 50, average_price: 80, last_price: 40 }),
    position({ quantity: -10, average_price: 90, last_price: null }),
  ]);
  assert.deepEqual(summary, {
    value: null,
    percent: null,
    shortCount: 3,
    missingCount: 1,
  });
  assert.deepEqual(
    summarizeOpenShortCapture([
      position({ quantity: -75, average_price: 100, last_price: 70 }),
      position({ quantity: 25, average_price: 80, last_price: 40 }),
    ]),
    { value: 2250, percent: 30, shortCount: 1, missingCount: 0 },
  );
  assert.equal(
    summarizeOpenShortCapture([
      position({ quantity: -75, average_price: 100, last_price: 0 }),
    ]).value,
    null,
  );
  assert.deepEqual(summarizeOpenShortCapture([position({ quantity: 75 })]), {
    value: 0,
    percent: 0,
    shortCount: 0,
    missingCount: 0,
  });
}

// Buy/Sell and CE/PE signs come from option Delta times signed Kite quantity.
{
  const callBuy = positionRiskInputs(position()).metrics;
  const callSell = positionRiskInputs(position({ quantity: -75 })).metrics;
  const putBuy = positionRiskInputs(position({ side: "PE", delta: -0.5 })).metrics;
  const putSell = positionRiskInputs(position({ side: "PE", delta: -0.5, quantity: -75 })).metrics;
  assert.ok(callBuy.deltaUnits > 0);
  assert.ok(callSell.deltaUnits < 0);
  assert.ok(putBuy.deltaUnits < 0);
  assert.ok(putSell.deltaUnits > 0);
  assert.ok(callBuy.signedGamma > 0);
  assert.ok(callSell.signedGamma < 0);
  assert.ok(callBuy.thetaInrPerDay < 0);
  assert.ok(callSell.thetaInrPerDay > 0);
}

// Quantity already contains lots; the multiplier is applied once, not lot_size again.
{
  const oneLot = positionRiskInputs(position()).metrics;
  const partial = positionRiskInputs(position({ quantity: 37.5, multiplier: 2 })).metrics;
  assert.equal(oneLot.signedQuantity, 75);
  assert.equal(partial.signedQuantity, 75);
  assert.equal(oneLot.deltaInrPerPct, partial.deltaInrPerPct);
}

// Cross-index Delta aggregation is expressed in rupees per 1% move, not unlike index points.
{
  const first = position();
  const second = position({
    index: "BANKNIFTY",
    tradingsymbol: "BANKNIFTY26OCT50000PE",
    side: "PE",
    strike: 50000,
    spotUsed: 50000,
    delta: -0.25,
  });
  const book = calculateRiskBook([first, second]);
  const expected = positionRiskInputs(first).metrics.deltaInrPerPct
    + positionRiskInputs(second).metrics.deltaInrPerPct;
  assert.equal(book.totals.netDeltaInrPerPct, expected);
  assert.equal(book.totals.pnl, 2250);
}

// Gamma and expiry produce an explicit warning only when the configured shock is material.
{
  const shortNearExpiry = position({
    quantity: -75,
    expiry_iso: "2026-10-29",
    dte: 0.2,
    last_price: 5,
    average_price: 8,
    gamma: 0.02,
    theta: -4,
  });
  const book = calculateRiskBook([shortNearExpiry], {
    priceShockPct: 2,
    ivShockPp: 2,
    watchLossPct: 1,
    criticalLossPct: 50,
  });
  assert.equal(book.positions[0].riskStatus, "High");
  assert.match(book.positions[0].riskReason, /Gamma|stress/i);
}

// A bought leg is labeled as a hedge, not High because its own premium can decay.
// Same-index, same-expiry sold and bought legs are repriced together for alerts.
{
  const short = position({
    quantity: -75,
    expiry_iso: "2026-10-29",
    dte: 0.2,
    last_price: 5,
    gamma: 0.02,
    theta: -4,
  });
  const hedge = position({
    ...short,
    tradingsymbol: "NIFTY26OCT25000CE-HEDGE",
    quantity: 75,
  });
  const hedgedBook = calculateRiskBook([short, hedge], {
    priceShockPct: 2,
    ivShockPp: 2,
    watchLossPct: 1,
    criticalLossPct: 50,
  });
  assert.equal(hedgedBook.positions[0].riskStatus, "Normal");
  assert.equal(hedgedBook.positions[1].riskStatus, "Hedge");
  assert.match(hedgedBook.positions[1].riskReason, /Bought hedge leg/);
  assert.equal(hedgedBook.totals.hedgeCount, 1);
  assert.equal(hedgedBook.totals.atRiskCount, 0);
}

// Package summaries expose net risk and preserve bought/sold quantities at each strike.
{
  const expiry = "2026-10-29";
  const shortCall = position({ expiry_iso: expiry, quantity: -75 });
  const boughtCall = position({
    expiry_iso: expiry,
    tradingsymbol: "NIFTY26OCT25000CE-HEDGE",
    quantity: 75,
  });
  const shortPut = position({
    expiry_iso: expiry,
    tradingsymbol: "NIFTY26OCT24800PE",
    side: "PE",
    strike: 24800,
    delta: -0.4,
    quantity: -75,
  });
  const book = calculateRiskBook([shortCall, boughtCall, shortPut]);
  const [sellerPackage] = book.sellerPackages;
  assert.equal(sellerPackage.soldCount, 2);
  assert.equal(sellerPackage.hedgeCount, 1);
  assert.deepEqual(sellerPackage.strikeBuckets.map(({ strike }) => strike), [24800, 25000]);
  assert.equal(sellerPackage.strikeBuckets[1].callSellQuantity, 75);
  assert.equal(sellerPackage.strikeBuckets[1].callBuyQuantity, 75);
  assert.equal(sellerPackage.strikeBuckets[1].callUncoveredQuantity, 0);
  assert.equal(sellerPackage.strikeBuckets[1].callCoveragePct, 100);
  assert.equal(sellerPackage.strikeBuckets[0].putUncoveredQuantity, 75);
  assert.equal(sellerPackage.strikeBuckets[0].putCoveragePct, 0);
  assert.equal(
    sellerPackage.netDeltaInrPerPct,
    book.positions.reduce((sum, row) => sum + row.riskMetrics.deltaInrPerPct, 0),
  );
  assert.equal(
    sellerPackage.scenarios[0].pnl,
    aggregateRiskScenario(book.positions, sellerPackage.scenarios[0]),
  );
}

// Missing data on one leg makes the whole same-expiry package unavailable.
{
  const short = position({ quantity: -75, expiry_iso: "2026-10-29" });
  const missingHedge = position({
    tradingsymbol: "NIFTY26OCT24800PE",
    side: "PE",
    strike: 24800,
    expiry_iso: "2026-10-29",
    gamma: null,
    greeksHealth: "iv_na",
  });
  const book = calculateRiskBook([short, missingHedge]);
  assert.deepEqual(book.positions.map(({ riskStatus }) => riskStatus), [
    "Data unavailable",
    "Data unavailable",
  ]);
}

// Missing Greek inputs are never replaced with zero; stale books are not classified as Normal.
{
  const missing = position({ gamma: null, greeksHealth: "iv_na" });
  assert.equal(positionRiskInputs(missing).metrics, null);
  assert.equal(calculateRiskBook([missing]).positions[0].riskStatus, "Data unavailable");
  const stale = calculateRiskBook([position()], {}, { stale: true });
  assert.equal(stale.totals.netDeltaInrPerPct, null);
  assert.equal(stale.positions[0].riskStatus, "Data unavailable");
}

// Without a valid expiry, the risk view cannot safely pair a bought hedge with sold legs.
{
  const noExpiry = position({ expiry_iso: null });
  assert.equal(calculateRiskBook([noExpiry]).positions[0].riskStatus, "Data unavailable");
  assert.match(calculateRiskBook([noExpiry]).positions[0].riskReason, /expiry is unavailable/i);
}

// Scenario units: Vega takes percentage points, Theta takes elapsed calendar days.
{
  const inputs = positionRiskInputs(position()).metrics;
  const direct = estimatePositionScenario(inputs, { pricePct: 1, ivPp: 2, days: 1 });
  const sameMarket = estimatePositionScenario(inputs, {});
  assert.equal(sameMarket, 0);
  assert.ok(Number.isFinite(direct));
  assert.equal(aggregateRiskScenario([{ riskMetrics: inputs }], { pricePct: 1 }), estimatePositionScenario(inputs, { pricePct: 1 }));
  assert.equal(aggregateRiskScenario([{ riskMetrics: null }], { pricePct: 1 }), null);
}

// Full repricing respects a long option's maximum loss: its current value.
{
  const longCall = position({
    dte: 0.1,
    last_price: 125,
    strike: 25000,
    spotUsed: 25000,
    iv: 20,
  });
  const metrics = positionRiskInputs(longCall).metrics;
  const adverseMove = estimatePositionScenario(metrics, {
    pricePct: -10,
    ivPp: -20,
    days: 1,
  });
  assert.ok(adverseMove >= -metrics.markValue);
  assert.ok(adverseMove <= 0);
}

// A measured IV rise is adverse to a short-vega leg and is explained explicitly.
{
  const short = position({ quantity: -75 });
  const offset = position({
    tradingsymbol: "NIFTY26OCT25000CE-LONG",
    quantity: 75,
  });
  const book = calculateRiskBook([short, offset], {
    watchLossPct: 1,
    criticalLossPct: 99,
  }, {
    ivChanges: { "NFO:NIFTY26OCT25000CE:": 3 },
  });
  assert.ok(book.positions[0].observedIvLossPct > 0);
  assert.ok(book.positions[0].observedIvPnl < 0);
}

// Invalid preferences are bounded, and critical limits cannot be softer than watch limits.
{
  const settings = normalizeRiskSettings({ priceShockPct: 99, watchLossPct: 35, criticalLossPct: 10 });
  assert.equal(settings.priceShockPct, 10);
  assert.equal(settings.watchLossPct, 35);
  assert.equal(settings.criticalLossPct, 35);
  assert.equal(normalizeRiskSettings().watchLossPct, 25);
  assert.equal(normalizeRiskSettings().criticalLossPct, 100);
}

console.log("positionsRisk.test.js: all assertions passed");
