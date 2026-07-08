import { useMemo } from "react";

function formatOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

export default function StrikeTable({ current, previous, atm }) {
  const rows = useMemo(() => {
    if (!current) return [];
    const prevMap = new Map();
    (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    return current.strikes.map((s) => {
      const p = prevMap.get(s.strike) || {};
      const ce_delta = s.ce_oi - (p.ce_oi ?? s.ce_oi);
      const pe_delta = s.pe_oi - (p.pe_oi ?? s.pe_oi);
      return {
        strike: s.strike,
        ce_oi: s.ce_oi,
        ce_ltp: s.ce_ltp,
        pe_ltp: s.pe_ltp,
        pe_oi: s.pe_oi,
        ce_delta,
        pe_delta,
        ce_pct: p.ce_oi ? (ce_delta / p.ce_oi) * 100 : 0,
        pe_pct: p.pe_oi ? (pe_delta / p.pe_oi) * 100 : 0,
      };
    });
  }, [current, previous]);

  if (!current) return null;

  return (
    <div className="overflow-auto" data-testid="strike-table">
      <table className="w-full text-xs font-mono-data">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-right px-3 py-2">Call Δ%</th>
            <th className="text-right px-3 py-2">Call OI</th>
            <th className="text-right px-3 py-2">Call LTP</th>
            <th className="text-center px-3 py-2 bg-slate-100">Strike</th>
            <th className="text-right px-3 py-2">Put LTP</th>
            <th className="text-right px-3 py-2">Put OI</th>
            <th className="text-right px-3 py-2">Put Δ%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isAtm = r.strike === atm;
            return (
              <tr
                key={r.strike}
                className={`border-b border-slate-100 hover:bg-slate-50 ${isAtm ? "bg-amber-50" : ""}`}
              >
                <td className={`text-right px-3 py-1.5 ${r.ce_pct >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {r.ce_pct >= 0 ? "+" : ""}{r.ce_pct.toFixed(2)}%
                </td>
                <td className="text-right px-3 py-1.5 text-slate-800">{formatOI(r.ce_oi)}</td>
                <td className="text-right px-3 py-1.5 text-slate-600">{r.ce_ltp?.toFixed?.(2)}</td>
                <td className={`text-center px-3 py-1.5 font-semibold ${isAtm ? "text-amber-700" : "text-slate-900"}`}>
                  {r.strike}
                </td>
                <td className="text-right px-3 py-1.5 text-slate-600">{r.pe_ltp?.toFixed?.(2)}</td>
                <td className="text-right px-3 py-1.5 text-slate-800">{formatOI(r.pe_oi)}</td>
                <td className={`text-right px-3 py-1.5 ${r.pe_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.pe_pct >= 0 ? "+" : ""}{r.pe_pct.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
