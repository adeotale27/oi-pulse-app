import { useMemo } from "react";
import { classifyBuildups, aggregateBuildupBias } from "@/lib/buildup";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function toneClasses(tone) {
  switch (tone) {
    case "emerald": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "rose":    return "bg-rose-100 text-rose-800 border-rose-200";
    case "sky":     return "bg-sky-100 text-sky-800 border-sky-200";
    case "amber":   return "bg-amber-100 text-amber-800 border-amber-200";
    default:        return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function biasBarBg(bias) {
  // bias -1..+1 → gradient from rose to slate to emerald
  const alpha = Math.min(0.35, Math.abs(bias) * 0.35);
  if (bias > 0.05) return `rgba(22,163,74,${alpha.toFixed(3)})`;
  if (bias < -0.05) return `rgba(220,38,38,${alpha.toFixed(3)})`;
  return "rgba(148,163,184,0.08)";
}

function fmtOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

export default function BuildupTable({ current, previous, atm, timeframeLabel }) {
  const rows = useMemo(() => classifyBuildups({ current, previous }), [current, previous]);
  const agg = useMemo(() => aggregateBuildupBias(rows, atm, 3), [rows, atm]);

  if (!current || !rows.length) {
    return (
      <div className="text-xs text-slate-400 py-6 text-center">
        Need a previous snapshot to classify build-up. Wait for the next data pull…
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="buildup-table">
      {/* Verdict pill */}
      <div className={`rounded-md border px-3 py-2 flex items-center gap-4 text-xs ${toneClasses(agg.tone)}`} data-testid="buildup-verdict">
        <div>
          <span className="uppercase tracking-widest text-[9px] opacity-70">ATM Band Bias</span>
          <div className="text-lg font-semibold font-mono-data leading-tight" data-testid="buildup-verdict-score">
            {agg.score >= 0 ? "+" : ""}{agg.score}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold" data-testid="buildup-verdict-label">{agg.label}</div>
          <div className="text-[10px] opacity-70">
            Based on ATM ± 3 strikes · {timeframeLabel || "current window"}
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-slate-500 hover:text-slate-800" title="How to read this?">
              <Info className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs text-slate-700 space-y-2">
            <div className="font-semibold text-slate-900 text-sm">Long / Short Build-up cheat-sheet</div>
            <ul className="space-y-1 pl-2 text-[11px]">
              <li>🟢 <b>LB Long Build-up</b>: OI ↑ &amp; Price ↑ (fresh buyers). CE=bullish · PE=bearish.</li>
              <li>🔴 <b>SB Short Build-up</b>: OI ↑ &amp; Price ↓ (fresh writers). CE=bearish · PE=bullish.</li>
              <li>🔵 <b>SC Short Covering</b>: OI ↓ &amp; Price ↑ (writers exit). CE=bullish squeeze · PE=bearish.</li>
              <li>🟠 <b>LU Long Unwinding</b>: OI ↓ &amp; Price ↓ (buyers exit). CE=bearish · PE=bullish.</li>
            </ul>
            <div className="text-slate-500 text-[11px]">
              A cell shows the classification, ΔOI% and ΔLTP%. The row background tints by bullish bias for that strike.
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs font-mono-data">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-center px-2 py-2" colSpan={4}>Call side</th>
              <th className="text-center px-2 py-2 bg-slate-100">Strike</th>
              <th className="text-center px-2 py-2" colSpan={4}>Put side</th>
              <th className="text-center px-2 py-2">Bias</th>
            </tr>
            <tr>
              <th className="text-left px-2 py-1">Class</th>
              <th className="text-right px-2 py-1">ΔOI %</th>
              <th className="text-right px-2 py-1">ΔLTP %</th>
              <th className="text-right px-2 py-1">OI</th>
              <th className="text-center px-2 py-1 bg-slate-100"></th>
              <th className="text-right px-2 py-1">OI</th>
              <th className="text-right px-2 py-1">ΔLTP %</th>
              <th className="text-right px-2 py-1">ΔOI %</th>
              <th className="text-left px-2 py-1">Class</th>
              <th className="text-right px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isAtm = r.strike === atm;
              return (
                <tr
                  key={r.strike}
                  data-testid="buildup-row"
                  className={`border-b border-slate-100 hover:bg-slate-50 ${isAtm ? "bg-amber-50" : ""}`}
                  style={{ backgroundColor: isAtm ? undefined : biasBarBg(r.bias) }}
                >
                  <td className="px-2 py-1.5">
                    <span className={`inline-flex items-center border rounded-sm px-1.5 py-0.5 text-[10px] leading-none ${toneClasses(r.ce.tone)}`}>
                      {r.ce.short} · {r.ce.label}
                    </span>
                  </td>
                  <td className={`text-right px-2 py-1.5 ${r.ce_oi_pct >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {r.ce_oi_pct >= 0 ? "+" : ""}{r.ce_oi_pct.toFixed(1)}%
                  </td>
                  <td className={`text-right px-2 py-1.5 ${r.ce_ltp_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {r.ce_ltp_pct >= 0 ? "+" : ""}{r.ce_ltp_pct.toFixed(1)}%
                  </td>
                  <td className="text-right px-2 py-1.5 text-slate-700">{fmtOI(r.ce_oi)}</td>
                  <td className={`text-center px-2 py-1.5 font-semibold ${isAtm ? "text-amber-700" : "text-slate-900"}`}>
                    {r.strike}
                  </td>
                  <td className="text-right px-2 py-1.5 text-slate-700">{fmtOI(r.pe_oi)}</td>
                  <td className={`text-right px-2 py-1.5 ${r.pe_ltp_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {r.pe_ltp_pct >= 0 ? "+" : ""}{r.pe_ltp_pct.toFixed(1)}%
                  </td>
                  <td className={`text-right px-2 py-1.5 ${r.pe_oi_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {r.pe_oi_pct >= 0 ? "+" : ""}{r.pe_oi_pct.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-flex items-center border rounded-sm px-1.5 py-0.5 text-[10px] leading-none ${toneClasses(r.pe.tone)}`}>
                      {r.pe.short} · {r.pe.label}
                    </span>
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <span className={`inline-block w-16 h-1.5 rounded-full ${
                      r.bias > 0 ? "bg-emerald-500" : r.bias < 0 ? "bg-rose-500" : "bg-slate-300"
                    }`} style={{ opacity: Math.max(0.2, Math.abs(r.bias)) }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
