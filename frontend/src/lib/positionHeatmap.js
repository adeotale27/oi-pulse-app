/** Short strike label so heatmap tiles stay readable (not "SENSEX 14 AUG 24800 PE"). */
export function heatmapLabel(row) {
  if (!row) return "";
  if (row.strike != null && row.side) {
    return `${row.strike} ${String(row.side).toUpperCase()}`;
  }
  const name = String(row.display_name || row.tradingsymbol || "");
  const m = name.match(/(\d{4,6})\s*(CE|PE)\b/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}`;
  return name.replace(/^(NIFTY|SENSEX|BANKNIFTY)\s+/i, "").trim() || name;
}

/** Live book heatmap: open legs of the active index (not same-day exits). */
export function openHeatmapRows(rows = [], activeIndex = null) {
  const open = (rows || []).filter((r) => !r?.exited && Number(r?.quantity) !== 0);
  if (!activeIndex) return open;
  const want = String(activeIndex).toUpperCase();
  return open.filter((r) => {
    const idx = String(r?.index || "").toUpperCase();
    if (idx === want) return true;
    if (idx) return false;
    const name = String(r.display_name || r.tradingsymbol || "").toUpperCase();
    if (want === "BANKNIFTY") return name.includes("BANKNIFTY") || name.includes("BANK NIFTY");
    return name.includes(want);
  });
}
