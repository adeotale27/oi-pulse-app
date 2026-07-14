// -----------------------------------------------------------------------------
// Metric guides — one source of truth for the zone thresholds shown as
// hover-tips next to every indicator across the dashboard.
//
// Each guide function returns a React node describing:
//   • what the metric measures (1-line summary)
//   • its zone thresholds as a table (current zone highlighted)
//   • the action suggestion at the CURRENT reading
//
// Kept as pure functional JSX so the InfoTip Popover can render them as-is.
// -----------------------------------------------------------------------------

import React from "react";

const rowBase = "flex items-center justify-between gap-3 py-1";
const zoneClass = (active, tone) => {
  if (!active) return "text-slate-500 dark:text-slate-400";
  if (tone === "emerald") return "text-emerald-700 dark:text-emerald-300 font-semibold";
  if (tone === "rose")    return "text-rose-700 dark:text-rose-300 font-semibold";
  if (tone === "amber")   return "text-amber-700 dark:text-amber-300 font-semibold";
  return "text-slate-800 dark:text-slate-100 font-semibold";
};

function ZoneTable({ title, description, zones, currentZone, action }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      {description && <div className="text-slate-600 dark:text-slate-300">{description}</div>}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-1">
        {zones.map((z) => (
          <div key={z.key} className={`${rowBase} ${zoneClass(z.key === currentZone, z.tone)}`}>
            <span>{z.range}</span>
            <span className="text-right">{z.label}</span>
          </div>
        ))}
      </div>
      {action && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-1 text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Now:</span> {action}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IV Rank — anchored to India VIX 52-week band (fallback: static 7-35 range)
// ---------------------------------------------------------------------------
export function ivRankGuide(ivRank) {
  const zones = [
    { key: "rich",   range: "≥ 70",    label: "Rich · sell aggressively",     tone: "emerald" },
    { key: "high",   range: "50 – 69", label: "Above average · sell OK",      tone: "emerald" },
    { key: "fair",   range: "30 – 49", label: "Fair · normal size",           tone: "amber" },
    { key: "low",    range: "15 – 29", label: "Cheap · reduce size",          tone: "amber" },
    { key: "veryLow",range: "< 15",    label: "Very cheap · avoid selling",   tone: "rose" },
  ];
  let currentZone = null, action = null;
  if (ivRank != null) {
    if (ivRank >= 70)      { currentZone = "rich";    action = "Rich premium environment — writers get paid well for the risk."; }
    else if (ivRank >= 50) { currentZone = "high";    action = "Above-average premium — normal position sizing OK."; }
    else if (ivRank >= 30) { currentZone = "fair";    action = "Fair premium — trade regular size but avoid over-selling."; }
    else if (ivRank >= 15) { currentZone = "low";     action = "Premium is thin — smaller size, wider strikes, shorter DTE."; }
    else                   { currentZone = "veryLow"; action = "Skip premium selling — market not paying enough for the risk."; }
  }
  return (
    <ZoneTable
      title="IV Rank"
      description={"How rich India VIX is vs its recent range. Higher = better for premium sellers."}
      zones={zones}
      currentZone={currentZone}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// VRP (IV − Realised Vol) — the sharper cousin of IV Rank
// ---------------------------------------------------------------------------
export function vrpGuide(vrp) {
  const zones = [
    { key: "rich", range: "> +2",           label: "Rich · sell size",            tone: "emerald" },
    { key: "fair", range: "+0.5 to +2",     label: "Fair · normal size",          tone: "emerald" },
    { key: "thin", range: "-0.5 to +0.5",   label: "Thin · reduce size",          tone: "amber" },
    { key: "poor", range: "< -0.5",         label: "HV outrunning IV · SKIP",     tone: "rose" },
  ];
  let currentZone = null, action = null;
  if (vrp != null) {
    if (vrp >= 2)         { currentZone = "rich"; action = "IV meaningfully above realised vol — best selling environment."; }
    else if (vrp >= 0.5)  { currentZone = "fair"; action = "Sellers over-paid vs actual movement — trade normal size."; }
    else if (vrp >= -0.5) { currentZone = "thin"; action = "Edge is thin — reduce size, widen strikes, prefer shorter DTE."; }
    else                  { currentZone = "poor"; action = "Realised vol is running ABOVE implied vol — sellers are under-paid. SKIP."; }
  }
  return (
    <ZoneTable
      title="Volatility Risk Premium (IV − HV₁₀)"
      description="Is IV cheap or expensive relative to how the market is actually moving right now? Better than IV Rank alone because it compares against real movement, not history."
      zones={zones}
      currentZone={currentZone}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// Dealer Gamma (GEX-lite)
// ---------------------------------------------------------------------------
export function dealerGammaGuide(gexT) {
  const zones = [
    { key: "positive", range: "> +50 T", label: "Long gamma · sticky range",       tone: "emerald" },
    { key: "neutral",  range: "-50 to +50 T", label: "Neutral · no tailwind",       tone: "amber" },
    { key: "negative", range: "< -50 T", label: "Short gamma · trending / expansion", tone: "rose" },
  ];
  let currentZone = null, action = null;
  if (gexT != null) {
    if (gexT > 50)       { currentZone = "positive"; action = "Dealers are long gamma → hedging dampens moves. Range-bound regime, safer to sell strangles / iron condors."; }
    else if (gexT < -50) { currentZone = "negative"; action = "Dealers are short gamma → hedging accelerates moves. Avoid naked selling; only defensive spreads."; }
    else                 { currentZone = "neutral";  action = "No structural tailwind for premium sellers — trade with tighter risk parameters."; }
  }
  return (
    <ZoneTable
      title="Dealer Gamma (GEX)"
      description="Aggregate dealer gamma exposure. Positive = market makers hedge INTO stability. Negative = hedging accelerates moves (trend regime)."
      zones={zones}
      currentZone={currentZone}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// India VIX
// ---------------------------------------------------------------------------
export function vixGuide(vixNow, changePct) {
  const zones = [
    { key: "veryLow",  range: "< 11",   label: "Very calm · thin premiums",   tone: "rose" },
    { key: "low",      range: "11 – 14",label: "Calm · normal regime",        tone: "amber" },
    { key: "mid",      range: "14 – 20",label: "Elevated · richer premiums",  tone: "emerald" },
    { key: "high",     range: "≥ 20",   label: "Fear · size down, wait",      tone: "rose" },
  ];
  let currentZone = null, action = null;
  if (vixNow != null) {
    if (vixNow >= 20)      currentZone = "high";
    else if (vixNow >= 14) currentZone = "mid";
    else if (vixNow >= 11) currentZone = "low";
    else                   currentZone = "veryLow";
  }
  if (changePct != null) {
    if (changePct > 5)      action = `VIX up ${changePct.toFixed(1)}% intraday — fear is building. Cut size or wait.`;
    else if (changePct < -5) action = `VIX down ${changePct.toFixed(1)}% — vol is crushing, good tailwind for existing shorts.`;
    else                    action = `VIX flat (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%) — no intraday regime change.`;
  }
  return (
    <ZoneTable
      title="India VIX"
      description="30-day forward ATM implied vol on the NIFTY. NSE's official fear gauge."
      zones={zones}
      currentZone={currentZone}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// Composite Sell-Safety Score (per row)
// ---------------------------------------------------------------------------
export function scoreGuide(score) {
  const zones = [
    { key: "top",   range: "≥ 80", label: "Prime candidate", tone: "emerald" },
    { key: "good",  range: "60 – 79", label: "Solid",         tone: "emerald" },
    { key: "fair",  range: "40 – 59", label: "Fair",          tone: "amber" },
    { key: "weak",  range: "30 – 39", label: "Weak (borderline)", tone: "rose" },
  ];
  let currentZone = null;
  if (score != null) {
    if (score >= 80)      currentZone = "top";
    else if (score >= 60) currentZone = "good";
    else if (score >= 40) currentZone = "fair";
    else                  currentZone = "weak";
  }
  return (
    <ZoneTable
      title="Sell-Safety Score (0–100)"
      description="Composite score combining 9 signals: IV Rank, VRP, |Δ|, fresh writing, gamma-wall position, dealer γ, VIX, OI migration, liquidity. Only rows with score ≥ 30 are shown."
      zones={zones}
      currentZone={currentZone}
      action={score != null ? `This row scored ${score}.` : null}
    />
  );
}

// ---------------------------------------------------------------------------
// Verdict pill
// ---------------------------------------------------------------------------
export function verdictGuide(tradeable, dangerousQuadrant) {
  const zones = [
    { key: "trap",     range: "Dangerous quadrant", label: "IV Rank low + VRP ≤ 0", tone: "rose" },
    { key: "no",       range: "Not tradeable",       label: "Any hard-block trigger", tone: "rose" },
    { key: "yes",      range: "Tradeable",           label: "No hard blocks",         tone: "emerald" },
  ];
  let currentZone = dangerousQuadrant ? "trap" : tradeable ? "yes" : "no";
  const action = dangerousQuadrant
    ? "Retail trap detected — cheap-looking IV masks rising realised vol. Skip."
    : tradeable
      ? "All hard-block conditions cleared. See advisories for size / DTE guidance."
      : "One or more hard blocks triggered. See the red reasons card below.";
  return (
    <ZoneTable
      title="Verdict"
      description="Overall market posture for premium selling. Hard blocks: dealer γ strongly negative, IV Rank <15, VIX spiking >5%, or VRP <-0.5."
      zones={zones}
      currentZone={currentZone}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// Market-Intel row (OI Change tab)
// ---------------------------------------------------------------------------
export function biasGuide(score) {
  const zones = [
    { key: "sb",  range: "≥ +60",       label: "Strong Bullish", tone: "emerald" },
    { key: "b",   range: "+20 to +60",  label: "Bullish",        tone: "emerald" },
    { key: "n",   range: "-20 to +20",  label: "Neutral",        tone: "amber" },
    { key: "br",  range: "-60 to -20",  label: "Bearish",        tone: "rose" },
    { key: "sbr", range: "≤ -60",       label: "Strong Bearish", tone: "rose" },
  ];
  let currentZone = null;
  if (score != null) {
    if (score >= 60)       currentZone = "sb";
    else if (score >= 20)  currentZone = "b";
    else if (score >= -20) currentZone = "n";
    else if (score >= -60) currentZone = "br";
    else                   currentZone = "sbr";
  }
  return (
    <ZoneTable
      title="Directional Bias"
      description="Blends OI-change intensity, PCR level, and strike buildup around ATM into a single directional score (-100 to +100)."
      zones={zones}
      currentZone={currentZone}
      action={null}
    />
  );
}

export function pcrGuide(pcr) {
  const zones = [
    { key: "hi",  range: "≥ 1.30", label: "Very bullish (crowded puts)",  tone: "emerald" },
    { key: "b",   range: "1.05 – 1.30", label: "Bullish tilt",            tone: "emerald" },
    { key: "n",   range: "0.95 – 1.05", label: "Neutral",                 tone: "amber" },
    { key: "br",  range: "0.80 – 0.95", label: "Bearish tilt",            tone: "rose" },
    { key: "lo",  range: "< 0.80", label: "Very bearish (crowded calls)", tone: "rose" },
  ];
  let currentZone = null;
  if (pcr != null) {
    if (pcr >= 1.3)       currentZone = "hi";
    else if (pcr >= 1.05) currentZone = "b";
    else if (pcr >= 0.95) currentZone = "n";
    else if (pcr >= 0.80) currentZone = "br";
    else                  currentZone = "lo";
  }
  return (
    <ZoneTable
      title="Put/Call OI Ratio (PCR)"
      description="Total put OI ÷ total call OI across the strike chain. Higher = more puts written (or bought) = bullish tilt. Below 1.0 = call-heavy."
      zones={zones}
      currentZone={currentZone}
      action={null}
    />
  );
}

export function maxPainGuide(spot, maxPain) {
  const zones = [
    { key: "above", range: "Spot > Max Pain",  label: "Bearish pressure toward Max Pain", tone: "rose" },
    { key: "at",    range: "Spot ≈ Max Pain",  label: "Balanced (pinning risk)",           tone: "amber" },
    { key: "below", range: "Spot < Max Pain",  label: "Bullish pressure toward Max Pain",  tone: "emerald" },
  ];
  let currentZone = null;
  if (spot != null && maxPain != null && maxPain > 0) {
    const pct = ((spot - maxPain) / maxPain) * 100;
    if (Math.abs(pct) < 0.3) currentZone = "at";
    else if (pct > 0)        currentZone = "above";
    else                     currentZone = "below";
  }
  return (
    <ZoneTable
      title="Max Pain"
      description="Strike at which total option-writer P&L is maximised (i.e. the value that hurts the most option buyers). Market often gravitates here into expiry."
      zones={zones}
      currentZone={currentZone}
      action={null}
    />
  );
}

export function supportGuide() {
  return (
    <ZoneTable
      title="Support"
      description="Strike with the highest Put OI. Put writers are defending this level — a price floor until that OI unwinds."
      zones={[
        { key: "s", range: "Highest Put OI", label: "Writers defending — floor", tone: "emerald" },
      ]}
      currentZone="s"
      action={"If spot breaks below support with rising Put OI, watch for cascade lower."}
    />
  );
}

export function resistanceGuide() {
  return (
    <ZoneTable
      title="Resistance"
      description="Strike with the highest Call OI. Call writers are defending this level — a price ceiling until that OI unwinds."
      zones={[
        { key: "r", range: "Highest Call OI", label: "Writers defending — ceiling", tone: "rose" },
      ]}
      currentZone="r"
      action={"If spot breaks above resistance with rising Call OI, watch for squeeze higher."}
    />
  );
}
