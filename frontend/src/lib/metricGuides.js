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
import { formatGexExposure, GEX_SPOT_BAND_PCT } from "./sellCandidates";

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
export function formatGexSnapshotTime(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date)} IST`;
}

export function getGexDirectionalRead({ score, priceDeltaPct, callOiChange, putOiChange } = {}) {
  const evidence = [score, priceDeltaPct, callOiChange, putOiChange];
  if (!evidence.every(Number.isFinite)) {
    return {
      label: "No clear direction",
      detail: "Waiting for matching price, OI-change and dashboard-bias data.",
      tone: "amber",
    };
  }

  const oiBias = putOiChange - callOiChange;
  if (score >= 25 && priceDeltaPct > 0 && oiBias > 0) {
    return {
      label: "Upward lean",
      detail: "Price is rising, put OI is leading call OI, and the combined dashboard bias agrees. This is a lean, not a forecast.",
      tone: "emerald",
    };
  }
  if (score <= -25 && priceDeltaPct < 0 && oiBias < 0) {
    return {
      label: "Downward lean",
      detail: "Price is falling, call OI is leading put OI, and the combined dashboard bias agrees. This is a lean, not a forecast.",
      tone: "rose",
    };
  }
  if (score > -25 && score < 25) {
    return {
      label: "No clear direction",
      detail: "The combined dashboard bias is neutral. GEX can hint at move speed, not whether price goes up or down.",
      tone: "amber",
    };
  }
  return {
    label: "Signals disagree",
    detail: "Price, OI changes and the combined dashboard bias do not all point the same way. Wait for confirmation.",
    tone: "amber",
  };
}

export function dealerGammaGuide(gexValue, {
  byStrike,
  updatedAt,
  spot,
  expiry,
  directionalScore,
  priceDeltaPct,
  callOiChange,
  putOiChange,
  timeframeLabel,
  snapshotLabel,
  spotBandPct = GEX_SPOT_BAND_PCT,
  includedStrikeCount,
  sourceStrikeCount,
} = {}) {
  const zones = [
    {
      key: "positive",
      threshold: "> +₹0.5 L Cr",
      label: "May calm moves",
      explanation: "Positive estimate; hedging may soften swings.",
      tone: "emerald",
    },
    {
      key: "neutral",
      threshold: "−₹0.5 to +₹0.5 L Cr",
      label: "No clear clue",
      explanation: "No strong lean toward calmer or faster moves.",
      tone: "amber",
    },
    {
      key: "negative",
      threshold: "< −₹0.5 L Cr",
      label: "Moves may speed up",
      explanation: "Negative estimate; swings could extend.",
      tone: "rose",
    },
  ];
  const topStrikes = Array.isArray(byStrike)
    ? byStrike
      .filter((point) => Number.isFinite(point.gexLakhCrorePer1Pct) && Number.isFinite(point.strike) && point.gexLakhCrorePer1Pct !== 0)
      .sort((a, b) => Math.abs(b.gexLakhCrorePer1Pct) - Math.abs(a.gexLakhCrorePer1Pct))
      .slice(0, 3)
    : null;
  const maxStrikeGex = topStrikes?.reduce((max, point) => Math.max(max, Math.abs(point.gexLakhCrorePer1Pct)), 0) || 0;
  const snapshotTime = formatGexSnapshotTime(updatedAt);
  let currentZone = null;
  let reading = "Waiting for option-chain data.";
  let explanation = "Once option-chain data is available, this gives a rough idea of whether option hedging could dampen or amplify moves.";
  if (gexValue != null) {
    if (gexValue > 0.5) {
      currentZone = "positive";
      reading = "Moves may be calmer";
      explanation = "The estimate leans toward hedging softening moves. It does not say whether the index will go up or down.";
    } else if (gexValue < -0.5) {
      currentZone = "negative";
      reading = "Moves could get faster";
      explanation = "The estimate warns that hedging could add to a move. Be extra careful with option selling without protection.";
    } else {
      currentZone = "neutral";
      reading = "No clear GEX clue";
      explanation = "This estimate does not strongly lean toward calmer or faster moves. Let price action guide the decision.";
    }
  }
  const currentZoneInfo = zones.find((zone) => zone.key === currentZone);
  const directionalRead = getGexDirectionalRead({
    score: directionalScore,
    priceDeltaPct,
    callOiChange,
    putOiChange,
  });
  const directionTone = directionalRead.tone === "emerald"
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
    : directionalRead.tone === "rose"
      ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950"
      : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950";
  return (
    <section aria-label="GEX market setup" className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 sm:space-y-2">
      <div
        className={`rounded-md border p-2 ${currentZoneInfo?.tone === "emerald"
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
          : currentZoneInfo?.tone === "rose"
            ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950"
            : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"}`}
        data-testid="gex-simple-reading"
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-semibold text-slate-900 dark:text-slate-100">{reading}</div>
          {gexValue != null && (
            <div className="whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100" data-testid="gex-current-value">
              {formatGexExposure(gexValue)}
            </div>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-[9px] leading-snug sm:text-[10px]">
          {currentZoneInfo && (
            <span className="font-medium" data-testid="gex-current-threshold">
              {currentZoneInfo.threshold.startsWith("> ")
                ? `Your value is above ${currentZoneInfo.threshold.slice(2)}.`
                : currentZoneInfo.threshold.startsWith("< ")
                  ? `Your value is below ${currentZoneInfo.threshold.slice(2)}.`
                  : `Your value is between ${currentZoneInfo.threshold.replace(" to ", " and ")}.`}
            </span>
          )}
          {byStrike && (
            <span className="text-slate-500 dark:text-slate-400" data-testid="gex-updated-at">
              {snapshotLabel || "Snapshot"}: {snapshotTime || "time unavailable"}
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] leading-snug sm:text-[11px]">
          <span className="sm:hidden">Move-speed clue—not direction.</span>
          <span className="hidden sm:inline">{explanation}</span>
        </p>
        <p className="mt-0.5 text-[9px] font-medium sm:hidden">Estimate only · Not a buy/sell signal.</p>
        <p className="mt-1 hidden text-[10px] font-medium sm:block">Use as context only—not a buy/sell instruction.</p>
      </div>
      <div className={`rounded-md border px-2 py-1.5 sm:p-2 ${directionTone}`} data-testid="gex-directional-read">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Direction check: {directionalRead.label}</span>
          {Number.isFinite(directionalScore) && (
            <span className="text-[9px] text-slate-500 dark:text-slate-400">
              dashboard bias {directionalScore > 0 ? "+" : ""}{directionalScore}
            </span>
          )}
        </div>
        <p className="mt-0.5 hidden text-[10px] leading-snug sm:block">{directionalRead.detail}</p>
        <p className="mt-0.5 text-[9px] text-slate-500 dark:text-slate-400">
          <span className="sm:hidden">Price + {timeframeLabel || "selected-window"} OI + desk bias</span>
          <span className="hidden sm:inline">
            Uses price plus {timeframeLabel || "selected-window"} OI change and the combined dashboard bias—not GEX alone.
          </span>
        </p>
      </div>
      <details className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700" data-testid="gex-threshold-details">
        <summary className="cursor-pointer text-[10px] font-medium text-slate-600 dark:text-slate-300">
          Thresholds
        </summary>
        <div className="mt-1.5">
          <div className="grid min-w-0 grid-cols-3 gap-1" role="list" aria-label="GEX thresholds and meanings">
            {zones.map((zone) => {
              const active = zone.key === currentZone;
              const palette = zone.tone === "emerald"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : zone.tone === "rose"
                  ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
              return (
                <div
                  key={zone.key}
                  role="listitem"
                  aria-current={active ? "true" : undefined}
                  data-testid={`gex-zone-${zone.key}`}
                  className={`flex min-w-0 flex-col items-start gap-1 rounded-md border px-1 py-1.5 sm:px-1.5 ${active ? `${palette} ring-1 ring-current font-semibold` : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}
                >
                  <div className="w-full min-w-0">
                    <div className="break-words font-semibold text-[8px] leading-tight sm:text-[9px]">{zone.threshold}</div>
                    <div className="mt-1 text-[10px] font-semibold leading-tight">{zone.label}</div>
                    <div className="mt-0.5 break-words text-[8px] leading-tight sm:text-[9px]">{zone.explanation}</div>
                  </div>
                  {active && <div className="rounded bg-white/70 px-1 py-0.5 text-[8px] uppercase tracking-wide dark:bg-slate-900/70">Current</div>}
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[9px] text-slate-500 dark:text-slate-400">
            ₹0.5 L Cr means ₹50,000 crore. “L Cr” means lakh crore.
          </p>
        </div>
      </details>
      {topStrikes && (
        <details className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700" data-testid="gex-strike-details">
          <summary className="cursor-pointer text-[10px] font-medium text-slate-600 dark:text-slate-300">
            Strike areas to watch{spot ? ` · index ${Number(spot).toLocaleString("en-IN")}` : ""}
          </summary>
          <div className="mt-1.5 space-y-1" data-testid="gex-strike-concentration">
            {expiry && <p className="text-[9px] text-slate-500 dark:text-slate-400">Expiry: {expiry}</p>}
            <p className="text-[9px] text-slate-500 dark:text-slate-400" aria-label="Strike chart legend">
              Estimated call-side (green) / put-side (red) concentration
            </p>
            {topStrikes.length ? (
              <div className="space-y-1.5">
                {topStrikes.map((point) => {
                  const barWidth = (Math.abs(point.gexLakhCrorePer1Pct) / maxStrikeGex) * 50;
                  const positive = point.gexLakhCrorePer1Pct > 0;
                  const distance = Number.isFinite(spot) ? point.strike - spot : null;
                  return (
                    <div key={point.strike} data-testid={`gex-strike-${point.strike}`}>
                      <div className="mb-0.5 flex justify-between gap-2 text-[10px]">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {`Strike ${Number(point.strike).toLocaleString("en-IN")}`}
                          {distance != null && <span className="ml-1 text-[9px] font-normal text-slate-500">{`${distance > 0 ? "+" : ""}${Math.round(distance)} points from index`}</span>}
                        </span>
                        <span className={`whitespace-nowrap ${positive ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                          {formatGexExposure(point.gexLakhCrorePer1Pct)}
                        </span>
                      </div>
                      <div
                        className="relative h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-700"
                        role="img"
                        aria-label={`Strike ${point.strike}: estimated ${positive ? "call-side" : "put-side"} concentration, ${formatGexExposure(point.gexLakhCrorePer1Pct)} per 1% index move`}
                      >
                        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-400 dark:bg-slate-300" />
                        <span
                          className={`absolute inset-y-0 ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
                          style={positive
                            ? { left: "50%", width: `${barWidth}%` }
                            : { left: `${50 - barWidth}%`, width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-500 dark:text-slate-400">No notable strike concentration in the available chain.</p>
            )}
            <p className="text-[9px] leading-snug text-slate-500 dark:text-slate-400">
              These are modelled watch areas only—not support or resistance, and not guaranteed to affect price.
            </p>
          </div>
        </details>
      )}
      <details className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700" data-testid="gex-details">
        <summary className="cursor-pointer text-[10px] font-medium text-slate-600 dark:text-slate-300">
          What is GEX, and what does the amount mean?
        </summary>
        <div className="mt-1.5 space-y-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-300">
          <p>GEX is a rough estimate of how option-market hedging might affect the size of index moves. It does not predict direction.</p>
          <p>₹ amount = estimated hedging value for a 1% index move. It is not money known to be held or traded by dealers.</p>
          <p data-testid="gex-method">The estimate assumes calls add positive gamma and puts negative gamma. NSE does not publish trade sides, so actual dealer positions—and even this assumed sign—cannot be confirmed.</p>
          <p data-testid="gex-coverage">Only valid option quotes within ±{spotBandPct}% of spot are included{Number.isFinite(includedStrikeCount) ? ` (${includedStrikeCount} of ${sourceStrikeCount ?? "—"} chain strikes contributed)` : ""}. This fixed band avoids far-wing quote noise dominating the estimate.</p>
          <p>Green/red bars show the model’s call-side/put-side estimate for each strike. They are not confirmed support or resistance.</p>
          <p>The displayed amount is estimated hedging notional for a 1% index move, not an index-point target.</p>
        </div>
      </details>
    </section>
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
