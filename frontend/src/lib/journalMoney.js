/** Journal money labels: paisa on desktop, short rounded on phone cells. */

export function fmtInr(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
  return `${n < 0 ? "−" : ""}₹${body}`;
}

/** Signed exact rupees (desktop / day editor). */
export function exactPnl(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  const body = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}₹${body}`;
}

/** Short rounded label for phone calendar / tiles (₹47.5k, ₹1.2L). */
export function compactPnl(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}
