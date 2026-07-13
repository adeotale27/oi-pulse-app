import { useMemo } from "react";
import { classifyVelocity } from "@/lib/oiSettings";

function formatOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

export default function StrikeTable({ current, previous, atm, timeframeMin, oiSettings, lotSize }) {
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
      };
    });
  }, [current, previous, timeframeMin, oiSettings, lotSize]);

  if (!current) return null;

  return (
    <div className="overflow-auto" data-testid="strike-table">
      <table className="w-full text-xs font-mono-data">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-left px-2 py-2">Call Signals</th>
            <th className="text-right px-3 py-2">Call Δ%</th>
            <th className="text-right px-3 py-2">Call OI</th>
            <th className="text-right px-3 py-2">Call LTP</th>
            <th className="text-center px-3 py-2 bg-slate-100">Strike</th>
            <th className="text-right px-3 py-2">Put LTP</th>
            <th className="text-right px-3 py-2">Put OI</th>
            <th className="text-right px-3 py-2">Put Δ%</th>
            <th className="text-left px-2 py-2">Put Signals</th>
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
                className={`border-b border-slate-100 hover:bg-slate-50 ${isAtm ? "bg-amber-50" : ""}`}
              >
                <td className="px-2 py-1.5 text-left">
                  <SignalBadges
                    velocity={ceV}
                    velocityValue={r.ce_vel}
                    gammaWall={r.ce_gamma_wall}
                    institution={r.ce_inst}
                    side="CE"
                  />
                </td>
                <td className={`text-right px-3 py-1.5 ${r.ce_pct >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {r.ce_pct >= 0 ? "+" : ""}{r.ce_pct.toFixed(2)}%
                </td>
                <td className="text-right px-3 py-1.5 text-slate-800">{formatOI(r.ce_oi)}</td>
                <td className="text-right px-3 py-1.5 text-slate-600">{r.ce_ltp?.toFixed?.(2)}</td>
                <td className={`text-center px-3 py-1.5 font-semibold ${isAtm ? "text-amber-700" : "text-slate-900"}`}>
                  {r.strike}
                </td>
                <td className="text-right px-3 py-1.5 text-slate-600">{r.pe_ltp?.toFixed?.(2)}</td>
                <td className="text-right px-3 py-1.5 text-slate-800">{formatOI(r.pe_oi)}</td>
                <td className={`text-right px-3 py-1.5 ${r.pe_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.pe_pct >= 0 ? "+" : ""}{r.pe_pct.toFixed(2)}%
                </td>
                <td className="px-2 py-1.5 text-left">
                  <SignalBadges
                    velocity={peV}
                    velocityValue={r.pe_vel}
                    gammaWall={r.pe_gamma_wall}
                    institution={r.pe_inst}
                    side="PE"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
