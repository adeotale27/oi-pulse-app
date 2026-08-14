/** Compact live OI tape for Desk AI (no full strike grid). */

export function summarizeIndexTape(current, previous) {
  if (!current || typeof current !== "object") return null;
  const strikes = Array.isArray(current.strikes) ? current.strikes : [];
  const prevMap = new Map(
    (Array.isArray(previous?.strikes) ? previous.strikes : []).map((s) => [s.strike, s]),
  );
  let ceChg = 0;
  let peChg = 0;
  let callWall = null;
  let putWall = null;
  for (const s of strikes) {
    const p = prevMap.get(s.strike);
    ceChg += (Number(s.ce_oi) || 0) - (Number(p?.ce_oi) || 0);
    peChg += (Number(s.pe_oi) || 0) - (Number(p?.pe_oi) || 0);
    const ce = Number(s.ce_oi) || 0;
    const pe = Number(s.pe_oi) || 0;
    if (!callWall || ce > callWall.oi) callWall = { k: s.strike, oi: ce };
    if (!putWall || pe > putWall.oi) putWall = { k: s.strike, oi: pe };
  }
  const pcr = Number(current.pcr);
  const px = Number(current.price);
  const atm = Number(current.atm);
  return {
    idx: String(current.index || "").slice(0, 16) || null,
    px: Number.isFinite(px) ? Math.round(px * 100) / 100 : null,
    atm: Number.isFinite(atm) ? atm : null,
    pcr: Number.isFinite(pcr) ? Math.round(pcr * 100) / 100 : null,
    ceChg: Math.round(ceChg),
    peChg: Math.round(peChg),
    callWall: callWall?.k ?? null,
    putWall: putWall?.k ?? null,
    expiry: current.expiry ? String(current.expiry).slice(0, 10) : null,
  };
}

export function compactBookFromPositions(data) {
  const rows = Array.isArray(data?.positions) ? data.positions : [];
  const open = rows.filter((r) => !r.exited && Number(r.quantity) !== 0);
  const shorts = open.filter((r) => Number(r.quantity) < 0 && r.strike && r.side);
  const byIndex = {};
  const legs = [];
  for (const r of shorts) {
    const idx = String(r.index || "").slice(0, 16) || "UNK";
    if (!byIndex[idx]) byIndex[idx] = { ce: 0, pe: 0, n: 0 };
    if (r.side === "CE") byIndex[idx].ce += 1;
    else if (r.side === "PE") byIndex[idx].pe += 1;
    byIndex[idx].n += 1;
    const S = Number(r.spot || r.spotUsed);
    const K = Number(r.strike);
    let dist = null;
    let itm = false;
    if (Number.isFinite(S) && S > 0 && Number.isFinite(K)) {
      dist = Number((((K - S) / S) * 100).toFixed(2));
      itm = r.side === "CE" ? S > K : S < K;
    }
    legs.push({
      s: String(r.tradingsymbol || "").slice(0, 24),
      side: r.side === "PE" ? "PE" : "CE",
      K,
      idx,
      dist,
      itm,
      close: false,
    });
  }
  return {
    book: {
      openCount: open.length,
      shortCount: shorts.length,
      byIndex,
    },
    adjust: {
      shortCount: shorts.length,
      adjustCount: 0,
      legs: legs.slice(0, 8),
    },
  };
}

export function fmtOiLakh(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  if (Math.abs(v) >= 100000) return `${sign}${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `${sign}${(v / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(v)}`;
}
