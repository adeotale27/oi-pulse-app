import { useMemo } from "react";
import { classifyVelocity } from "@/lib/oiSettings";
import { strikeAnalytics, yearsToExpiry, classifyIvRank } from "@/lib/blackScholes";
import InfoTip from "@/components/InfoTip";

function formatOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

export default function StrikeTable({ current, previous, atm, timeframeMin, oiSettings, lotSize, expiry, vixNow, showSignals = false }) {
  const rows = useMemo(() => {
    if (!current) return [];
    const prevMap = new Map();
    (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));

    // Compute average volumes across the visible strikes so we can flag
    // "volume > average" for the institutional detector.
    let vSum = 0, vCount = 0;
    current.strikes.forEach((s) => {
      vSum += (s.ce_volume || 0) + (s.pe_volume || 0);
      vCount += 2;
    });
    const avgVolume = vCount > 0 ? vSum / vCount : 0;

    const T = yearsToExpiry(expiry);
    const S = current.price || current.atm;

    return current.strikes.map((s) => {
      const p = prevMap.get(s.strike) || {};
      const ce_delta = s.ce_oi - (p.ce_oi ?? s.ce_oi);
      const pe_delta = s.pe_oi - (p.pe_oi ?? s.pe_oi);
      const minutes = Math.max(1, Number(timeframeMin) || 15);
      const ce_vel = ce_delta / minutes;
      const pe_vel = pe_delta / minutes;

      // Gamma-wall detection: use the shorter of (settings.gammaWallMinutes,
      // active timeframe) — we assume the caller is polling the change endpoint
      // for the active timeframe, so we scale the threshold accordingly.
      const gwWindow = oiSettings?.gammaWallMinutes || 3;
      const gwThresh = oiSettings?.gammaWallAbs || 200_000;
      // Scale: if active timeframe > gw window, we still flag if change already
      // exceeds threshold; if timeframe < gw window, we require proportional.
      const gwScale = minutes >= gwWindow ? 1 : minutes / gwWindow;
      const gwEffective = gwThresh * gwScale;
      const ce_gamma_wall = ce_delta >= gwEffective;
      const pe_gamma_wall = pe_delta >= gwEffective;

      // Institutional detector.
      const oiMin = oiSettings?.instOiMin || 50_000;
      const premCr = oiSettings?.instPremiumCr || 10;
      const lot = lotSize || 1;
      const ce_prem = (s.ce_ltp || 0) * (s.ce_oi || 0) * lot;
      const pe_prem = (s.pe_ltp || 0) * (s.pe_oi || 0) * lot;
      const ce_inst =
        (s.ce_oi || 0) > oiMin &&
        (s.ce_volume || 0) > avgVolume &&
        ce_prem >= premCr * 1e7;
      const pe_inst =
        (s.pe_oi || 0) > oiMin &&
        (s.pe_volume || 0) > avgVolume &&
        pe_prem >= premCr * 1e7;

      // Black-Scholes analytics
      const a = strikeAnalytics({
        S, K: s.strike, T, r: 0.065,
        ceLtp: s.ce_ltp, peLtp: s.pe_ltp, vixNow,
      });

      return {
        strike: s.strike,
        ce_oi: s.ce_oi,
        ce_ltp: s.ce_ltp,
        pe_ltp: s.pe_ltp,
        pe_oi: s.pe_oi,
        ce_volume: s.ce_volume,
        pe_volume: s.pe_volume,
        ce_delta,
        pe_delta,
        ce_vel,
        pe_vel,
        ce_pct: p.ce_oi ? (ce_delta / p.ce_oi) * 100 : 0,
        pe_pct: p.pe_oi ? (pe_delta / p.pe_oi) * 100 : 0,
        ce_gamma_wall,
        pe_gamma_wall,
        ce_inst,
        pe_inst,
        ce_iv: a.ce_iv,
        pe_iv: a.pe_iv,
        ce_delta_g: a.ce_delta,
        pe_delta_g: a.pe_delta,
        ce_theta: a.ce_theta,
        pe_theta: a.pe_theta,
        ivRank: a.ivRank,
      };
    });
  }, [current, previous, timeframeMin, oiSettings, lotSize, expiry, vixNow]);

  if (!current) return null;

  // ATM row's IV rank is the summary shown at the top of the table.
  const atmRow = rows.find((r) => r.strike === atm) || rows[Math.floor(rows.length / 2)];
  const rankInfo = atmRow ? classifyIvRank(atmRow.ivRank) : { label: "—", tone: "slate" };

  return (
    <div className="space-y-2" data-testid="strike-table-wrap">
      {atmRow && atmRow.ivRank != null && (
        <div
          className={`rounded-md border px-3 py-2 flex items-center gap-4 text-xs ${
            rankInfo.tone === "rose"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : rankInfo.tone === "emerald"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-slate-50 border-slate-200 text-slate-700"
          }`}
          data-testid="iv-rank-summary"
        >
          <div>
            <span className="uppercase tracking-widest text-[9px] opacity-70 flex items-center gap-1">
              ATM IV Rank
              <InfoTip title="ATM IV Rank" testId="tip-iv-rank">
                Where today&apos;s ATM option implied volatility (IV) sits inside the typical range of India VIX (7–35 %). 0 = extremely cheap (buy options), 100 = extremely rich (sell options). Rule of thumb: rank &gt; 70 favours option sellers, rank &lt; 30 favours option buyers, in between = neutral.
              </InfoTip>
            </span>
            <div className="text-lg font-semibold font-mono-data">{atmRow.ivRank}<span className="text-xs opacity-70">/100</span></div>
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">{rankInfo.label}</div>
            <div className="text-[10px] opacity-70">
              ATM CE IV {atmRow.ce_iv?.toFixed?.(1) ?? "—"}% · ATM PE IV {atmRow.pe_iv?.toFixed?.(1) ?? "—"}% · India VIX {vixNow?.toFixed?.(2) ?? "—"}
            </div>
          </div>
        </div>
      )}
    <div className="overflow-auto" data-testid="strike-table">
      <table className="w-full text-xs font-mono-data border-separate border-spacing-0">
        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-300 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-left px-2 py-2 sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700">
              <span className="inline-flex items-center gap-1">
                Call Signals
                <InfoTip title="Call-side Signal Badges">
                  These badges auto-detect exceptional activity on CE:
                  <ul className="list-disc pl-4 mt-1">
                    <li>🔥/🟢/⚪ velocity — rate of OI build per minute (Fast/Medium/Slow).</li>
                    <li>🚧 Gamma Wall — massive single-strike OI spike; a defended level.</li>
                    <li>🏦 Institution — high OI + high volume + big premium =&gt; real institutional footprint.</li>
                  </ul>
                </InfoTip>
              </span>
            </th>
            <th className="text-right px-2 py-2">Call Δ</th>
            <th className="text-right px-2 py-2">Call Θ</th>
            <th className="text-right px-2 py-2">Call IV</th>
            <th className="text-right px-3 py-2">Call Δ%</th>
            <th className="text-right px-3 py-2">Call OI</th>
            <th className="text-right px-3 py-2">Call LTP</th>
            <th className="text-center px-3 py-2 bg-slate-100 dark:bg-slate-700 sticky left-[110px] md:left-[130px] z-20 border-l border-r border-slate-200 dark:border-slate-700 hidden md:table-cell" style={{ position: "sticky" }}>Strike</th>
            <th className="text-center px-3 py-2 bg-slate-100 dark:bg-slate-700 md:hidden">Strike</th>
            <th className="text-right px-3 py-2">Put LTP</th>
            <th className="text-right px-3 py-2">Put OI</th>
            <th className="text-right px-3 py-2">Put Δ%</th>
            <th className="text-right px-2 py-2">Put IV</th>
            <th className="text-right px-2 py-2">Put Θ</th>
            <th className="text-right px-2 py-2">Put Δ</th>
            <th className="text-left px-2 py-2 sticky right-0 z-20 bg-slate-50 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700">
              <span className="inline-flex items-center gap-1">
                Put Signals
                <InfoTip title="Put-side Signal Badges">
                  Same signal detectors applied to PE side. Watch for 🏦 on PE far below spot (protective hedges) and 🚧 near ATM (support forming).
                </InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isAtm = r.strike === atm;
            const ceV = classifyVelocity(r.ce_vel, oiSettings);
            const peV = classifyVelocity(r.pe_vel, oiSettings);
            return (
              <tr
                key={r.strike}
                className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${isAtm ? "bg-amber-50 dark:bg-amber-900/20" : "bg-white dark:bg-slate-900"}`}
              >
                <td className={`px-2 py-1.5 text-left sticky left-0 z-10 border-r border-slate-200 dark:border-slate-700 ${isAtm ? "bg-amber-50 dark:bg-amber-900/20" : "bg-white dark:bg-slate-900"}`}>
                  {showSignals ? (
                    <SignalBadges
                      velocity={ceV}
                      velocityValue={r.ce_vel}
                      gammaWall={r.ce_gamma_wall}
                      institution={r.ce_inst}
                      side="CE"
                    />
                  ) : null}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.ce_delta_g != null ? r.ce_delta_g.toFixed(2) : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.ce_theta != null ? r.ce_theta.toFixed(2) : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.ce_iv != null ? r.ce_iv.toFixed(1) + "%" : "—"}
                </td>
                <td className={`text-right px-3 py-1.5 ${r.ce_pct >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {r.ce_pct >= 0 ? "+" : ""}{r.ce_pct.toFixed(2)}%
                </td>
                <td className="text-right px-3 py-1.5 text-slate-800 dark:text-slate-200">{formatOI(r.ce_oi)}</td>
                <td className="text-right px-3 py-1.5 text-slate-600 dark:text-slate-300">{r.ce_ltp?.toFixed?.(2)}</td>
                <td className={`text-center px-3 py-1.5 font-semibold ${isAtm ? "text-amber-700 bg-amber-100 dark:bg-amber-900/40" : "text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800"} sticky z-10 border-l border-r border-slate-200 dark:border-slate-700`} style={{ left: "clamp(110px, 15vw, 200px)", position: "sticky" }}>
                  {r.strike}
                </td>
                <td className="text-right px-3 py-1.5 text-slate-600 dark:text-slate-300">{r.pe_ltp?.toFixed?.(2)}</td>
                <td className="text-right px-3 py-1.5 text-slate-800 dark:text-slate-200">{formatOI(r.pe_oi)}</td>
                <td className={`text-right px-3 py-1.5 ${r.pe_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.pe_pct >= 0 ? "+" : ""}{r.pe_pct.toFixed(2)}%
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.pe_iv != null ? r.pe_iv.toFixed(1) + "%" : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.pe_theta != null ? r.pe_theta.toFixed(2) : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700 dark:text-slate-300">
                  {r.pe_delta_g != null ? r.pe_delta_g.toFixed(2) : "—"}
                </td>
                <td className={`px-2 py-1.5 text-left sticky right-0 z-10 border-l border-slate-200 dark:border-slate-700 ${isAtm ? "bg-amber-50 dark:bg-amber-900/20" : "bg-white dark:bg-slate-900"}`}>
                  {showSignals ? (
                    <SignalBadges
                      velocity={peV}
                      velocityValue={r.pe_vel}
                      gammaWall={r.pe_gamma_wall}
                      institution={r.pe_inst}
                      side="PE"
                    />
                  ) : null}
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

function SignalBadges({ velocity, velocityValue, gammaWall, institution, side }) {
  const vBg =
    velocity.level === "fast"
      ? "bg-rose-100 text-rose-700 border-rose-200"
      : velocity.level === "medium"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-500 border-slate-200";
  const rateAbs = Math.abs(Math.round(velocityValue || 0));
  const rate =
    rateAbs >= 1e5
      ? (rateAbs / 1e5).toFixed(1) + "L"
      : rateAbs >= 1e3
        ? (rateAbs / 1e3).toFixed(1) + "K"
        : String(rateAbs);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span
        title={`${velocity.label} · ${rate}/min`}
        className={`inline-flex items-center gap-0.5 border rounded-sm px-1 py-0.5 text-[10px] leading-none ${vBg}`}
        data-testid={`velocity-${side.toLowerCase()}`}
      >
        <span>{velocity.emoji}</span>
        <span>{rate}/m</span>
      </span>
      {gammaWall && (
        <span
          title="Large OI buildup within gamma-wall window — institutions likely defending this strike"
          className="inline-flex items-center gap-0.5 border rounded-sm px-1 py-0.5 text-[10px] leading-none bg-purple-100 text-purple-800 border-purple-200"
          data-testid={`gamma-wall-${side.toLowerCase()}`}
        >
          🚧 Gamma Wall
        </span>
      )}
      {institution && (
        <span
          title="OI + Volume + Premium exceed institutional-activity thresholds"
          className="inline-flex items-center gap-0.5 border rounded-sm px-1 py-0.5 text-[10px] leading-none bg-sky-100 text-sky-800 border-sky-200"
          data-testid={`institution-${side.toLowerCase()}`}
        >
          🏦 Institution
        </span>
      )}
    </div>
  );
}
