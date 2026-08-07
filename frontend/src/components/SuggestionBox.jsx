// -----------------------------------------------------------------------------
// SuggestionBox — plain-English posture card from live OI signals only.
// Uses PCR, max-pain vs spot, OI change (CE vs PE), support/resistance walls,
// and India VIX. No VRP (unreliable / often stale in this app).
// -----------------------------------------------------------------------------

import React, { useMemo } from "react";
import { Sparkles, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

function toneClass(tone) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50/90 border-emerald-200/80 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-900";
    case "rose":
      return "bg-rose-50/90 border-rose-200/80 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-900";
    case "amber":
      return "bg-amber-50/90 border-amber-200/80 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900";
    default:
      return "bg-slate-50/90 border-slate-200 text-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700";
  }
}

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN");
}

function fmtOi(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const abs = Math.abs(n);
  const sign = n >= 0 ? "+" : "−";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  return `${sign}${Math.round(abs).toLocaleString("en-IN")}`;
}

export default function SuggestionBox({
  indexName,
  marketIntel,
  changeSummary,
  spot,
  vixNow,
  vixOpen,
}) {
  const suggestion = useMemo(() => {
    const bullets = [];
    let headline = "Waiting for live OI…";
    let tone = "slate";
    let Icon = Sparkles;

    if (!marketIntel) {
      return {
        headline,
        bullets: ["Suggestion updates when the active index has a fresh OI snapshot."],
        tone,
        Icon,
      };
    }

    const score = marketIntel.score ?? 0;
    const pcr = marketIntel.pcr;
    const support = marketIntel.support;
    const resistance = marketIntel.resistance;
    const maxPain = marketIntel.maxPain;
    const peDelta = changeSummary?.pe ?? 0;
    const ceDelta = changeSummary?.ce ?? 0;
    const netWriters = peDelta - ceDelta; // +ve = put writing dominant this window

    // ---- Headline from blended OI score ----
    if (score >= 60) {
      headline = `Strong bullish — put writers defending`;
      tone = "emerald";
      Icon = TrendingUp;
    } else if (score >= 25) {
      headline = `Mildly bullish — watch continuation`;
      tone = "emerald";
      Icon = TrendingUp;
    } else if (score <= -60) {
      headline = `Strong bearish — call writers capping`;
      tone = "rose";
      Icon = TrendingDown;
    } else if (score <= -25) {
      headline = `Mildly bearish — call writing active`;
      tone = "rose";
      Icon = TrendingDown;
    } else {
      headline = `Range-bound — walls on both sides`;
      tone = "amber";
      Icon = Minus;
    }

    // ---- Concrete OI facts (always prefer measurable signals) ----
    // ATM band first — what traders glance at on the selected timeframe.
    const atmCe = marketIntel.atmCeDelta;
    const atmPe = marketIntel.atmPeDelta;
    if (atmCe != null || atmPe != null) {
      const aCe = atmCe ?? 0;
      const aPe = atmPe ?? 0;
      const atmLead = aPe - aCe;
      bullets.push(
        `ATM band ΔOI: PE ${fmtOi(aPe)} · CE ${fmtOi(aCe)} ` +
          `(${atmLead >= 0 ? "puts leading near ATM" : "calls leading near ATM"}).`
      );
    }

    if (changeSummary) {
      bullets.push(
        `Full window: Put ΔOI ${fmtOi(peDelta)} · Call ΔOI ${fmtOi(ceDelta)} ` +
          `(${netWriters >= 0 ? "puts leading" : "calls leading"}).`
      );
    }

    if (pcr != null) {
      const pcrRead =
        pcr >= 1.05 ? "put-heavy (supportive)" :
        pcr <= 0.95 ? "call-heavy (pressure)" :
        "balanced";
      bullets.push(`PCR ${pcr.toFixed(2)} — ${pcrRead}.`);
    }

    if (support != null || resistance != null) {
      bullets.push(
        `OI walls: support ${fmt(support)} · resistance ${fmt(resistance)}.`
      );
    }

    if (spot != null && maxPain != null && maxPain > 0) {
      const pct = ((spot - maxPain) / maxPain) * 100;
      const side = pct >= 0 ? "above" : "below";
      bullets.push(`Spot is ${Math.abs(pct).toFixed(2)}% ${side} max pain ${fmt(maxPain)}.`);
    }

    // ---- Actionable posture (no VRP / no vague “edge” talk) ----
    if (score >= 25 && support != null) {
      bullets.push(`Bias: favour dips toward ${fmt(support)}; fade only if put OI starts unwinding.`);
    } else if (score <= -25 && resistance != null) {
      bullets.push(`Bias: favour pops into ${fmt(resistance)}; fade only if call OI starts unwinding.`);
    } else if (support != null && resistance != null) {
      bullets.push(`Bias: fade edges of ${fmt(support)}–${fmt(resistance)} until one wall breaks on rising OI.`);
    }

    // ---- VIX overlay (live, useful) ----
    if (vixNow != null && vixOpen != null && vixOpen > 0) {
      const changePct = ((vixNow - vixOpen) / vixOpen) * 100;
      if (changePct > 5) {
        tone = "rose";
        bullets.push(`India VIX +${changePct.toFixed(1)}% vs session open — cut size; avoid naked shorts.`);
      } else if (changePct < -5) {
        bullets.push(`India VIX ${changePct.toFixed(1)}% vs session open — vol crushing; existing shorts get a tailwind.`);
      }
    }

    // Keep card scannable — ATM + 3–4 supporting lines
    return { headline, bullets: bullets.slice(0, 5), tone, Icon };
  }, [marketIntel, changeSummary, spot, vixNow, vixOpen]);

  const Icon = suggestion.Icon;

  return (
    <div
      className={`rounded-lg border px-3.5 py-3 text-xs space-y-1.5 shadow-sm ${toneClass(suggestion.tone)}`}
      data-testid="suggestion-box"
    >
      <div className="flex items-center gap-1.5 font-semibold text-sm tracking-tight">
        <Icon className="w-4 h-4 shrink-0" />
        <span>Suggestion — {indexName}</span>
      </div>
      <div className="text-[13px] font-semibold leading-snug">{suggestion.headline}</div>
      {suggestion.bullets.length > 0 && (
        <ul className="space-y-1 opacity-95">
          {suggestion.bullets.map((b, i) => (
            <li key={i} className="leading-snug flex gap-2">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-current opacity-50 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[10px] opacity-60 pt-1 flex items-center gap-1 border-t border-current/10 mt-1">
        <AlertTriangle className="w-3 h-3" />
        Educational — not trading advice. Confirm with your own risk plan.
      </div>
    </div>
  );
}
