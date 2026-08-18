import { useMemo } from "react";
import { eventsWithinDays } from "@/lib/econCalendar";
import InfoTip from "@/components/InfoTip";

// Same shell as Positions StatBox so this tile sits in the same row.
export default function OvernightRiskScore({ vix, netDelta, positionsCount, minutesToExpiry }) {
  const near = useMemo(() => eventsWithinDays(2), []);

  const { score, band, factors, advice } = useMemo(() => {
    let s = 0;
    const f = [];

    const criticalNear = near.filter((e) => e.impact === "critical").length;
    const highNear = near.filter((e) => e.impact === "high").length;
    const eventPts = Math.min(45, criticalNear * 25 + highNear * 12);
    if (eventPts > 0) f.push({ k: "Events", v: eventPts, note: near.map((e) => e.name).slice(0, 3).join(", ") });
    s += eventPts;

    let vixPts = 0;
    if (vix != null) {
      if (vix > 22) vixPts = 25;
      else if (vix > 18) vixPts = 15;
      else if (vix > 14) vixPts = 8;
    }
    if (vixPts > 0) f.push({ k: "India VIX", v: vixPts, note: `${vix?.toFixed?.(1)} — volatility elevated` });
    s += vixPts;

    let deltaPts = 0;
    if (netDelta != null && positionsCount > 0) {
      const abs = Math.abs(netDelta);
      if (abs > 40) deltaPts = 25;
      else if (abs > 20) deltaPts = 15;
      else if (abs > 10) deltaPts = 6;
    }
    if (deltaPts > 0) f.push({ k: "Net Δ", v: deltaPts, note: `Book delta ${netDelta?.toFixed?.(1)}` });
    s += deltaPts;

    let dtePts = 0;
    if (minutesToExpiry != null && positionsCount > 0) {
      const dte = minutesToExpiry / (60 * 24);
      if (dte < 0.5) dtePts = 20;
      else if (dte < 1) dtePts = 15;
      else if (dte < 2) dtePts = 8;
    }
    if (dtePts > 0) f.push({ k: "DTE", v: dtePts, note: "Expiry close — pin & gap risk" });
    s += dtePts;

    s = Math.min(100, s);
    let band = { label: "LOW", tone: "emerald" };
    if (s >= 65) band = { label: "HIGH", tone: "rose" };
    else if (s >= 35) band = { label: "MEDIUM", tone: "amber" };
    const advice =
      band.tone === "rose" ? "Cut or hedge before the close"
        : band.tone === "amber" ? "Hold smaller into the next open"
          : "Gap risk looks contained";
    return { score: s, band, factors: f, advice };
  }, [near, vix, netDelta, positionsCount, minutesToExpiry]);

  const cls =
    band.tone === "rose" ? "border-rose-300 bg-rose-50 text-rose-950"
      : band.tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-emerald-300 bg-emerald-50 text-emerald-950";

  return (
    <div className={`rounded-xl border px-2.5 py-2 h-full flex flex-col gap-0.5 shadow-sm ${cls}`} data-testid="overnight-risk">
      <div className="text-[10px] uppercase tracking-wide text-slate-700 font-semibold inline-flex items-center gap-1 pr-4 leading-none">
        Overnight risk
        <InfoTip title="Overnight risk" size="xs" testId="overnight-risk-tip">
          <p>Score 0–100 from events, India VIX, book delta, and days to expiry. Same size as the other insight tiles.</p>
          {factors.length ? (
            <ul className="mt-1 space-y-0.5">
              {factors.map((x) => (
                <li key={x.k}>+{x.v} {x.k} — {x.note}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-slate-500">No elevated factors.</p>
          )}
        </InfoTip>
      </div>
      <div className="text-[17px] font-semibold font-mono-data leading-none tabular-nums" data-testid="overnight-risk-score">
        {score}<span className="text-[11px] opacity-60">/100</span>
        <span className="ml-1.5 text-[11px] font-bold tracking-wide" data-testid="overnight-risk-band">{band.label}</span>
      </div>
      <div className="text-[10px] text-slate-600 leading-tight" data-testid="overnight-risk-advice">{advice}</div>
    </div>
  );
}
