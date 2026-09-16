/**
 * Unit tests for Strike Range → chart window filtering.
 * Run: node frontend/src/lib/strikeRange.test.js
 */
import assert from "node:assert/strict";
import { atmWindow, filterByStrikeRange, snapToStep } from "./strikeRange.js";

const chain = [];
for (let s = 23850; s <= 25350; s += 50) chain.push(s);

{
  let min = 24450;
  let max = 24650;
  min = snapToStep(min + 50, 50);
  const visible = filterByStrikeRange(chain, min, max);
  assert.equal(visible[0], 24500);
  assert.equal(visible.includes(24450), false);
  assert.equal(visible.includes(24500), true);
}

{
  let min = 24450;
  let max = 24650;
  max = snapToStep(max + 50, 50);
  const visible = filterByStrikeRange(chain, min, max);
  assert.equal(visible[visible.length - 1], 24700);
}

{
  const win = atmWindow(chain, 24550, 2);
  assert.equal(win.min, 24450);
  assert.equal(win.max, 24650);
  const visible = filterByStrikeRange(chain, win.min, win.max);
  assert.equal(visible.length, 5);
}

{
  const sensex = [];
  for (let s = 73000; s <= 76000; s += 100) sensex.push(s);
  const a = atmWindow(sensex, 74100, 10);
  assert.equal(a.min, 73100);
  assert.equal(a.max, 75100);
  const b = atmWindow(sensex, 74300, 10);
  assert.equal(b.min, 73300);
  assert.equal(b.max, 75300);
  const vis = filterByStrikeRange(sensex, b.min, b.max);
  assert.equal(vis.length, 21);
  assert.equal(vis[10], 74300);
  const c = atmWindow(sensex, 75000, 10);
  assert.equal(c.min, 74000);
  assert.equal(c.max, 76000);
  const visC = filterByStrikeRange(sensex, c.min, c.max);
  assert.equal(visC.length, 21);
  assert.equal(visC[10], 75000);
}

assert.ok(snapToStep(24473, 50) === 24450 || snapToStep(24473, 50) === 24500);
assert.equal(snapToStep(24500, 50), 24500);
assert.equal(snapToStep(24525, 50), 24550);

console.log("strikeRange.test.js: all assertions passed");
