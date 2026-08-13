import { useEffect, useMemo, useState } from "react";
import { fetchOIChange } from "@/lib/api";
import { computeOiRisk, oiChangePctFromSnapshots } from "@/lib/oiRiskMeter";
import InfoTip from "@/components/InfoTip";

const ACTION_TONE = {
  Hold: "bg-emerald-50 text-emerald-800 border-emerald-300",
  Reduce: "bg-amber-50 text-amber-900 border-amber-300",
  Close: "bg-rose-50 text-rose-800 border-rose-300",
};

export default function OiRiskMeter({
  activeIndex,
  expiry,
  rows = [],
}) {
  const [pct, setPct] = useState({ cePct: 0, pePct: 0 });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchOIChange(activeIndex, 15, { expiry });
        const next = oiChangePctFromSnapshots(data?.current, data?.previous);
        if (alive) setPct(next);
      } catch {
        /* keep last */
      }
    })();
    return () => { alive = false; };
  }, [activeIndex, expiry]);

  const nearest = useMemo(() => {
    const shorts = (rows || []).filter((r) => !r.exited && r.isOpt && r.isShort && r.spotUsed && r.strike);
    if (!shorts.length) return { dist: null, side: null, breached: false, symbol: null };
    let best = null;
    for (const r of shorts) {
      const d = Math.abs((r.strike - r.spotUsed) / r.spotUsed) * 100;
      if (best == null || d < best.dist) {
        best = { dist: d, side: r.side, breached: !!r.breachedAdjust, symbol: r.display_name || r.tradingsymbol };
      }
    }
    return best;
  }, [rows]);

  const risk = computeOiRisk({
    cePct: pct.cePct,
    pePct: pct.pePct,
    nearestShortDistPct: nearest.dist,
    nearestShortSide: nearest.side,
    breachedAdjust: nearest.breached,
  });

  const tone = ACTION_TONE[risk.action] || ACTION_TONE.Hold;

  return (
    <div className={`rounded-md border-2 px-3 py-2 ${tone}`} data-testid="oi-risk-meter">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest opacity-70">OI Risk Meter</span>
        <InfoTip title="Intraday adjustment, not overnight" testId="oi-risk-meter-tip">
          <p>
            For a non-directional seller: <b>new OI writing</b> is a trend starting.
            Either exit before it hits your strike, or reduce/roll to stay with protected risk.
          </p>
          <p className="mt-1">Uses 15-min OI change on {activeIndex} plus distance to your nearest sold strike.</p>
        </InfoTip>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
        <div>
          <div className="text-[9px] uppercase tracking-wider opacity-70">15m OI</div>
          <div className="font-mono-data text-sm font-bold" data-testid="oi-risk-oi-pct">
            {risk.oiPct >= 0 ? "+" : ""}{risk.oiPct.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider opacity-70">To short</div>
          <div className="font-mono-data text-sm font-bold" data-testid="oi-risk-dist">
            {risk.distPct == null ? "—" : `${risk.distPct.toFixed(2)}%`}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider opacity-70">Action</div>
          <div className="text-sm font-bold" data-testid="oi-risk-action">{risk.action}</div>
        </div>
      </div>
      <div className="text-[11px] opacity-80 mt-1 leading-tight" data-testid="oi-risk-reason">
        {risk.reason}
        {nearest.symbol ? ` · ${nearest.symbol}` : ""}
      </div>
    </div>
  );
}
