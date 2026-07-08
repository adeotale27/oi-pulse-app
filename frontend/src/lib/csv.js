/**
 * CSV export helper for OI snapshot data.
 */
export function downloadOICsv(current, previous, indexName) {
  if (!current || !current.strikes) return;
  const prevMap = new Map();
  (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));
  const header = [
    "strike",
    "call_oi",
    "call_ltp",
    "call_oi_prev",
    "call_oi_change",
    "call_oi_change_pct",
    "put_oi",
    "put_ltp",
    "put_oi_prev",
    "put_oi_change",
    "put_oi_change_pct",
  ];
  const rows = current.strikes.map((s) => {
    const p = prevMap.get(s.strike) || {};
    const ceChange = s.ce_oi - (p.ce_oi ?? s.ce_oi);
    const peChange = s.pe_oi - (p.pe_oi ?? s.pe_oi);
    const cePct = p.ce_oi ? ((ceChange / p.ce_oi) * 100).toFixed(2) : "0";
    const pePct = p.pe_oi ? ((peChange / p.pe_oi) * 100).toFixed(2) : "0";
    return [
      s.strike,
      s.ce_oi,
      s.ce_ltp,
      p.ce_oi ?? "",
      ceChange,
      cePct,
      s.pe_oi,
      s.pe_ltp,
      p.pe_oi ?? "",
      peChange,
      pePct,
    ].join(",");
  });
  const meta = [
    `# ${indexName} Open Interest snapshot`,
    `# Current: ${current.timestamp}  Price: ${current.price}  ATM: ${current.atm}  PCR: ${current.pcr}  VIX: ${current.vix}`,
    `# Previous: ${previous?.timestamp || "N/A"}`,
    `# Expiry: ${current.expiry}`,
  ].join("\n");
  const csv = [meta, header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `oi_${indexName}_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
