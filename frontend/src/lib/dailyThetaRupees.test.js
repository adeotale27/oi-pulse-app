import assert from "node:assert/strict";
import {
  dailyThetaRupees,
  greeks,
  impliedVol,
  yearsToExpiry,
  extrinsicPremium,
  shortPremiumLeft,
} from "./blackScholes.js";

// Expiry-day far-OTM long that previously showed ~−₹10k "₹/day" on a ₹585 book.
const S = 24550;
const K = 23050;
const px = 0.45;
const qty = 1300;
const nowMs = Date.UTC(2026, 7, 11, 2, 51); // 08:21 IST expiry morning
const T = yearsToExpiry("2026-08-11", nowMs);
const iv = impliedVol(px, S, K, T, 0.065, false);
assert.ok(iv != null && iv > 0, "IV should solve");
const g = greeks(S, K, T, 0.065, iv, false);
const raw = g.theta * qty;
assert.ok(raw < -5000, `raw BS θ should blow up (got ${raw})`);

const capped = dailyThetaRupees({
  thetaPerUnit: g.theta,
  quantity: qty,
  marketPrice: px,
  S,
  K,
  isCall: false,
  T,
});
const extTotal = extrinsicPremium(px, S, K, false) * Math.abs(qty);
assert.ok(capped != null);
assert.ok(Math.abs(capped) <= extTotal + 1e-6, `capped ${capped} must ≤ extrinsic ${extTotal}`);
assert.ok(capped > raw, "clamp should cut the fake loss");
assert.equal(Math.round(capped), -Math.round(extTotal));

// Short near ATM: positive ₹/day but never above extrinsic left.
{
  const K2 = 24250;
  const px2 = 4.55;
  const qty2 = -520;
  const iv2 = impliedVol(px2, S, K2, T, 0.065, false);
  const g2 = greeks(S, K2, T, 0.065, iv2, false);
  const capped2 = dailyThetaRupees({
    thetaPerUnit: g2.theta,
    quantity: qty2,
    marketPrice: px2,
    S,
    K: K2,
    isCall: false,
    T,
  });
  const ext2 = extrinsicPremium(px2, S, K2, false) * 520;
  assert.ok(capped2 > 0);
  assert.ok(capped2 <= ext2 + 1e-6);
  const left = shortPremiumLeft({
    marketPrice: px2,
    S,
    K: K2,
    isCall: false,
    quantity: qty2,
    thetaPerUnit: g2.theta,
    nowMs,
    T,
  });
  assert.ok(left.extrinsicLeft != null);
  assert.ok(Math.abs(left.thetaToClose) <= left.extrinsicLeft + 1e-6);
}

console.log("dailyThetaRupees clamps OK");
