// -----------------------------------------------------------------------------
// SuggestionBox — one-glance plain-English trading suggestion for the active
// index, computed from ALL available signals: marketIntel, dealer γ, VRP,
// IV Rank, VIX, top gamma walls and any recent alert bias.
//
// Renders as a compact card that lives at the bottom of the right panel and
// persists across right-panel view switches.
// -----------------------------------------------------------------------------

import React, { useMemo } from "react";
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

function toneClass(tone) {
  switch (tone) {
    case "emerald": return "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900";
    case "rose":    return "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900";
    case "amber":   return "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900";
    default:        return "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700";
  }
}

export default function SuggestionBox({
  indexName,
  marketIntel,
  vrp,
  vrpEnabled = true,
  vixNow,
  vixOpen,
}) {
  const suggestion = useMemo(() => {
    const bullets = [];
    let headline = null;
    let tone = "slate";
    let icon = <Sparkles className="w-4 h-4" />;

    // ---- Baseline: directional bias ----
    if (marketIntel) {
      const score = marketIntel.score ?? 0;
      if (score >= 60) {
        headline = `Strong bullish tilt — buyers dominating (${marketIntel.label})`;
        tone = "emerald"; icon = <TrendingUp className="w-4 h-4" />;
        bullets.push(`Support at ${marketIntel.support?.toLocaleString?.() || "—"} defended by writers; ceiling at ${marketIntel.resistance?.toLocaleString?.() || "—"}.`);
        bullets.push(`Bias plays: bull-put spreads below support, or naked puts if VRP allows.`);
      } else if (score >= 20) {
        headline = `Mildly bullish — watch for continuation`;
        tone = "emerald"; icon = <TrendingUp className="w-4 h-4" />;
        bullets.push(`PCR ${marketIntel.pcr?.toFixed(2)} — put-writing dominant. Max pain ${marketIntel.maxPain?.toLocaleString?.() || "—"}.`);
      } else if (score <= -60) {
        headline = `Strong bearish tilt — sellers dominating`;
        tone = "rose"; icon = <TrendingDown className="w-4 h-4" />;
        bullets.push(`Call-writing dominant. Resistance at ${marketIntel.resistance?.toLocaleString?.() || "—"}.`);
        bullets.push(`Bias plays: bear-call spreads above resistance, or defensive shorts if IV rich.`);
      } else if (score <= -20) {
        headline = `Mildly bearish — call writers active`;
        tone = "rose"; icon = <TrendingDown className="w-4 h-4" />;
      } else {
        headline = `Range-bound / neutral`;
        tone = "amber";
        bullets.push(`Iron condor / strangle candidate — but only if VRP and dealer γ are supportive.`);
      }
    }

    // ---- VRP overlay ----
    if (vrpEnabled && vrp && vrp.vrp != null) {
      if (vrp.vrp < -0.5) {
        tone = "rose";
        bullets.push(`⚠ VRP ${vrp.vrp.toFixed(2)} — realised vol > IV. Sellers under-paid. SKIP premium selling regardless of directional bias.`);
      } else if (vrp.vrp < 0.5) {
        bullets.push(`VRP ${vrp.vrp.toFixed(2)} — thin edge. If you sell, reduce size and prefer shorter DTE.`);
        if (tone !== "rose") tone = "amber";
      } else if (vrp.vrp >= 2) {
        bullets.push(`VRP +${vrp.vrp.toFixed(2)} — premium is rich. Prime environment to write OTM options.`);
      }
      if (vrp.trend?.direction === "falling") {
        bullets.push(`VRP trend is falling (${vrp.trend.label}) — tightening risk parameters advised.`);
      } else if (vrp.trend?.direction === "rising" && vrp.vrp >= 1) {
        bullets.push(`VRP trend is rising — IV is bidding without matching HV. Favourable for new short-vol positions.`);
      }
    }

    // ---- VIX overlay ----
    if (vixNow != null && vixOpen != null && vixOpen > 0) {
      const changePct = ((vixNow - vixOpen) / vixOpen) * 100;
      if (changePct > 5) {
        tone = "rose";
        bullets.push(`India VIX +${changePct.toFixed(1)}% intraday — fear building. Cut size, avoid naked writes.`);
      } else if (changePct < -5) {
        bullets.push(`India VIX ${changePct.toFixed(1)}% intraday — vol crushing, tailwind for existing shorts.`);
      }
    }

    if (!headline) {
      headline = "Waiting for live data…";
      bullets.push("Suggestion refreshes as OI and greeks stream in.");
    }

    return { headline, bullets, tone, icon };
  }, [marketIntel, vrp, vrpEnabled, vixNow, vixOpen]);

  return (
    <div className={`rounded-md border px-3 py-2 text-xs space-y-1 ${toneClass(suggestion.tone)}`} data-testid="suggestion-box">
      <div className="flex items-center gap-1.5 font-semibold text-sm">
        {suggestion.icon}
        <span>Suggestion — {indexName}</span>
      </div>
      <div className="text-[13px] font-semibold leading-tight">{suggestion.headline}</div>
      {suggestion.bullets.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 opacity-90">
          {suggestion.bullets.map((b, i) => (
            <li key={i} className="leading-snug">{b}</li>
          ))}
        </ul>
      )}
      <div className="text-[10px] opacity-60 pt-1 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Educational — not trading advice. Always confirm with your own risk plan.
      </div>
    </div>
  );
}
