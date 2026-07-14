// -----------------------------------------------------------------------------
// Sell Candidates panel.
//
// Consumes { current, previous, indexName, vixNow, vixOpen, step, timeframe }
// via props and displays:
//   • A header row with 4 pills — IV Rank / Dealer γ / VIX / Verdict.
//   • A small volatility-smile line chart (CE vs PE per strike).
//   • Two ranked columns of strikes ("CE to Sell" | "PE to Sell") when the
//     market verdict is tradeable. Otherwise a full-width "Not a good day to
//     sell" card that lists the reasons.
//
// Everything is recomputed by the parent every minute via useMemo dependencies.
// -----------------------------------------------------------------------------

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Legend,
  CartesianGrid,
} from "recharts";
import { AlertTriangle, TrendingUp, TrendingDown, Info, Zap, ArrowRightLeft, Shield } from "lucide-react";
import InfoTip from "./InfoTip";
import { computeSellCandidates } from "@/lib/sellCandidates";

const toneMap = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  slate: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-200 dark:border-slate-700",
};

function Pill({ label, value, sub, tone = "slate", testId }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs flex flex-col gap-0.5 min-w-[130px] ${toneMap[tone]}`} data-testid={testId}>
      <span className="uppercase tracking-wide text-[10px] opacity-80">{label}</span>
      <span className="font-bold text-sm leading-none">{value}</span>
      {sub && <span className="text-[11px] opacity-80 leading-none mt-0.5">{sub}</span>}
    </div>
  );
}

function ScoreBadge({ score }) {
  let tone = "slate";
  if (score >= 80) tone = "emerald";
  else if (score >= 60) tone = "amber";
  else tone = "slate";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono-data font-bold ${toneMap[tone]}`}>
      {score}
    </span>
  );
}

function CandidateRow({ c, indexName }) {
  const isCall = c.side === "CE";
  const rationale = c.rationale?.join(" · ") || "";
  return (
    <div className="border rounded-md px-3 py-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 flex flex-col gap-1" data-testid={`sell-cand-${c.side}-${c.strike}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-data">{c.strike}</span>
          <span className={`text-xs uppercase tracking-wide font-semibold ${isCall ? "text-rose-600" : "text-emerald-600"}`}>{c.side}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">₹{(c.ltp || 0).toFixed(2)}</span>
        </div>
        <ScoreBadge score={c.score} />
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono-data text-slate-600 dark:text-slate-300 flex-wrap">
        <span>IV <b>{c.iv?.toFixed(1)}%</b></span>
        <span>Rank <b>{c.ivRank ?? "—"}</b></span>
        <span>Δ <b>{(c.delta ?? 0).toFixed(2)}</b></span>
        <span>Γ <b>{((c.gamma ?? 0) * 1e4).toFixed(2)}e-4</b></span>
        <span>OI <b>{((c.oi || 0) / 1e5).toFixed(2)}L</b></span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
        {c.fresh && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <Zap className="w-3 h-3" /> Fresh writing
          </span>
        )}
        {c.migration && (
          <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
            <ArrowRightLeft className="w-3 h-3" /> OI migrating in
          </span>
        )}
      </div>
      {rationale && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">{rationale}</div>
      )}
    </div>
  );
}

function VolatilitySmileChart({ smile, atm }) {
  if (!smile?.points?.length) return null;
  const data = smile.points.map((p) => ({ strike: p.strike, CE: p.ce_iv, PE: p.pe_iv }));
  return (
    <div className="w-full h-40 bg-white dark:bg-slate-900 border rounded-md border-slate-200 dark:border-slate-700 p-2" data-testid="volatility-smile">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
        Volatility Smile
        <InfoTip title="Volatility Smile" testId="tip-vol-smile">
          Each dot is that strike&apos;s implied volatility. If an OTM strike&apos;s IV is well above the average, its premium is over-priced — a preferred zone to sell.
        </InfoTip>
      </div>
      <ResponsiveContainer width="100%" height="88%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="strike" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} unit="%" width={35} />
          <Tooltip formatter={(v) => (v != null ? `${Number(v).toFixed(1)}%` : "—")} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {atm && <ReferenceLine x={atm} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: "ATM", fontSize: 9, fill: "#64748b" }} />}
          <Line type="monotone" dataKey="CE" stroke="#dc2626" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="PE" stroke="#16a34a" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function VrpSparkline({ vrp }) {
  if (!vrp?.series?.length) return null;
  const data = vrp.series.map((p) => ({ date: p.date?.slice(5) || "", VRP: p.vrp_10, HV: p.hv_10 }));
  const latest = data[data.length - 1];
  return (
    <div className="w-full h-40 bg-white dark:bg-slate-900 border rounded-md border-slate-200 dark:border-slate-700 p-2" data-testid="vrp-sparkline">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          Volatility Risk Premium — last {data.length} sessions
          <InfoTip title="Volatility Risk Premium (VRP)" testId="tip-vrp">
            VRP = Implied Vol − Realised Vol. When positive, sellers get paid MORE than the market&apos;s actual movement warrants — a real edge. When VRP compresses toward zero or turns negative, stop selling.
          </InfoTip>
        </span>
        {latest && (
          <span className="font-mono-data text-slate-700 dark:text-slate-200">
            Today HV<sub>10</sub> <b>{(latest.HV ?? 0).toFixed(1)}%</b> · VRP <b>{(latest.VRP ?? 0).toFixed(2)}</b>
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height="82%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={35} />
          <Tooltip formatter={(v) => (v != null ? Number(v).toFixed(2) : "—")} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="VRP" stroke="#0ea5e9" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="HV" stroke="#f97316" dot={false} strokeWidth={1} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SellCandidatesPanel({
  current,
  previous,
  indexName,
  vixNow,
  vixOpen,
  step,
  vrp,
  lastComputedAt,
}) {
  const result = useMemo(() => computeSellCandidates({
    current,
    previous,
    vixNow,
    vixOpen,
    indexName,
    step,
    vrp,
  }), [current, previous, vixNow, vixOpen, indexName, step, vrp, lastComputedAt]);

  const { verdict, candidates, smile, dealer, ivRank, vix, walls, expiryStale } = result;
  const atm = current?.atm;

  const ivRankTone = ivRank == null ? "slate" : ivRank >= 70 ? "emerald" : ivRank <= 30 ? "rose" : "amber";
  const ivRankSub = ivRank == null ? "—" : ivRank >= 70 ? "Rich · sell zone" : ivRank <= 30 ? "Cheap · avoid selling" : "Fair";

  const vixTone = vix?.spiking ? "rose" : "slate";
  const vixSub = vix?.changePct != null ? `${vix.changePct >= 0 ? "+" : ""}${vix.changePct.toFixed(2)}% intraday` : "";

  const verdictTone = expiryStale ? "slate" : verdict.tradeable ? "emerald" : "rose";
  const verdictLabel = expiryStale ? "Expiry expired" : verdict.tradeable ? "Good day to sell OTM" : "Not a good day to sell";

  return (
    <div className="space-y-4" data-testid="sell-candidates-panel">
      {/* Header pills */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Pill
          label="IV Rank"
          value={ivRank != null ? ivRank : "—"}
          sub={ivRankSub}
          tone={ivRankTone}
          testId="scpill-iv-rank"
        />
        <Pill
          label="VRP (IV − HV)"
          value={vrp && vrp.vrp != null ? `${vrp.vrp >= 0 ? "+" : ""}${vrp.vrp.toFixed(2)}` : "—"}
          sub={vrp?.label || (vrp?.error === "not_in_kite_mode" ? "Needs Kite login" : "—")}
          tone={vrp?.tone || "slate"}
          testId="scpill-vrp"
        />
        <Pill
          label="Dealer γ (GEX)"
          value={dealer.gexT != null ? `${dealer.gexT >= 0 ? "+" : ""}${dealer.gexT.toFixed(1)}T` : "—"}
          sub={dealer.label}
          tone={dealer.tone}
          testId="scpill-dealer-gamma"
        />
        <Pill
          label="India VIX"
          value={vixNow ? vixNow.toFixed(2) : "—"}
          sub={vixSub}
          tone={vixTone}
          testId="scpill-vix"
        />
        <Pill
          label="Verdict"
          value={verdictLabel}
          sub={lastComputedAt ? `Updated ${new Date(lastComputedAt).toLocaleTimeString()}` : ""}
          tone={verdictTone}
          testId="scpill-verdict"
        />
      </div>

      {/* Volatility smile + VRP sparkline */}
      {!expiryStale && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <VolatilitySmileChart smile={smile} atm={atm} />
          <VrpSparkline vrp={vrp} />
        </div>
      )}

      {/* Gamma walls reference */}
      {!expiryStale && walls?.ceWall != null && walls?.peWall != null && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Shield className="w-3 h-3 text-rose-500" />
            CE gamma wall: <b className="font-mono-data text-slate-700 dark:text-slate-200">{walls.ceWall}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <Shield className="w-3 h-3 text-emerald-500" />
            PE gamma wall: <b className="font-mono-data text-slate-700 dark:text-slate-200">{walls.peWall}</b>
          </span>
        </div>
      )}

      {/* Body: either the two ranked lists or the "bad day to sell" card */}
      {expiryStale ? (
        <div className="rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-900 text-sky-800 dark:text-sky-200 p-4 flex gap-3" data-testid="sell-cand-stale-expiry-card">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <div className="font-semibold text-sm">Pick a live weekly expiry</div>
            <div className="text-xs">
              The currently selected expiry has already passed. Choose the next weekly expiry from the sidebar (under &quot;Expiries Included&quot;) to see fresh Sell Candidates with accurate IV, delta and gamma values.
            </div>
          </div>
        </div>
      ) : !verdict.tradeable ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900 text-rose-800 dark:text-rose-200 p-4 flex gap-3" data-testid="sell-cand-bad-day">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <div className="font-semibold text-sm">Not a good day to sell premium</div>
            <ul className="text-xs space-y-1 list-disc list-inside opacity-90">
              {verdict.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div className="text-xs opacity-80">
              Recomputes every minute. Consider waiting for IV to normalise or dealer gamma to flip positive before writing OTM options.
            </div>
          </div>
        </div>
      ) : (
        <>
          {verdict.advisories && verdict.advisories.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs" data-testid="sell-cand-advisories">
              <div className="font-semibold mb-1">Advisories</div>
              <ul className="list-disc list-inside space-y-0.5">
                {verdict.advisories.map((a, i) => (<li key={i}>{a}</li>))}
              </ul>
            </div>
          )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2" data-testid="sell-cand-ce-col">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-rose-700 dark:text-rose-300 flex items-center gap-1">
                <TrendingDown className="w-4 h-4" /> Calls to Sell
                <InfoTip title="Calls to Sell" testId="tip-ce-sell">
                  Strikes with rich IV, low delta, favourable gamma-wall placement and (ideally) fresh call writing. Score 40+ shown; higher score = safer.
                </InfoTip>
              </div>
              <span className="text-[11px] text-slate-500">{candidates.ce.length} candidates</span>
            </div>
            {candidates.ce.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 italic border border-dashed rounded p-3">
                No CE strikes cleared the score threshold. Try again after next update or check strike-range filter.
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.ce.map((c) => (
                  <CandidateRow key={`ce-${c.strike}`} c={c} indexName={indexName} />
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2" data-testid="sell-cand-pe-col">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" /> Puts to Sell
                <InfoTip title="Puts to Sell" testId="tip-pe-sell">
                  Same scoring rules as calls but on the PE side. Look for strikes below the PE gamma wall with fresh put writing.
                </InfoTip>
              </div>
              <span className="text-[11px] text-slate-500">{candidates.pe.length} candidates</span>
            </div>
            {candidates.pe.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 italic border border-dashed rounded p-3">
                No PE strikes cleared the score threshold. Try again after next update or check strike-range filter.
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.pe.map((c) => (
                  <CandidateRow key={`pe-${c.strike}`} c={c} indexName={indexName} />
                ))}
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* Legend / signal explanations */}
      <div className="text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-2 flex items-center gap-3 flex-wrap">
        <Info className="w-3 h-3" />
        Score combines: IV Rank · VRP (IV − HV) · |Δ| · fresh writing · gamma-wall position · dealer γ regime · VIX intraday · OI migration · liquidity.
      </div>
    </div>
  );
}
