/** Chart strike window: ATM ± N stays centered when spot moves. */

export function filterByStrikeRange(strikes, min, max) {
  const sorted = [...strikes].sort((a, b) => a - b);
  if (min == null || max == null || min === "") return sorted;
  const lo = Math.min(Number(min), Number(max));
  const hi = Math.max(Number(min), Number(max));
  return sorted.filter((s) => s >= lo && s <= hi);
}

export function snapToStep(value, step) {
  const n = Number(value);
  if (!Number.isFinite(n) || !step) return n;
  return Math.round(n / step) * step;
}

export function nearestStrikeIndex(sorted, atm) {
  if (!sorted.length) return -1;
  const target = Number(atm);
  if (!Number.isFinite(target)) return -1;
  let best = 0;
  let bestAbs = Math.abs(sorted[0] - target);
  for (let i = 1; i < sorted.length; i += 1) {
    const d = Math.abs(sorted[i] - target);
    if (d < bestAbs) {
      best = i;
      bestAbs = d;
    }
  }
  return best;
}

/** Inclusive min/max so ATM is centered with `n` strikes each side (or full chain). */
export function atmWindow(strikes, atm, n) {
  const sorted = [...strikes].sort((a, b) => a - b);
  if (!sorted.length) return { min: null, max: null };
  if (n === "all") return { min: sorted[0], max: sorted[sorted.length - 1] };
  const count = Number(n);
  if (!Number.isFinite(count) || count < 0) return { min: sorted[0], max: sorted[sorted.length - 1] };
  let atmIdx = sorted.findIndex((s) => s === atm);
  if (atmIdx < 0) atmIdx = nearestStrikeIndex(sorted, atm);
  if (atmIdx < 0) return { min: sorted[0], max: sorted[sorted.length - 1] };
  const lo = Math.max(0, atmIdx - count);
  const hi = Math.min(sorted.length - 1, atmIdx + count);
  return { min: sorted[lo], max: sorted[hi] };
}
