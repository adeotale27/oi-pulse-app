import { useMemo } from "react";
import { Shield, ShieldAlert, ShieldCheck, Info } from "lucide-react";
import { eventsWithinDays, impactScore } from "@/lib/econCalendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Composite overnight-hold risk score for the CURRENT index.
// Combines: (1) upcoming events, (2) VIX level, (3) net delta of positions,
// (4) days-to-expiry. Range 0..100. Red ≥ 65, Amber 35-64, Green < 35.
export default function OvernightRiskScore({ vix, netDelta, positionsCount, minutesToExpiry }) {
  const near = useMemo(() => eventsWithinDays(2), []);

  const { score, band, factors } = useMemo(() => {
    let s = 0;
    const f = [];

    // 1) Event exposure (heaviest weight): critical event within 2 days adds 40.
    const criticalNear = near.filter((e) => e.impact === "critical").length;
    const highNear = near.filter((e) => e.impact === "high").length;
    const eventPts = Math.min(45, criticalNear * 25 + highNear * 12);
    if (eventPts > 0) f.push({ k: "Events", v: eventPts, note: near.map((e) => e.name).slice(0, 3).join(", ") });
    s += eventPts;

    // 2) VIX: 12=calm, 14=normal, 18=elevated, 22+=stressed.
    let vixPts = 0;
    if (vix != null) {
      if (vix > 22) vixPts = 25;
      else if (vix > 18) vixPts = 15;
      else if (vix > 14) vixPts = 8;
      else vixPts = 0;
    }
    if (vixPts > 0) f.push({ k: "India VIX", v: vixPts, note: `${vix?.toFixed?.(1)} — volatility elevated` });
    s += vixPts;

    // 3) Net delta: absolute delta > 20 means directional exposure. Non-directional
    //    sellers should target |Δ| < 10.
    let deltaPts = 0;
    if (netDelta != null && positionsCount > 0) {
      const abs = Math.abs(netDelta);
      if (abs > 40) deltaPts = 25;
      else if (abs > 20) deltaPts = 15;
      else if (abs > 10) deltaPts = 6;
    }
    if (deltaPts > 0) f.push({ k: "Net Δ", v: deltaPts, note: `Portfolio delta ${netDelta?.toFixed?.(1)} — directional exposure` });
    s += deltaPts;

    // 4) Days to expiry (short DTE = pin risk).
    let dtePts = 0;
    if (minutesToExpiry != null && positionsCount > 0) {
      const dte = minutesToExpiry / (60 * 24);
      if (dte < 0.5) dtePts = 20;   // < 12h
      else if (dte < 1) dtePts = 15;
      else if (dte < 2) dtePts = 8;
    }
    if (dtePts > 0) f.push({ k: "DTE", v: dtePts, note: `Expiry very close — pin & gap risk` });
    s += dtePts;

    s = Math.min(100, s);
    let band = { label: "LOW", tone: "emerald", icon: <ShieldCheck className="w-4 h-4" /> };
    if (s >= 65) band = { label: "HIGH", tone: "rose", icon: <ShieldAlert className="w-4 h-4" /> };
    else if (s >= 35) band = { label: "MEDIUM", tone: "amber", icon: <Shield className="w-4 h-4" /> };
    return { score: s, band, factors: f };
  }, [near, vix, netDelta, positionsCount, minutesToExpiry]);

  const toneCls =
    band.tone === "rose" ? "bg-rose-50 text-rose-800 border-rose-300"
      : band.tone === "amber" ? "bg-amber-50 text-amber-800 border-amber-300"
        : "bg-emerald-50 text-emerald-800 border-emerald-300";

  const advice =
    band.tone === "rose" ? "Consider closing / hedging before market close."
      : band.tone === "amber" ? "Hold with reduced size and stop-loss."
        : "Safe to hold overnight if delta is neutral.";

  return (
    <div className={`rounded-xl border px-2.5 py-2 h-full flex flex-col gap-0.5 shadow-sm ${toneCls}`} data-testid="overnight-risk">
      <div className="flex items-center gap-2">
        {band.icon}
        <span className="text-[10px] uppercase tracking-widest opacity-70">Overnight Risk</span>
        <span className="ml-auto text-lg font-mono-data font-semibold" data-testid="overnight-risk-score">{score}<span className="text-xs opacity-60">/100</span></span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-sm font-semibold" data-testid="overnight-risk-band">{band.label}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button className="opacity-60 hover:opacity-100" title="Score breakdown">
              <Info className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900 text-sm">Score breakdown</div>
            {factors.length === 0 ? (
              <div className="text-slate-500">No elevated risk factors detected.</div>
            ) : (
              factors.map((f) => (
                <div key={f.k} className="flex items-start gap-2">
                  <span className="font-semibold w-16">+{f.v}</span>
                  <span className="font-semibold w-16">{f.k}</span>
                  <span className="flex-1 text-slate-600">{f.note}</span>
                </div>
              ))
            )}
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              Weights: events (max 45) · VIX (25) · net Δ (25) · DTE (20)
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="text-[11px] opacity-80 mt-1 leading-tight" data-testid="overnight-risk-advice">
        {advice}
      </div>
    </div>
  );
}
