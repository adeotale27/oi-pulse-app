import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { RefreshCw, PlugZap, AlertTriangle, Building2, Zap, ShieldAlert, Crosshair, Pin, LineChart } from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  yearsToExpiry,
  greeks,
  impliedVol,
  shortPremiumLeft,
  extrinsicPremium,
} from "@/lib/blackScholes";
import { computeSellCandidates } from "@/lib/sellCandidates";
import {
  loadPositionsToggles,
  savePositionsToggles,
  computeBookVerdict,
  computeAssignmentWatch,
  computeDeltaHedgeSuggestions,
  computeExpiryDayClock,
  effectiveAdjustThreshold,
  nearestWeeklyExpiry,
} from "@/lib/positionsSellerInsights";
import { resolvePositionSpot, positionExpiryISO } from "@/lib/positionPayoff";
import OvernightRiskScore from "@/components/OvernightRiskScore";
import PositionsAnalyzeModal from "@/components/PositionsAnalyzeModal";
import InfoTip from "@/components/InfoTip";

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
    <p>
      <b>Sell / decay ideas</b> — OI + IV + gamma scoring for the selected expiry. Toggle blocks
      on/off in the Positions suggestion controls.
    </p>
    <p>
      <b>Expiry-day mode</b> — after 13:00 IST on expiry, Adjust band tightens and prem-left is
      shown vs minutes to 15:30. <b>Δ hedge</b> suggests futures / far-OTM buys when |Net Δ| drifts.
      <b> Assignment watch</b> flags ITM / low-extrinsic shorts late in the day.
    </p>
  </div>
);

export default function PositionsPanel({
  isKiteMode,
  current,
  previous = null,
  vix,
  vixOpen = null,
  oiSettings,
  activeIndex,
  expiry,
  step = 50,
  vrp = null,
  expiriesMeta = [],
  onPinNearestWeekly,
  onAdjustmentAlert,
  positionsPollMs = 30000,
}) {
  const [positions, setPositions] = useState([]);
  const [spotByIndex, setSpotByIndex] = useState({});
  const [oiByIndex, setOiByIndex] = useState({});
  const [funds, setFunds] = useState(null);
  const [brokerage, setBrokerage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [adjustThreshPct, setAdjustThreshPct] = useState(60);
  const [toggles, setToggles] = useState(() => loadPositionsToggles());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [secsLeft, setSecsLeft] = useState(() => Math.max(1, Math.round(positionsPollMs / 1000)));
  const pollMs = Math.max(5000, Number(positionsPollMs) || 30000);
  const loadGen = useRef(0);

  const setToggle = useCallback((key, on) => {
    setToggles((prev) => {
      const next = { ...prev, [key]: !!on };
      savePositionsToggles(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const loadBrokerage = useCallback(async () => {
    try {
      const { data } = await api.get("/positions/brokerage-day");
      setBrokerage(data || null);
    } catch {
      setBrokerage(null);
    }
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/positions");
      if (gen !== loadGen.current) return;
      setPositions(data.positions || []);
      setFunds(data.funds || null);
      setSpotByIndex(data.spot && typeof data.spot === "object" ? data.spot : {});
      setOiByIndex(data.oi && typeof data.oi === "object" ? data.oi : {});
      if (data.error) setError(data.error);
      setLastRefresh(new Date().toISOString());
      setSecsLeft(Math.max(1, Math.round(pollMs / 1000)));
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e?.response?.data?.detail || e.message);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [pollMs]);

  useEffect(() => {
    if (!isKiteMode) return;
    const closed = isMarketQuiescent();
    load();
    loadBrokerage();
    if (closed) return;
    const id = setInterval(() => {
      load();
      loadBrokerage();
    }, pollMs);
    return () => clearInterval(id);
  }, [isKiteMode, load, loadBrokerage, pollMs]);

  useEffect(() => {
    if (!isKiteMode || isMarketQuiescent()) return;
    setSecsLeft(Math.max(1, Math.round(pollMs / 1000)));
    const id = setInterval(() => {
      setSecsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isKiteMode, pollMs, lastRefresh]);

  const spot = current?.price;

  const rows = useMemo(() => {
    if (!positions.length) return [];
    const activeExp = expiry || current?.expiry;
    const nowMs = nowTick;
    const fallbackS = current?.price;
    const mapped = positions.map((p) => {
      const isOpt = !!p.strike && !!p.side;
      let dte = null, T = 0, delta = null, theta = null, gamma = null, iv = null;
      let distancePct = null;
      let extrinsicLeft = null;
      let thetaToClose = null;
      let onExpiryDay = false;
      let greeksHealth = null; // null | 'no_spot' | 'iv_na' | 'ok'
      // Prefer per-index Kite spot from /positions; only reuse dashboard spot when same index.
      const dashboardSpot =
        p.index && activeIndex && p.index !== activeIndex ? null : fallbackS;
      const S = resolvePositionSpot(p, spotByIndex, dashboardSpot);
      if (isOpt) {
        if (!(S != null && Number.isFinite(S) && S > 0)) {
          greeksHealth = "no_spot";
        } else {
          const expIso = positionExpiryISO(p, activeExp);
          if (expIso) {
            T = yearsToExpiry(expIso, nowMs);
            dte = T * 365;
            onExpiryDay = dte < 1.05;
            const isCall = p.side === "CE";
            const px = Number(p.last_price || p.average_price);
            const ivGuess = Number.isFinite(px) && px > 0
              ? impliedVol(px, S, p.strike, T, 0.065, isCall)
              : null;
            if (ivGuess != null && Number.isFinite(ivGuess) && ivGuess > 0) {
              iv = ivGuess * 100;
              const g = greeks(S, p.strike, T, 0.065, ivGuess, isCall);
              delta = Number.isFinite(g.delta) ? g.delta : null;
              theta = Number.isFinite(g.theta) ? g.theta : null;
              gamma = Number.isFinite(g.gamma) ? g.gamma : null;
              greeksHealth = "ok";
            } else {
              greeksHealth = "iv_na";
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
              extrinsicLeft = Number.isFinite(left.extrinsicLeft) ? left.extrinsicLeft : null;
              thetaToClose = Number.isFinite(left.thetaToClose) ? left.thetaToClose : null;
            } else if (Number.isFinite(px)) {
              const ext = extrinsicPremium(px, S, p.strike, p.side === "CE");
              extrinsicLeft = ext != null && Number.isFinite(ext) ? ext * Math.abs(p.quantity) : null;
            }
          } else {
            greeksHealth = "iv_na";
          }
          distancePct = ((p.strike - S) / S) * 100;
        }
      }
      const isShort = p.quantity < 0;
      return {
        ...p,
        isOpt,
        dte,
        delta,
        theta,
        gamma,
        iv,
        distancePct,
        isShort,
        breachedAdjust: false,
        breachInfo: null,
        extrinsicLeft,
        thetaToClose,
        onExpiryDay,
        spotUsed: S,
        greeksHealth,
      };
    });

    const anyExpiryDay = mapped.some((r) => r.isOpt && r.isShort && r.onExpiryDay);
    const thresh = effectiveAdjustThreshold(adjustThreshPct, {
      expiryDayMode: toggles.expiryDayMode,
      anyExpiryDay,
      nowMs,
    });

    return mapped.map((r) => {
      if (!(r.isOpt && r.isShort && r.spotUsed)) return r;
      const bandPct = 3;
      const distPct = Math.abs((r.strike - r.spotUsed) / r.spotUsed) * 100;
      const covered = 1 - (distPct / bandPct);
      if (covered >= thresh / 100) {
        return {
          ...r,
          breachedAdjust: true,
          breachInfo: {
            distancePct: distPct.toFixed(2),
            coveredPct: (covered * 100).toFixed(0),
          },
        };
      }
      return r;
    });
  }, [positions, current, expiry, adjustThreshPct, spotByIndex, toggles.expiryDayMode, nowTick, activeIndex]);

  useEffect(() => {
    if (!onAdjustmentAlert) return;
    rows.filter((r) => r.breachedAdjust).forEach((r) => {
      onAdjustmentAlert({
        tradingsymbol: r.tradingsymbol,
        strike: r.strike,
        side: r.side,
        distancePct: r.breachInfo?.distancePct,
        coveredPct: r.breachInfo?.coveredPct,
        spot: r.spotUsed ?? spot,
      });
    });
  }, [rows, onAdjustmentAlert, spot]);

  const stats = useMemo(() => {
    let netDelta = 0, netTheta = 0, netPnl = 0, minMinutes = null;
    let premiumLeft = 0, premiumLeftN = 0;
    let thetaToClose = 0, thetaToCloseN = 0;
    let shortCount = 0, adjustCount = 0;
    for (const r of rows) {
      if (r.delta != null && Number.isFinite(r.delta)) netDelta += r.delta * r.quantity;
      if (r.theta != null && Number.isFinite(r.theta)) netTheta += r.theta * r.quantity;
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

  const sellIdeas = useMemo(() => {
    if (!current?.strikes?.length) return null;
    return computeSellCandidates({
      current,
      previous,
      vixNow: vix,
      vixOpen,
      indexName: activeIndex,
      step,
      vrp,
    });
  }, [current, previous, vix, vixOpen, activeIndex, step, vrp]);

  const heldShortKeys = useMemo(() => {
    const s = new Set();
    for (const r of rows) {
      if (r.isShort && r.isOpt && r.strike != null && r.side) {
        s.add(`${r.side}:${r.strike}`);
      }
    }
    return s;
  }, [rows]);

  const topSell = useMemo(() => {
    if (!sellIdeas) return { ce: [], pe: [] };
    return {
      ce: (sellIdeas.candidates?.ce || []).slice(0, 3),
      pe: (sellIdeas.candidates?.pe || []).slice(0, 3),
    };
  }, [sellIdeas]);

  const decayBook = useMemo(() => {
    return rows
      .filter((r) => r.isShort && r.isOpt && r.extrinsicLeft != null && r.extrinsicLeft > 0)
      .sort((a, b) => (b.extrinsicLeft || 0) - (a.extrinsicLeft || 0))
      .slice(0, 4);
  }, [rows]);

  const assignmentWatch = useMemo(() => {
    return computeAssignmentWatch(rows, {
      nowMs: nowTick,
      expiryDayMode: toggles.expiryDayMode,
    });
  }, [rows, toggles.expiryDayMode, nowTick]);

  const deltaHedge = useMemo(() => {
    if (!toggles.deltaHedge) return { needed: false };
    return computeDeltaHedgeSuggestions({
      netDelta: stats.netDelta,
      threshold: 10,
      strikes: current?.strikes || [],
      spot: spot ?? current?.price,
      step,
    });
  }, [toggles.deltaHedge, stats.netDelta, current, spot, step]);

  const expiryClock = useMemo(() => {
    if (!toggles.expiryDayMode) return { active: false, items: [] };
    return computeExpiryDayClock(rows, nowTick);
  }, [toggles.expiryDayMode, rows, nowTick]);

  const bookVerdict = useMemo(() => {
    if (!toggles.bookVerdict) return null;
    return computeBookVerdict({
      netDelta: stats.netDelta,
      netTheta: stats.netTheta,
      shortCount: stats.shortCount,
      adjustCount: stats.adjustCount,
      premiumLeft: stats.premiumLeft,
      itmShortCount: assignmentWatch.filter((w) => w.itm).length,
      pnl: stats.netPnl,
    });
  }, [toggles.bookVerdict, stats, assignmentWatch]);

  const pinWeeklyDate = useMemo(() => nearestWeeklyExpiry(expiriesMeta), [expiriesMeta]);

  const TOGGLE_DEFS = [
    { key: "bookVerdict", label: "Book verdict" },
    { key: "sellIdeas", label: "Sell ideas" },
    { key: "decayBook", label: "Decay book" },
    { key: "expiryDayMode", label: "Expiry-day" },
    { key: "deltaHedge", label: "Δ hedge" },
    { key: "assignmentWatch", label: "Assignment" },
  ];

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
              className="w-14 h-8 px-1 text-xs border border-slate-200 rounded-sm font-mono-data bg-white"
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
          <div
            className="flex flex-col items-end leading-tight px-2 py-1 rounded-sm border border-slate-200 bg-slate-50"
            data-testid="positions-brokerage-day"
            title={brokerage?.error || "Today’s brokerage from Kite virtual contract note (read-only)"}
          >
            <span className="text-[9px] uppercase tracking-wider text-slate-500">Brokerage today</span>
            <span className="text-xs font-mono-data font-semibold text-slate-800">
              {brokerage?.brokerage != null ? `₹ ${fmt(brokerage.brokerage, 0)}` : "—"}
            </span>
            {brokerage?.charges_total != null && (
              <span className="text-[9px] text-slate-400">all charges ₹ {fmt(brokerage.charges_total, 0)}</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white min-h-[32px] text-orange-700 border-orange-200 hover:bg-orange-50"
            onClick={() => setAnalyzeOpen(true)}
            disabled={!rows.length}
            data-testid="btn-analyze-positions"
          >
            <LineChart className="w-3.5 h-3.5 mr-1" />
            Analyze
          </Button>
          <Button size="sm" variant="outline" className="h-8 rounded-sm bg-white min-h-[32px]" onClick={() => { load(); loadBrokerage(); }} disabled={loading} data-testid="btn-refresh-positions">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
            {!isMarketQuiescent() && (
              <span className="ml-1.5 font-mono-data text-[10px] text-slate-500" data-testid="positions-refresh-countdown">
                {secsLeft}s
              </span>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatBox
          label="Net P&L"
          value={"₹ " + fmt(stats.netPnl)}
          tone={stats.netPnl >= 0 ? "emerald" : "rose"}
          hint={
            brokerage?.charges_total != null
              ? `After charges ₹ ${fmt(stats.netPnl - brokerage.charges_total, 0)}`
              : undefined
          }
          tip={(
            <div className="space-y-1.5">
              <p>Open F&amp;O mark-to-market P&amp;L from Kite (read-only).</p>
              {brokerage?.charges_total != null && (
                <p>
                  <b>Net of costs today</b> = Net P&amp;L − all charges (₹ {fmt(brokerage.charges_total, 0)}),
                  including brokerage ₹ {fmt(brokerage.brokerage, 0)}.
                </p>
              )}
            </div>
          )}
        />
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

      {/* Suggestion toggles — Positions page only */}
      <div
        className="rounded-md border border-slate-200 bg-white px-3 py-2 space-y-1.5"
        data-testid="positions-suggestion-toggles"
      >
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Suggestion blocks
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {TOGGLE_DEFS.map(({ key, label }) => (
            <label
              key={key}
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer select-none"
              data-testid={`toggle-${key}`}
            >
              <Switch
                checked={!!toggles[key]}
                onCheckedChange={(on) => setToggle(key, on)}
                className="scale-90"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {bookVerdict && (
        <div
          className={`rounded-md border px-3 py-2.5 space-y-1.5 ${
            bookVerdict.band === "GOOD"
              ? "border-emerald-300 bg-emerald-50/70"
              : bookVerdict.band === "WEAK"
                ? "border-rose-300 bg-rose-50/70"
                : "border-amber-300 bg-amber-50/70"
          }`}
          data-testid="positions-book-verdict"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-semibold text-slate-900">
              Your book · {bookVerdict.headline}
            </div>
            <span
              className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-sm border ${
                bookVerdict.band === "GOOD"
                  ? "border-emerald-400 bg-emerald-100 text-emerald-900"
                  : bookVerdict.band === "WEAK"
                    ? "border-rose-400 bg-rose-100 text-rose-900"
                    : "border-amber-400 bg-amber-100 text-amber-950"
              }`}
              data-testid="book-verdict-band"
            >
              {bookVerdict.band} · {bookVerdict.score}
            </span>
          </div>
          <ul className="text-[11px] text-slate-700 space-y-0.5 list-disc pl-4">
            {bookVerdict.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {toggles.expiryDayMode && (expiryClock.active || pinWeeklyDate) && (
        <div
          className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2.5 space-y-2"
          data-testid="positions-expiry-day"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5 text-sky-700" />
              Expiry-day mode
              {expiryClock.after13 && expiryClock.active && (
                <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 px-1 rounded-sm">
                  Adjust tightened ≤40%
                </span>
              )}
            </div>
            {pinWeeklyDate && typeof onPinNearestWeekly === "function" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-sm text-[11px] bg-white"
                data-testid="btn-pin-nearest-weekly"
                onClick={() => onPinNearestWeekly(pinWeeklyDate)}
              >
                Pin nearest weekly · {pinWeeklyDate}
              </Button>
            )}
          </div>
          {expiryClock.active ? (
            <div className="text-[11px] text-slate-700 space-y-1">
              <div>
                Prem left vs time to 15:30 ·{" "}
                <b className="font-mono-data">{expiryClock.minutesToClose ?? "—"} min</b>
                {" · total extrinsic "}
                <b className="font-mono-data">₹{fmt(expiryClock.totalExtrinsic, 0)}</b>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {expiryClock.items.slice(0, 4).map((it) => (
                  <span key={it.tradingsymbol} className="font-mono-data text-[10px]">
                    {it.strike}{it.side} ₹{fmt(it.extrinsicLeft, 0)}
                    {it.rupeesPerMinute != null && (
                      <span className="text-slate-500"> · ₹{fmt(it.rupeesPerMinute, 1)}/min</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 italic">
              No shorts marked expiry-day yet — pin weekly when you want the live chain on that expiry.
            </div>
          )}
        </div>
      )}

      {toggles.assignmentWatch && assignmentWatch.length > 0 && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50/50 px-3 py-2.5 space-y-1.5"
          data-testid="positions-assignment-watch"
        >
          <div className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-700" />
            Assignment / ITM watch
          </div>
          <ul className="space-y-1">
            {assignmentWatch.slice(0, 5).map((w) => (
              <li
                key={`${w.tradingsymbol}-${w.severity}`}
                className="text-[11px] text-slate-700 flex flex-wrap gap-x-2 gap-y-0.5"
              >
                <span
                  className={`text-[9px] font-bold uppercase px-1 rounded-sm border ${
                    w.severity === "critical"
                      ? "border-rose-400 bg-rose-200 text-rose-950"
                      : w.severity === "high"
                        ? "border-amber-400 bg-amber-100 text-amber-950"
                        : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {w.severity}
                </span>
                <b className="font-mono-data">{w.tradingsymbol}</b>
                <span>{w.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toggles.deltaHedge && deltaHedge.needed && (
        <div
          className="rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2.5 space-y-1.5"
          data-testid="positions-delta-hedge"
        >
          <div className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5 text-violet-700" />
            Portfolio hedge
          </div>
          <p className="text-[11px] text-slate-700">{deltaHedge.message}</p>
          <div className="text-[11px] font-mono-data text-slate-600">
            Futures qty ≈ <b>{fmt(deltaHedge.futuresQty, 1)}</b>
            {deltaHedge.otmBuys?.length > 0 && (
              <span>
                {" · far OTM "}
                {deltaHedge.otmBuys.map((o, i) => (
                  <span key={`${o.side}-${o.strike}`}>
                    {i > 0 ? ", " : ""}
                    {o.strike}{o.side} ₹{fmt(o.ltp, 1)}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2" data-testid="positions-mobile-cards">
        {rows.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs border border-slate-100 rounded-md">No open F&amp;O positions.</div>
        ) : rows.map((r) => {
          const thetaInr = Number.isFinite(r.theta) ? r.theta * r.quantity : null;
          return (
            <div
              key={r.tradingsymbol}
              data-testid="position-card"
              className={`rounded-md border px-3 py-2.5 ${r.breachedAdjust ? "border-rose-300 bg-rose-50/80" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{r.tradingsymbol}</div>
                  <div className="text-[10px] text-slate-500">{r.product} · {r.exchange}</div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <GreeksHealthChip health={r.greeksHealth} />
                  {r.breachedAdjust ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-rose-300 bg-rose-100 text-rose-800 text-[10px]">
                      <AlertTriangle className="w-3 h-3" /> Adjust
                    </span>
                  ) : r.isShort && r.isOpt ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Safe</span>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono-data">
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Qty</div>
                  <div className={r.isShort ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"}>{r.quantity}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">LTP</div>
                  <div>{fmt(r.last_price)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">P&amp;L</div>
                  <div className={`font-semibold ${r.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(r.pnl, 0)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Δ</div>
                  <div>{Number.isFinite(r.delta) ? r.delta.toFixed(2) : "—"}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Θ ₹/d</div>
                  <div className={thetaInr == null ? "" : thetaInr >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                    {thetaInr != null ? fmt(thetaInr, 0) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Prem left</div>
                  <div>{r.isShort && r.extrinsicLeft != null ? `₹${fmt(r.extrinsicLeft, 0)}` : "—"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-auto rounded-md border border-slate-100">
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
              const thetaInr = Number.isFinite(r.theta) ? r.theta * r.quantity : null;
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
                <td className="text-right px-2 py-1.5">{Number.isFinite(r.delta) ? r.delta.toFixed(2) : "—"}</td>
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
                <td className="text-right px-2 py-1.5">{Number.isFinite(r.iv) ? r.iv.toFixed(1) + "%" : "—"}</td>
                <td className="text-right px-2 py-1.5">{r.dte != null ? r.dte.toFixed(1) + "d" : "—"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <GreeksHealthChip health={r.greeksHealth} />
                    {r.breachedAdjust ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-rose-300 bg-rose-100 text-rose-800 text-[10px]">
                        <AlertTriangle className="w-3 h-3" /> Adjust
                      </span>
                    ) : r.isShort && r.isOpt ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Safe</span>
                    ) : !r.greeksHealth || r.greeksHealth === "ok" ? (
                      "—"
                    ) : null}
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {/* Sell / decay ideas for selected index expiry */}
      {(toggles.sellIdeas || toggles.decayBook) && (
      <div
        className="rounded-md border border-slate-200 bg-slate-50/80 p-3 space-y-2"
        data-testid="positions-sell-suggestions"
      >
        {toggles.sellIdeas && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-600">
            Sell / decay ideas · {activeIndex}
            {current?.expiry ? ` · ${current.expiry}` : ""}
          </div>
          {sellIdeas?.verdict && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${
                sellIdeas.verdict.tradeable
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {sellIdeas.verdict.tradeable ? "OK to sell premium" : "Cautious / skip"}
            </span>
          )}
        </div>
        )}

        {toggles.decayBook && decayBook.length > 0 && (
          <div className="text-[11px] text-slate-600" data-testid="positions-decay-book">
            <span className="font-semibold text-slate-700">Open shorts with extrinsic left: </span>
            {decayBook.map((r, i) => (
              <span key={r.tradingsymbol}>
                {i > 0 ? " · " : ""}
                <b className="font-mono-data">{r.strike}{r.side}</b>
                {" "}₹{fmt(r.extrinsicLeft, 0)}
                {r.theta != null && (
                  <span className="text-emerald-700"> · Θ ₹{fmt(r.theta * r.quantity, 0)}/d</span>
                )}
              </span>
            ))}
          </div>
        )}

        {toggles.sellIdeas && (
          <>
        {!sellIdeas?.verdict?.tradeable && sellIdeas?.verdict?.reasons?.length > 0 && (
          <ul className="text-[11px] text-amber-900 space-y-0.5 list-disc pl-4">
            {sellIdeas.verdict.reasons.slice(0, 3).map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        )}

        {(topSell.ce.length > 0 || topSell.pe.length > 0) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {["ce", "pe"].map((sideKey) => {
              const list = topSell[sideKey];
              if (!list.length) return null;
              return (
                <div key={sideKey} className="space-y-1.5">
                  <div className={`text-[10px] font-semibold uppercase tracking-wide ${sideKey === "ce" ? "text-rose-600" : "text-emerald-700"}`}>
                    {sideKey === "ce" ? "Calls to sell" : "Puts to sell"}
                  </div>
                  {list.map((c) => {
                    const held = heldShortKeys.has(`${c.side}:${c.strike}`);
                    const thetaDay = c.theta != null ? c.theta : null;
                    return (
                      <div
                        key={`${c.side}-${c.strike}`}
                        data-testid={`pos-sell-${c.side}-${c.strike}`}
                        className={`rounded-md border bg-white px-2.5 py-2 ${held ? "border-emerald-300 ring-1 ring-emerald-200" : "border-slate-200"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono-data text-sm font-semibold text-slate-900">
                            {c.strike} <span className={c.side === "CE" ? "text-rose-600" : "text-emerald-600"}>{c.side}</span>
                            <span className="ml-1.5 text-xs font-normal text-slate-500">₹{(c.ltp || 0).toFixed(2)}</span>
                          </div>
                          <span className="text-[10px] font-mono-data font-semibold text-slate-600">score {Math.round(c.score)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono-data text-slate-600">
                          <span>IV <b>{c.iv?.toFixed?.(1) ?? "—"}%</b></span>
                          <span>Δ <b>{(c.delta ?? 0).toFixed(2)}</b></span>
                          <span>Γ <b>{((c.gamma ?? 0) * 1e4).toFixed(2)}e-4</b></span>
                          {thetaDay != null && <span>Θ <b className="text-emerald-700">{thetaDay.toFixed(2)}</b>/u</span>}
                          {c.fresh && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700">
                              <Zap className="w-3 h-3" /> fresh
                            </span>
                          )}
                          {held && <span className="text-emerald-800 font-semibold">already short</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 italic">
            {sellIdeas?.expiryStale
              ? "Pick a live weekly expiry in the sidebar for sell ideas."
              : !sellIdeas?.verdict?.tradeable
                ? "Chain is live — sell scoring paused while the day is Cautious / skip (see reasons above)."
                : !current?.strikes?.length
                  ? "Waiting for option-chain snapshot for this expiry."
                  : "No CE·PE cleared the sell-score threshold right now."}
          </div>
        )}
          </>
        )}
      </div>
      )}

      {lastRefresh && (
        <div className="text-[10px] text-slate-400 text-right">Last refresh {new Date(lastRefresh).toLocaleTimeString()}</div>
      )}

      <PositionsAnalyzeModal
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        rows={rows}
        spotByIndex={spotByIndex}
        fallbackSpot={spot}
        oiByIndex={{
          ...oiByIndex,
          ...(current ? { [activeIndex]: { ...(oiByIndex[activeIndex] || {}), ...current, strikes: current.strikes || oiByIndex[activeIndex]?.strikes } } : {}),
        }}
        vix={vix}
      />
    </div>
  );
}

function GreeksHealthChip({ health }) {
  if (!health || health === "ok") return null;
  const label = health === "no_spot" ? "no spot" : "IV n/a";
  return (
    <span
      data-testid={`greeks-health-${health}`}
      title={
        health === "no_spot"
          ? "No per-index spot — greeks skipped"
          : "Could not solve IV for this leg (price/expiry)"
      }
      className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-semibold"
    >
      {label}
    </span>
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
