/** Map open Kite option legs onto OI chart strikes (B = long, S = short). */

export function optionMarkSide(row) {
  const s = String(row?.side || row?.option_type || "").toUpperCase();
  if (s === "CE" || s === "CALL") return "CE";
  if (s === "PE" || s === "PUT") return "PE";
  return "";
}

export function openOiMarks(positions, indexName) {
  const want = String(indexName || "").toUpperCase();
  const net = new Map();
  for (const row of positions || []) {
    if (!row || row.exited) continue;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const rowIdx = String(row.index || row.underlying || "").toUpperCase();
    if (want && rowIdx && rowIdx !== want) continue;
    const side = optionMarkSide(row);
    if (!side) continue;
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    const key = `${strike}|${side}`;
    net.set(key, (net.get(key) || 0) + qty);
  }
  const marks = [];
  for (const [key, qty] of net) {
    if (!qty) continue;
    const [strike, side] = key.split("|");
    marks.push({ strike: Number(strike), side, tag: qty < 0 ? "S" : "B" });
  }
  return marks;
}

export function peTopKey(d) {
  if ((d.pe_down || 0) > 0) return "pe_down";
  if ((d.pe_up || 0) > 0) return "pe_up";
  return "pe_base";
}

export function ceTopKey(d) {
  if ((d.ce_down || 0) > 0) return "ce_down";
  if ((d.ce_up || 0) > 0) return "ce_up";
  return "ce_base";
}
