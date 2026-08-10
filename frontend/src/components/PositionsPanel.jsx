import { useEffect, useState, useMemo, useCallback } from "react";
import { RefreshCw, PlugZap, AlertTriangle, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
import { Button } from "@/components/ui/button";
import {
  yearsToExpiry,
  greeks,
  impliedVol,
  shortPremiumLeft,
  extrinsicPremium,
} from "@/lib/blackScholes";
import OvernightRiskScore from "@/components/OvernightRiskScore";
import InfoTip from "@/components/InfoTip";

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function resolveExpiryFromCode(yy, mm, activeExpiries = []) {
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const yyyy = 2000 + parseInt(yy, 10);
  if (mm.length === 3 && MON[mm]) {
    const m = MON[mm];
    const last = new Date(Date.UTC(yyyy, m, 0));
    const lastDay = last.getUTCDay();
    const offset = (lastDay - 4 + 7) % 7;
    const lastThu = new Date(Date.UTC(yyyy, m - 1, last.getUTCDate() - offset));
    return lastThu.toISOString().slice(0, 10);
  }
  if (activeExpiries.length) return activeExpiries[0];
  return null;
}

const POSITIONS_GUIDE = (
  <div className="space-y-2">
    <p>
      Built for <b>non-directional option sellers</b>. Shorts (qty &lt; 0) earn premium; the desk
      flags when spot walks too close to a short strike.
    </p>
    <p>
      <b>Adjust @ X% band-covered</b> — we treat a typical defence band as <b>3%</b> of spot from
      your short strike. As spot moves toward the strike, “band-covered” rises from 0% → 100%.
      When covered ≥ your Adjust % (default 60%), the row flips to <b>Adjust</b>.
    </p>
    <p>
      <b>Safe</b> — short option that is still outside the Adjust threshold (spot has not eaten
      enough of the 3% band). Not a guarantee of profit — only a proximity check.
    </p>
    <p>
      <b>Net Δ</b> — portfolio delta (signed qty). Non-directional sellers usually keep this near 0
      (hedged). <b>Net Θ / day</b> — estimated ₹ theta you earn/pay per calendar day — a seller&apos;s
      best friend when the book is flat.
    </p>
    <p>
      <b>Funds available</b> — Kite equity <i>net</i> margin left for trading (read-only). Cash is
      account value; utilised is margin already blocked by open positions.
    </p>
    <p>
      <b>Premium left (EOD)</b> — for shorts, remaining <i>extrinsic</i> premium × |qty|. On expiry
      day this is roughly what can still decay in your favour by 15:30 if the option dies toward
      intrinsic. Not a promise — IV crush / spot moves change it.
    </p>
  </div>
);

export default function PositionsPanel({ isKiteMode, current, vix, oiSettings, activeIndex, expiry, onAdjustmentAlert }) {
  const [positions, setPositions] = useState([]);
  const [funds, setFunds] = useState(null);
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
      setFunds(data.funds || null);
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
    const closed = isMarketQuiescent();
    load();
    if (closed) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [isKiteMode, load]);

  const spot = current?.price;

  const rows = useMemo(() => {
    if (!positions.length || !current) return [];
    const S = current.price;
    const activeExp = expiry || current?.expiry;
    const nowMs = Date.now();
    return positions.map((p) => {
      const isOpt = !!p.strike && !!p.side;
      let dte = null, T = 0, delta = null, theta = null, iv = null;
      let distancePct = null;
      let extrinsicLeft = null;
      let thetaToClose = null;
      let onExpiryDay = false;
      if (isOpt) {
        const expIso = resolveExpiryFromCode(p.expiry_yy, p.expiry_code, activeExp ? [activeExp] : []);
        if (expIso) {
          T = yearsToExpiry(expIso, nowMs);
          dte = T * 365;
          onExpiryDay = dte < 1.05;
          const isCall = p.side === "CE";
          const px = p.last_price || p.average_price;
          const ivGuess = impliedVol(px, S, p.strike, T, 0.065, isCall);
          if (ivGuess) {
            iv = ivGuess * 100;
            const g = greeks(S, p.strike, T, 0.065, ivGuess, isCall);
            delta = g.delta;
            theta = g.theta;
          }
          if (p.quantity < 0) {
            const left = shortPremiumLeft({
              marketPrice: px,
              S,
              K: p.strike,
              isCall,
              quantity: p.quantity,
              thetaPerUnit: theta,
              nowMs,
            });
            extrinsicLeft = left.extrinsicLeft;
            thetaToClose = left.thetaToClose;
          } else if (px != null) {
            const ext = extrinsicPremium(px, S, p.strike, p.side === "CE");
            extrinsicLeft = ext != null ? ext * Math.abs(p.quantity) : null;
          }
        }
        distancePct = ((p.strike - S) / S) * 100;
      }
      const isShort = p.quantity < 0;
      let breachedAdjust = false;
      let breachInfo = null;
      if (isOpt && isShort) {
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
      return {
        ...p,
        isOpt,
        dte,
        delta,
        theta,
        iv,
        distancePct,
        isShort,
        breachedAdjust,
        breachInfo,
        extrinsicLeft,
        thetaToClose,
        onExpiryDay,
      };
    });
  }, [positions, current, expiry, adjustThreshPct]);

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

  const stats = useMemo(() => {
    let netDelta = 0, netTheta = 0, netPnl = 0, minMinutes = null;
    let premiumLeft = 0, premiumLeftN = 0;
    let thetaToClose = 0, thetaToCloseN = 0;
    let shortCount = 0, adjustCount = 0;
    for (const r of rows) {
      if (r.delta != null) netDelta += r.delta * r.quantity;
      if (r.theta != null) netTheta += r.theta * r.quantity;
      netPnl += r.pnl || 0;
      if (r.isShort && r.isOpt) {
        shortCount += 1;
        if (r.breachedAdjust) adjustCount += 1;
      }
      if (r.extrinsicLeft != null && r.isShort) {
        premiumLeft += r.extrinsicLeft;
        premiumLeftN += 1;
      }
      if (r.thetaToClose != null && r.isShort) {
        thetaToClose += r.thetaToClose;
        thetaToCloseN += 1;
      }
      if (r.dte != null) {
        const mins = r.dte * 24 * 60;
        if (minMinutes == null || mins < minMinutes) minMinutes = mins;
      }
    }
    return {
      netDelta,
      netTheta,
      netPnl,
      minMinutes,
      premiumLeft: premiumLeftN ? premiumLeft : null,
      thetaToClose: thetaToCloseN ? thetaToClose : null,
      shortCount,
      adjustCount,
    };
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
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 sm:p-4" data-testid="positions-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-700" />
          <div className="text-sm font-semibold text-slate-900">Kite Open Positions</div>
          <span className="text-[10px] font-mono-data bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-sm">{positions.length}</span>
          <InfoTip title="Positions · seller guide" testId="positions-guide-tip">
            {POSITIONS_GUIDE}
          </InfoTip>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <label>Adjust @</label>
            <input
              type="number"
              min={30} max={95} step={5}
              value={adjustThreshPct}
              onChange={(e) => setAdjustThreshPct(Number(e.target.value))}
              className="w-14 h-7 px-1 text-xs border border-slate-200 rounded-sm font-mono-data bg-white"
              data-testid="adjust-threshold"
            />
            <span>% band-covered</span>
            <InfoTip title="Adjust threshold" testId="adjust-threshold-tip">
              <p>
                Spot vs short strike is measured inside a fixed <b>3% of spot</b> defence band.
                When that band is ≥ this % covered (default 60%), Signal becomes <b>Adjust</b>
                and the row highlights rose. Raise the % to stay “Safe” longer; lower it to get
                earlier warnings.
              </p>
            </InfoTip>
          </div>
          <Button size="sm" variant="outline" className="h-7 rounded-sm bg-white" onClick={load} disabled={loading} data-testid="btn-refresh-positions">
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatBox label="Net P&L" value={"₹ " + fmt(stats.netPnl)} tone={stats.netPnl >= 0 ? "emerald" : "rose"} />
        <StatBox
          label="Funds available"
          value={funds?.net != null ? "₹ " + fmt(funds.net, 0) : "—"}
          tone="slate"
          hint={funds?.utilised_debits != null ? `Margin used ₹ ${fmt(funds.utilised_debits, 0)}` : "Kite equity net"}
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Funds available</b> = Kite equity <b>net</b> margin left for trading (read-only).
              </p>
              <p>
                Cash / account value: {funds?.cash != null ? `₹ ${fmt(funds.cash, 0)}` : "—"}.
                Collateral: {funds?.collateral != null ? `₹ ${fmt(funds.collateral, 0)}` : "—"}.
              </p>
              <p className="text-slate-500">Never places orders — margins snapshot only.</p>
            </div>
          )}
        />
        <StatBox
          label="Net Θ / day"
          value={"₹ " + fmt(stats.netTheta, 0)}
          tone={stats.netTheta >= 0 ? "emerald" : "rose"}
          hint={stats.netTheta >= 0 ? "Seller’s friend · earning" : "Paying premium"}
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Theta is a non-directional seller’s best friend</b> when the book is delta-neutral:
                time decay works for you every day the spot stays away from your shorts.
              </p>
              <p>
                Shown as portfolio ₹/day (Θ × qty). Short options with positive net Θ are collecting
                premium; negative means the book is paying (longs dominate).
              </p>
            </div>
          )}
        />
        <StatBox
          label="Net Δ"
          value={fmt(stats.netDelta, 1)}
          tone={Math.abs(stats.netDelta) < 10 ? "emerald" : Math.abs(stats.netDelta) < 30 ? "amber" : "rose"}
          hint={Math.abs(stats.netDelta) < 10 ? "Neutral · good for sellers" : "Directional · hedge?"}
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Net delta</b> is the signed sum of (Δ × qty) across open options. It answers:
                “If the index moves ₹1, how much does my book mark roughly?”
              </p>
              <p>
                Non-directional sellers aim for <b>|Δ| near 0</b> (≈ under 10 here). Large positive Δ
                behaves long the index; large negative Δ behaves short. Hedge / roll when it drifts.
              </p>
            </div>
          )}
        />
        <StatBox
          label="Premium left"
          value={stats.premiumLeft != null ? "₹ " + fmt(stats.premiumLeft, 0) : "—"}
          tone="slate"
          hint="Short extrinsic → EOD / expiry"
          tip={(
            <p>
              Sum of remaining <b>extrinsic</b> premium on short options × |qty|. On expiry day,
              this is the bulk of what can still decay into your pocket by 15:30 if spots stay away
              and IV does not spike. Live estimate — not a fill guarantee.
            </p>
          )}
        />
        <OvernightRiskScore
          vix={vix}
          netDelta={stats.netDelta}
          positionsCount={rows.length}
          minutesToExpiry={stats.minMinutes}
        />
      </div>

      {stats.shortCount > 0 && (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 flex flex-wrap gap-x-4 gap-y-1" data-testid="positions-seller-strip">
          <span>
            Shorts <b>{stats.shortCount}</b>
            {stats.adjustCount > 0 ? (
              <span className="text-rose-700"> · {stats.adjustCount} need Adjust</span>
            ) : (
              <span className="text-emerald-700"> · all Safe vs band</span>
            )}
          </span>
          {stats.thetaToClose != null && (
            <span title="Theta × minutes left to 15:30 IST">
              Θ to close today ≈ <b className="font-mono-data text-emerald-800">₹ {fmt(stats.thetaToClose, 0)}</b>
            </span>
          )}
          {funds?.net != null && (
            <span title="Kite equity net margin">
              Funds <b className="font-mono-data">₹ {fmt(funds.net, 0)}</b>
            </span>
          )}
        </div>
      )}

      <div className="overflow-auto rounded-md border border-slate-100">
        <table className="w-full text-xs font-mono-data bg-white">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-left px-2 py-2">Symbol</th>
              <th className="text-right px-2 py-2">Qty</th>
              <th className="text-right px-2 py-2">Avg</th>
              <th className="text-right px-2 py-2">LTP</th>
              <th className="text-right px-2 py-2">P&amp;L</th>
              <th className="text-right px-2 py-2">Δ</th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Θ ₹/d
                  <InfoTip title="Theta ₹ / day" size="xs" testId="theta-col-tip">
                    Per-leg theta in rupees per day (Θ × qty). For shorts this is usually positive —
                    premium you collect from time decay.
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Prem left
                  <InfoTip title="Premium left" size="xs" testId="prem-left-col-tip">
                    Extrinsic × |qty| for shorts — what can still decay by expiry / EOD.
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">IV</th>
              <th className="text-right px-2 py-2">DTE</th>
              <th className="text-left px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Signal
                  <InfoTip title="Safe vs Adjust" size="xs" testId="signal-col-tip">
                    <b>Safe</b> = short option still outside your Adjust % of the 3% spot band.
                    <b> Adjust</b> = spot has walked close enough that you should hedge / roll / cut.
                  </InfoTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-6 text-slate-400 text-xs bg-white">No open F&amp;O positions.</td></tr>
            ) : rows.map((r) => {
              const thetaInr = r.theta != null ? r.theta * r.quantity : null;
              return (
              <tr key={r.tradingsymbol} data-testid="position-row" className={`border-b border-slate-100 bg-white ${r.breachedAdjust ? "bg-rose-50/80" : ""}`}>
                <td className="px-2 py-1.5">
                  <div className="text-slate-900 font-semibold">{r.tradingsymbol}</div>
                  <div className="text-[10px] text-slate-500">{r.product} · {r.exchange}</div>
                </td>
                <td className={`text-right px-2 py-1.5 ${r.isShort ? "text-rose-600" : "text-emerald-600"}`}>{r.quantity}</td>
                <td className="text-right px-2 py-1.5">{fmt(r.average_price)}</td>
                <td className="text-right px-2 py-1.5">{fmt(r.last_price)}</td>
                <td className={`text-right px-2 py-1.5 font-semibold ${r.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(r.pnl, 0)}</td>
                <td className="text-right px-2 py-1.5">{r.delta != null ? r.delta.toFixed(2) : "—"}</td>
                <td className={`text-right px-2 py-1.5 font-semibold ${thetaInr == null ? "" : thetaInr >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {thetaInr != null ? fmt(thetaInr, 0) : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-slate-700">
                  {r.isShort && r.extrinsicLeft != null ? (
                    <span title={r.onExpiryDay ? "Expiry day — extrinsic left to 15:30" : "Extrinsic left"}>
                      ₹{fmt(r.extrinsicLeft, 0)}
                    </span>
                  ) : "—"}
                </td>
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
            );})}
          </tbody>
        </table>
      </div>
      {lastRefresh && (
        <div className="text-[10px] text-slate-400 text-right">Last refresh {new Date(lastRefresh).toLocaleTimeString()}</div>
      )}
    </div>
  );
}

function StatBox({ label, value, tone = "slate", hint, tip }) {
  const cls = tone === "emerald"
    ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-900"
    : tone === "rose"
      ? "border-rose-200/80 bg-rose-50/70 text-rose-900"
      : tone === "amber"
        ? "border-amber-200/80 bg-amber-50/70 text-amber-900"
        : "border-slate-200 bg-slate-50/80 text-slate-800";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`} data-testid={`stat-${label.replace(/\s|&|₹|\+|\//g, "-").toLowerCase()}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70 inline-flex items-center gap-1">
        {label}
        {tip && (
          <InfoTip title={label} size="xs">{tip}</InfoTip>
        )}
      </div>
      <div className="text-lg font-semibold font-mono-data leading-tight">{value}</div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}
