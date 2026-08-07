/**
 * Unit tests for Strike Range → chart window filtering.
 * Run: node frontend/src/lib/strikeRange.test.js
 */
function filterByStrikeRange(strikes, min, max) {
  const sorted = [...strikes].sort((a, b) => a - b);
  if (min == null || max == null || min === "" || max === "") return sorted;
  const lo = Math.min(Number(min), Number(max));
  const hi = Math.max(Number(min), Number(max));
  return sorted.filter((s) => s >= lo && s <= hi);
}

function snapToStep(value, step) {
  const n = Number(value);
  if (!Number.isFinite(n) || !step) return n;
  return Math.round(n / step) * step;
}

function atmWindow(strikes, atm, n) {
  const sorted = [...strikes].sort((a, b) => a - b);
  if (n === "all") return { min: sorted[0], max: sorted[sorted.length - 1] };
  const atmIdx = sorted.findIndex((s) => s === atm);
  if (atmIdx < 0) return { min: sorted[0], max: sorted[sorted.length - 1] };
  const lo = Math.max(0, atmIdx - n);
  const hi = Math.min(sorted.length - 1, atmIdx + n);
  return { min: sorted[lo], max: sorted[hi] };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const chain = [];
for (let s = 23850; s <= 25350; s += 50) chain.push(s);

// +/- on min drops left edge of chart
{
  let min = 24450;
  let max = 24650;
  min = snapToStep(min + 50, 50); // user hits +
  const visible = filterByStrikeRange(chain, min, max);
  assert(visible[0] === 24500, `expected left edge 24500 got ${visible[0]}`);
  assert(!visible.includes(24450), "24450 must leave the chart after min +");
  assert(visible.includes(24500), "24500 must remain");
}

// +/- on max raises right edge
{
  let min = 24450;
  let max = 24650;
  max = snapToStep(max + 50, 50);
  const visible = filterByStrikeRange(chain, min, max);
  assert(visible[visible.length - 1] === 24700, `expected right edge 24700 got ${visible.at(-1)}`);
}

// ATM±2 quick pick sets a tight window the chart follows
{
  const win = atmWindow(chain, 24550, 2);
  assert(win.min === 24450 && win.max === 24650, `ATM±2 expected 24450-24650 got ${win.min}-${win.max}`);
  const visible = filterByStrikeRange(chain, win.min, win.max);
  assert(visible.length === 5, `ATM±2 should show 5 strikes, got ${visible.length}`);
}

// Snap NIFTY to 50
assert(snapToStep(24473, 50) === 24450 || snapToStep(24473, 50) === 24500, "snap nearby");
assert(snapToStep(24500, 50) === 24500, "exact snap");
assert(snapToStep(24525, 50) === 24550, "round half up-ish");

console.log("strikeRange.test.js: all assertions passed");
