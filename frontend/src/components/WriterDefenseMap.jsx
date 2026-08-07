import { useMemo } from "react";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { computeWriterDefense } from "@/lib/writerDefense";

function toneText(tone) {
  if (tone === "emerald") return "text-emerald-700 dark:text-emerald-300";
  if (tone === "rose") return "text-rose-700 dark:text-rose-300";
  if (tone === "amber") return "text-amber-700 dark:text-amber-300";
  return "text-slate-600 dark:text-slate-400";
}

function toneBg(tone) {
  if (tone === "emerald") return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800";
  if (tone === "rose") return "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800";
  if (tone === "amber") return "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800";
  return "bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700";
}

function fmtOi(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}

/**
 * Writer defense map — ATM± strikes that kept Put/Call OI through the day
 * (session open → now), not the short-window ΔOI bars.
 */
export default function WriterDefenseMap({
  current,
  sessionPrevious,
  band = 3,
  marketOpen = true,
}) {
  const map = useMemo(
    () => computeWriterDefense({ current, sessionPrevious, band }),
    [current, sessionPrevious, band],
  );

  if (!map) return null;

  const { summary, rows, atm, spot } = map;
  const Icon =
    summary.tone === "rose" ? ShieldAlert : summary.tone === "emerald" ? ShieldCheck : Shield;

  return (
    <div
      className={`rounded-md border px-3 py-2 ${toneBg(summary.tone)}`}
      data-testid="writer-defense-map"
      data-market={marketOpen ? "open" : "closed"}
    >
      <div className="flex items-start gap-2 mb-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${toneText(summary.tone)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Writer defense · ATM±{band}
            </span>
            <InfoTip testId="writer-defense-info" size="xs" title="Writer defense map">
              <p>
                Tracks which ATM± strikes <strong>kept</strong> Put / Call OI from session
                open (≈ 9:15) through the latest snapshot — not the 15-minute change bars.
              </p>
              <p className="mt-2">
                <strong>Support held</strong> = put writers still parked.
                {" "}
                <strong>Support cracked</strong> = put OI unwound (or spot broke through while
                OI faded). Same idea for call resistance above ATM.
              </p>
              <p className="mt-2 text-slate-500">
                Actionable for “where did the wall hold?” — Sensibull-style Δ bars alone do not
                answer that.
              </p>
            </InfoTip>
          </div>
          <div
            className={`text-sm font-semibold leading-snug ${toneText(summary.tone)}`}
            data-testid="writer-defense-headline"
          >
            {summary.headline}
          </div>
          <div className="text-[10px] font-mono-data text-slate-500 dark:text-slate-400 mt-0.5">
            Spot {spot != null ? Number(spot).toFixed(0) : "—"} · ATM {atm}
            {!marketOpen ? " · final session map" : " · whole day"}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[11px] min-w-[28rem]" data-testid="writer-defense-table">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-black/5 dark:border-white/10">
              <th className="text-left font-medium py-1 px-1">Strike</th>
              <th className="text-left font-medium py-1 px-1">Put support</th>
              <th className="text-right font-medium py-1 px-1">ΔPE</th>
              <th className="text-left font-medium py-1 px-1">Call resist</th>
              <th className="text-right font-medium py-1 px-1">ΔCE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.strike}
                className={`border-b border-black/5 dark:border-white/5 ${
                  r.isAtm ? "bg-white/50 dark:bg-black/20 font-semibold" : ""
                }`}
                data-testid={`writer-defense-row-${r.strike}`}
              >
                <td className="py-1 px-1 font-mono-data whitespace-nowrap">
                  {r.strike}
                  {r.isAtm ? (
                    <span className="ml-1 text-[9px] uppercase text-slate-400">ATM</span>
                  ) : (
                    <span className="ml-1 text-[9px] text-slate-400">
                      {r.offset > 0 ? `+${r.offset}` : r.offset}
                    </span>
                  )}
                </td>
                <td className={`py-1 px-1 ${toneText(r.put.tone)}`}>
                  <span title={`Open ${fmtOi(r.put.open)} → now ${fmtOi(r.put.now)}`}>
                    {r.put.label}
                  </span>
                </td>
                <td className="py-1 px-1 text-right font-mono-data text-slate-600 dark:text-slate-300">
                  {fmtPct(r.put.deltaPct)}
                </td>
                <td className={`py-1 px-1 ${toneText(r.call.tone)}`}>
                  <span title={`Open ${fmtOi(r.call.open)} → now ${fmtOi(r.call.now)}`}>
                    {r.call.label}
                  </span>
                </td>
                <td className="py-1 px-1 text-right font-mono-data text-slate-600 dark:text-slate-300">
                  {fmtPct(r.call.deltaPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
