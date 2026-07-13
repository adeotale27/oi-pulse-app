import { useEffect, useState, useMemo, useCallback } from "react";
import { RefreshCw, PlugZap, AlertTriangle, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { yearsToExpiry, greeks, impliedVol } from "@/lib/blackScholes";
import OvernightRiskScore from "@/components/OvernightRiskScore";

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Given a Kite expiry code from tradingsymbol, resolve an approximate expiry
// date string (YYYY-MM-DD). Handles monthly ("25JUL") and weekly ("25726") codes.
function resolveExpiryFromCode(yy, mm, activeExpiries = []) {
  // If mm is 3-letter month like 'JUL', this is a monthly expiry.
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const yyyy = 2000 + parseInt(yy, 10);
  if (mm.length === 3 && MON[mm]) {
    // Monthly → last Thursday of the month
    const m = MON[mm];
    // Find last Thursday of month.
    const last = new Date(Date.UTC(yyyy, m, 0)); // last day of month
    const lastDay = last.getUTCDay(); // 0=Sun..4=Thu
    const offset = (lastDay - 4 + 7) % 7;
    const lastThu = new Date(Date.UTC(yyyy, m - 1, last.getUTCDate() - offset));
    return lastThu.toISOString().slice(0, 10);
  }
  // Weekly numeric: mm = single digit month like '7', dd next 2 chars... but we
  // don't parse day robustly. Fallback: pick the nearest activeExpiry.
  if (activeExpiries.length) return activeExpiries[0];
  return null;
}

export default function PositionsPanel({ isKiteMode, current, vix, oiSettings, activeIndex, expiry, onAdjustmentAlert }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [adjustThreshPct, setAdjustThreshPct] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/positions");
      setPositions(data.positions || []);
      if (data.error) setError(data.error);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isKiteMode) return;
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [isKiteMode, load]);

  const spot = current?.price;

  // Enrich each position with derived data
  const rows = useMemo(() => {
    if (!positions.length || !current) return [];
    const S = current.price;
    const activeExp = expiry || current?.expiry;
    return positions.map((p) => {
      const isOpt = !!p.strike && !!p.side;
      let dte = null, T = 0, delta = null, theta = null, iv = null;
      let distancePct = null;
      if (isOpt) {
        const expIso = resolveExpiryFromCode(p.expiry_yy, p.expiry_code, activeExp ? [activeExp] : []);
        if (expIso) {
          T = yearsToExpiry(expIso);
          dte = T * 365;
          const isCall = p.side === "CE";
          const ivGuess = impliedVol(p.last_price || p.average_price, S, p.strike, T, 0.065, isCall);
          if (ivGuess) {
            iv = ivGuess * 100;
            const g = greeks(S, p.strike, T, 0.065, ivGuess, isCall);
            delta = g.delta;
            theta = g.theta;
          }
        }
        distancePct = ((p.strike - S) / S) * 100;
      }
      // Adjustment breach detection: for SHORT positions (sold options),
      // check if spot has approached the short strike by more than threshold%.
      // For a naked short call at K, spot > K * (1 - (1-threshold)*someBand) triggers.
      // Simpler: if position is short (qty < 0) and (side matches direction),
      // then "distance closed" = |atm - K| shrinking.
      const isShort = p.quantity < 0;
      let breachedAdjust = false;
      let breachInfo = null;
      if (isOpt && isShort) {
        // Distance from spot to short strike as % of a nominal 3% band (typical width).
        const bandPct = 3;
        const distPct = Math.abs((p.strike - S) / S) * 100;
        const covered = 1 - (distPct / bandPct);
        if (covered >= adjustThreshPct / 100) {
          breachedAdjust = true;
          breachInfo = {
            distancePct: distPct.toFixed(2),
            coveredPct: (covered * 100).toFixed(0),
          };
        }
      }
      return { ...p, isOpt, dte, delta, theta, iv, distancePct, isShort, breachedAdjust, breachInfo };
    });
  }, [positions, current, expiry, adjustThreshPct]);

  // Emit adjustment alerts (dedupe by tradingsymbol) upstream
  useEffect(() => {
    if (!onAdjustmentAlert) return;
    rows.filter((r) => r.breachedAdjust).forEach((r) => {
      onAdjustmentAlert({
        tradingsymbol: r.tradingsymbol,
        strike: r.strike,
        side: r.side,
        distancePct: r.breachInfo?.distancePct,
        coveredPct: r.breachInfo?.coveredPct,
        spot,
      });
    });
  }, [rows, onAdjustmentAlert, spot]);

  // Aggregate stats
  const stats = useMemo(() => {
    let netDelta = 0, netTheta = 0, netPnl = 0, minMinutes = null;
    for (const r of rows) {
      if (r.delta != null) netDelta += r.delta * r.quantity;
      if (r.theta != null) netTheta += r.theta * r.quantity;
      netPnl += r.pnl || 0;
      if (r.dte != null) {
        const mins = r.dte * 24 * 60;
        if (minMinutes == null || mins < minMinutes) minMinutes = mins;
      }
    }
    return { netDelta, netTheta, netPnl, minMinutes };
  }, [rows]);

  if (!isKiteMode) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center">
        <PlugZap className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <div className="text-sm font-semibold text-slate-700">Kite Live mode required</div>
        <div className="text-xs text-slate-500 mt-1">
          Connect your Zerodha Kite API from the top-right “Kite API” button to pull your open F&amp;O positions here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="positions-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-700" />
          <div className="text-sm font-semibold">Kite Open Positions</div>
          <span className="text-[10px] font-mono-data bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-sm">{positions.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <label>Adjust @</label>
            <input
              type="number"
              min={30} max={95} step={5}
              value={adjustThreshPct}
              onChange={(e) => setAdjustThreshPct(Number(e.target.value))}
              className="w-14 h-7 px-1 text-xs border border-slate-200 rounded-sm font-mono-data"
              data-testid="adjust-threshold"
            />
            <span>% band-covered</span>
          </div>
          <Button size="sm" variant="outline" className="h-7 rounded-sm" onClick={load} disabled={loading} data-testid="btn-refresh-positions">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <StatBox label="Net P&L" value={"₹ " + fmt(stats.netPnl)} tone={stats.netPnl >= 0 ? "emerald" : "rose"} />
        <StatBox label="Net Δ" value={fmt(stats.netDelta, 1)} tone={Math.abs(stats.netDelta) < 10 ? "emerald" : Math.abs(stats.netDelta) < 30 ? "amber" : "rose"} hint={Math.abs(stats.netDelta) < 10 ? "Neutral" : "Directional"} />
        <StatBox label="Net Θ / day" value={"₹ " + fmt(stats.netTheta * 1, 0)} tone={stats.netTheta >= 0 ? "emerald" : "rose"} hint={stats.netTheta >= 0 ? "Earning premium" : "Paying premium"} />
        <OvernightRiskScore
          vix={vix}
          netDelta={stats.netDelta}
          positionsCount={rows.length}
          minutesToExpiry={stats.minMinutes}
        />
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs font-mono-data">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-left px-2 py-2">Symbol</th>
              <th className="text-right px-2 py-2">Qty</th>
              <th className="text-right px-2 py-2">Avg</th>
              <th className="text-right px-2 py-2">LTP</th>
              <th className="text-right px-2 py-2">P&amp;L</th>
              <th className="text-right px-2 py-2">Δ</th>
              <th className="text-right px-2 py-2">Θ</th>
              <th className="text-right px-2 py-2">IV</th>
              <th className="text-right px-2 py-2">DTE</th>
              <th className="text-left px-2 py-2">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-6 text-slate-400 text-xs">No open F&amp;O positions.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.tradingsymbol} data-testid="position-row" className={`border-b border-slate-100 ${r.breachedAdjust ? "bg-rose-50" : ""}`}>
                <td className="px-2 py-1.5">
                  <div className="text-slate-900 font-semibold">{r.tradingsymbol}</div>
                  <div className="text-[10px] text-slate-500">{r.product} · {r.exchange}</div>
                </td>
                <td className={`text-right px-2 py-1.5 ${r.isShort ? "text-rose-600" : "text-emerald-600"}`}>{r.quantity}</td>
                <td className="text-right px-2 py-1.5">{fmt(r.average_price)}</td>
                <td className="text-right px-2 py-1.5">{fmt(r.last_price)}</td>
                <td className={`text-right px-2 py-1.5 font-semibold ${r.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(r.pnl, 0)}</td>
                <td className="text-right px-2 py-1.5">{r.delta != null ? r.delta.toFixed(2) : "—"}</td>
                <td className="text-right px-2 py-1.5">{r.theta != null ? r.theta.toFixed(2) : "—"}</td>
                <td className="text-right px-2 py-1.5">{r.iv != null ? r.iv.toFixed(1) + "%" : "—"}</td>
                <td className="text-right px-2 py-1.5">{r.dte != null ? r.dte.toFixed(1) + "d" : "—"}</td>
                <td className="px-2 py-1.5">
                  {r.breachedAdjust ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-rose-300 bg-rose-100 text-rose-800 text-[10px]">
                      <AlertTriangle className="w-3 h-3" /> Adjust
                    </span>
                  ) : r.isShort && r.isOpt ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Safe</span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lastRefresh && (
        <div className="text-[10px] text-slate-400 text-right">Last refresh {new Date(lastRefresh).toLocaleTimeString()}</div>
      )}
    </div>
  );
}

function StatBox({ label, value, tone = "slate", hint }) {
  const cls = tone === "emerald"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-white text-slate-700";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`} data-testid={`stat-${label.replace(/\s|&|₹|\+|\//g, "-").toLowerCase()}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-lg font-semibold font-mono-data leading-tight">{value}</div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}
