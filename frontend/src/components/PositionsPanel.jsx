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
  <div className="space-y-2 text-[12px] leading-relaxed">
    <p>
      This page watches options you <b>sold</b> (qty in red / negative). You earn when the market
      stays away from those strikes. Same-day <b>Exited</b> legs stay listed with realised P&amp;L
      until Zerodha clears them at end of day.
    </p>
    <p>
      <b>OK</b> — market is still far enough from that sold strike. Fine to leave alone for now.
      Not a profit guarantee — only a distance check.
    </p>
    <p>
      <b>Too close</b> — market has walked near that sold strike. Think hedge, roll, or exit.
      The “Warn @” % controls how early this warning fires (default 60% of a 3% band).
    </p>
    <p>
      <b>Direction tilt (Δ)</b> — are you accidentally betting up or down? Near 0 is best for sellers.
      <b> Daily time money (Θ)</b> — rough ₹ you earn/pay each day from time passing.
    </p>
    <p>
      <b>Still to earn</b> — leftover premium on sold options that can still decay into your pocket.
      <b> Fees today</b> — what Zerodha charged today (read-only).
    </p>
  </div>
);

function ExitedChip() {
  return (
    <span
      title="Squared off today — booked P&L stays in Today’s total until end of day"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-slate-300/80 bg-white/60 text-slate-500 text-[10px] font-semibold tracking-wide"
      data-testid="status-exited"
    >
      Exited
    </span>
  );
}

/** Professional symbol: NIFTY 11TH AUG 24800 CE */
function positionLabel(r) {
  return r?.display_name || r?.tradingsymbol || "—";
}

function AvgCell({ row }) {
  if (row?.exited) {
    const b = Number(row.buy_price);
    const s = Number(row.sell_price);
    if (Number.isFinite(b) && Number.isFinite(s) && (b > 0 || s > 0)) {
      return (
        <span className="text-slate-500" title="Buy avg → Sell avg (booked)">
          {fmt(b)}→{fmt(s)}
        </span>
      );
    }
    return <span className="text-slate-400">—</span>;
  }
  return <span>{fmt(row?.average_price)}</span>;
}

function StatusChip({ breached, isShortOpt, exited }) {
  if (exited) return <ExitedChip />;
  if (breached) {
    return (
      <span
        title="Market walked near this sold strike — hedge, roll, or exit"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-rose-300 bg-rose-100 text-rose-800 text-[10px] font-semibold"
        data-testid="status-too-close"
      >
        <AlertTriangle className="w-3 h-3" /> Too close
      </span>
    );
  }
  if (isShortOpt) {
    return (
      <span
        title="Market still away from this sold strike — OK to hold for now"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-semibold"
        data-testid="status-ok"
      >
        OK
      </span>
    );
  }
  return null;
}

/** How far ATM/spot is from this strike (points + %). */
function AtmDistanceCell({ row }) {
  if (!row?.isOpt || !Number.isFinite(row.atmDistance) || !Number.isFinite(row.atmRef)) {
    return <span className="text-slate-400">—</span>;
  }
  const pts = row.atmDistance; // strike − ATM
  const pct = row.distancePct;
  const absPts = Math.abs(pts);
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "";
  // For a sold option: CE is safer when strike > ATM (pts > 0); PE when strike < ATM (pts < 0).
  let tone = "text-slate-700";
  if (row.isShort && row.side === "CE") tone = pts > 0 ? "text-emerald-700" : "text-rose-700";
  if (row.isShort && row.side === "PE") tone = pts < 0 ? "text-emerald-700" : "text-rose-700";
  const sideHint =
    pts === 0
      ? "Strike is at ATM"
      : pts > 0
        ? `Strike is ${Math.round(absPts)} pts above ATM`
        : `Strike is ${Math.round(absPts)} pts below ATM`;
  return (
    <span
      className={`font-mono-data ${tone}`}
      title={`${sideHint} (ATM ≈ ${Math.round(row.atmRef)})`}
      data-testid="atm-distance"
    >
      {sign}{Math.round(absPts)}
      <span className="text-[10px] text-slate-400 ml-0.5">
        ({sign}{Math.abs(pct).toFixed(1)}%)
      </span>
    </span>
  );
}

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
  const [pnlToday, setPnlToday] = useState(null);
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
      setPnlToday(data.pnl_today || null);
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
      let atmDistance = null; // strike − ATM/spot (points)
      let atmRef = null;
      let extrinsicLeft = null;
      let thetaToClose = null;
      let onExpiryDay = false;
      let greeksHealth = null; // null | 'no_spot' | 'iv_na' | 'ok'
      // Prefer per-index Kite spot from /positions; only reuse dashboard spot when same index.
      const dashboardSpot =
        p.index && activeIndex && p.index !== activeIndex ? null : fallbackS;
      const S = resolvePositionSpot(p, spotByIndex, dashboardSpot);
      // Prefer rounded ATM from snapshot when present; else live spot.
      const spotEntry = p.index ? spotByIndex[p.index] : null;
      const atmFromMap = spotEntry && typeof spotEntry === "object" ? Number(spotEntry.atm) : null;
      if (isOpt) {
        if (!(S != null && Number.isFinite(S) && S > 0)) {
          greeksHealth = "no_spot";
        } else {
          atmRef = Number.isFinite(atmFromMap) && atmFromMap > 0 ? atmFromMap : S;
          atmDistance = p.strike - atmRef;
          distancePct = (atmDistance / atmRef) * 100;
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
        }
      }
      const exited = !!p.exited || Number(p.quantity) === 0;
      // Exited legs: qty is 0 — infer short/long from day's buy vs sell volume.
      const isShort = exited
        ? (p.side_bias === "short" || (Number(p.sell_quantity || 0) > Number(p.buy_quantity || 0)))
        : p.quantity < 0;
      const displayPnl = exited
        ? (p.booked_pnl != null ? Number(p.booked_pnl) : Number(p.pnl) || 0)
        : Number(p.pnl) || 0;
      return {
        ...p,
        exited,
        display_name: p.display_name || p.tradingsymbol,
        pnl: displayPnl,
        booked_pnl: p.booked_pnl != null ? Number(p.booked_pnl) : displayPnl,
        isOpt,
        dte: exited ? null : dte,
        delta: exited ? null : delta,
        theta: exited ? null : theta,
        gamma: exited ? null : gamma,
        iv: exited ? null : iv,
        distancePct: exited ? null : distancePct,
        atmDistance: exited ? null : atmDistance,
        atmRef: exited ? null : atmRef,
        isShort,
        breachedAdjust: false,
        breachInfo: null,
        extrinsicLeft: exited ? null : extrinsicLeft,
        thetaToClose: exited ? null : thetaToClose,
        onExpiryDay: exited ? false : onExpiryDay,
        spotUsed: S,
        greeksHealth: exited ? null : greeksHealth,
      };
    });

    // Open legs first, then same-day exits.
    mapped.sort((a, b) => Number(!!a.exited) - Number(!!b.exited));

    const anyExpiryDay = mapped.some((r) => !r.exited && r.isOpt && r.isShort && r.onExpiryDay);
    const thresh = effectiveAdjustThreshold(adjustThreshPct, {
      expiryDayMode: toggles.expiryDayMode,
      anyExpiryDay,
      nowMs,
    });

    return mapped.map((r) => {
      if (r.exited || !(r.isOpt && r.isShort && r.spotUsed)) return r;
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
    rows.filter((r) => !r.exited && r.breachedAdjust).forEach((r) => {
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
    let openCount = 0, exitedCount = 0;
    let openPnl = 0, exitedPnl = 0;
    for (const r of rows) {
      const rowPnl = Number(r.exited && r.booked_pnl != null ? r.booked_pnl : r.pnl) || 0;
      if (r.exited) {
        exitedCount += 1;
        exitedPnl += rowPnl;
      } else {
        openCount += 1;
        openPnl += rowPnl;
      }
      // Live book greeks only from open legs; Today P&L includes exits.
      if (!r.exited) {
        if (r.delta != null && Number.isFinite(r.delta)) netDelta += r.delta * r.quantity;
        if (r.theta != null && Number.isFinite(r.theta)) netTheta += r.theta * r.quantity;
      }
      if (!r.exited && r.isShort && r.isOpt) {
        shortCount += 1;
        if (r.breachedAdjust) adjustCount += 1;
      }
      if (!r.exited && r.extrinsicLeft != null && r.isShort) {
        premiumLeft += r.extrinsicLeft;
        premiumLeftN += 1;
      }
      if (!r.exited && r.thetaToClose != null && r.isShort) {
        thetaToClose += r.thetaToClose;
        thetaToCloseN += 1;
      }
      if (!r.exited && r.dte != null) {
        const mins = r.dte * 24 * 60;
        if (minMinutes == null || mins < minMinutes) minMinutes = mins;
      }
    }
    if (pnlToday && typeof pnlToday === "object") {
      if (pnlToday.open != null) openPnl = Number(pnlToday.open) || openPnl;
      if (pnlToday.exited != null) exitedPnl = Number(pnlToday.exited) || exitedPnl;
      netPnl = pnlToday.total != null ? (Number(pnlToday.total) || openPnl + exitedPnl) : openPnl + exitedPnl;
    } else {
      netPnl = openPnl + exitedPnl;
    }
    return {
      netDelta,
      netTheta,
      netPnl,
      openPnl,
      exitedPnl,
      minMinutes,
      premiumLeft: premiumLeftN ? premiumLeft : null,
      thetaToClose: thetaToCloseN ? thetaToClose : null,
      shortCount,
      adjustCount,
      openCount,
      exitedCount,
    };
  }, [rows, pnlToday]);

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
      if (!r.exited && r.isShort && r.isOpt && r.strike != null && r.side) {
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
      .filter((r) => !r.exited && r.isShort && r.isOpt && r.extrinsicLeft != null && r.extrinsicLeft > 0)
      .sort((a, b) => (b.extrinsicLeft || 0) - (a.extrinsicLeft || 0))
      .slice(0, 4);
  }, [rows]);

  const assignmentWatch = useMemo(() => {
    return computeAssignmentWatch(rows.filter((r) => !r.exited), {
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
    return computeExpiryDayClock(rows.filter((r) => !r.exited), nowTick);
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
    { key: "bookVerdict", label: "Book score" },
    { key: "sellIdeas", label: "What to sell" },
    { key: "decayBook", label: "Still decaying" },
    { key: "expiryDayMode", label: "Expiry day" },
    { key: "deltaHedge", label: "Flatten tilt" },
    { key: "assignmentWatch", label: "Exercise risk" },
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
          <div className="text-sm font-semibold text-slate-900">Kite Positions</div>
          <span className="text-[10px] font-mono-data bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-sm" title="Open legs">
            {stats.openCount} open
          </span>
          {stats.exitedCount > 0 && (
            <span className="text-[10px] font-mono-data bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded-sm border border-slate-200" title="Squared off today">
              {stats.exitedCount} exited
            </span>
          )}
          <InfoTip title="Positions · seller guide" testId="positions-guide-tip">
            {POSITIONS_GUIDE}
          </InfoTip>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <label title="How early to warn when market nears a sold strike">Warn @</label>
            <input
              type="number"
              min={30} max={95} step={5}
              value={adjustThreshPct}
              onChange={(e) => setAdjustThreshPct(Number(e.target.value))}
              className="w-12 h-7 px-1 text-xs border border-slate-200 rounded-sm font-mono-data bg-white"
              data-testid="adjust-threshold"
            />
            <span>% close</span>
            <InfoTip title="When do we say “Too close”?" testId="adjust-threshold-tip">
              <p>
                Imagine a buffer of about <b>3%</b> from your sold strike toward the market.
                When the market has eaten this much of that buffer (default <b>60%</b>), the row
                flips to <b>Too close</b>. Raise the % for fewer warnings; lower it for earlier ones.
              </p>
            </InfoTip>
          </div>
          <div
            className="inline-flex items-center gap-1 h-7 px-2 rounded-sm border border-slate-200 bg-slate-50 text-[11px] text-slate-600"
            data-testid="positions-brokerage-day"
            title={
              brokerage?.error ||
              (brokerage?.charges_total != null
                ? `Brokerage ₹ ${fmt(brokerage.brokerage, 0)} · all charges ₹ ${fmt(brokerage.charges_total, 0)}`
                : "Today’s trading fees from Zerodha (read-only)")
            }
          >
            <span className="text-slate-400">Fees</span>
            <span className="font-mono-data font-semibold text-slate-800">
              {brokerage?.brokerage != null ? `₹${fmt(brokerage.brokerage, 0)}` : "—"}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-sm bg-white min-h-[28px] text-orange-700 border-orange-200 hover:bg-orange-50 px-2"
            onClick={() => setAnalyzeOpen(true)}
            disabled={!rows.length}
            data-testid="btn-analyze-positions"
          >
            <LineChart className="w-3.5 h-3.5 mr-1" />
            Analyze
          </Button>
          <Button size="sm" variant="outline" className="h-7 rounded-sm bg-white min-h-[28px] px-2" onClick={() => { load(); loadBrokerage(); }} disabled={loading} data-testid="btn-refresh-positions">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
            {!isMarketQuiescent() && (
              <span className="ml-1 font-mono-data text-[10px] text-slate-500" data-testid="positions-refresh-countdown">
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
          label="Today P&L"
          value={"₹ " + fmt(stats.netPnl)}
          tone={stats.netPnl >= 0 ? "emerald" : "rose"}
          hint={
            stats.exitedCount > 0
              ? `Open ₹ ${fmt(stats.openPnl, 0)} · Exited ₹ ${fmt(stats.exitedPnl, 0)}`
              : brokerage?.charges_total != null
                ? `After fees ₹ ${fmt(stats.netPnl - brokerage.charges_total, 0)}`
                : "Open + booked exits"
          }
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Today P&amp;L</b> = open positions + same-day <b>exited</b> booked P&amp;L
                (Kite-style — exited legs stay in the list until end of day).
              </p>
              <p>
                Open: ₹ {fmt(stats.openPnl, 0)} · Exited: ₹ {fmt(stats.exitedPnl, 0)}
                {brokerage?.charges_total != null
                  ? ` · Fees today ₹ ${fmt(brokerage.charges_total, 0)}`
                  : ""}
              </p>
            </div>
          )}
        />
        <StatBox
          label="Cash left"
          value={funds?.net != null ? "₹ " + fmt(funds.net, 0) : "—"}
          tone="slate"
          hint={funds?.utilised_debits != null ? `Blocked ₹ ${fmt(funds.utilised_debits, 0)}` : "Free to trade"}
          tip={(
            <div className="space-y-1.5">
              <p>Money still free in Kite for new trades (read-only).</p>
              <p>
                Cash: {funds?.cash != null ? `₹ ${fmt(funds.cash, 0)}` : "—"}.
                Collateral: {funds?.collateral != null ? `₹ ${fmt(funds.collateral, 0)}` : "—"}.
              </p>
            </div>
          )}
        />
        <StatBox
          label="Daily time money"
          value={"₹ " + fmt(stats.netTheta, 0)}
          tone={stats.netTheta >= 0 ? "emerald" : "rose"}
          hint={stats.netTheta >= 0 ? "Time is paying you" : "Time is costing you"}
          tip={(
            <p>
              Rough ₹ you earn (or pay) each day just because time passes — if the market stays away
              from your sold strikes. Sellers usually want this green / positive.
            </p>
          )}
        />
        <StatBox
          label="Direction tilt"
          value={fmt(stats.netDelta, 1)}
          tone={Math.abs(stats.netDelta) < 10 ? "emerald" : Math.abs(stats.netDelta) < 30 ? "amber" : "rose"}
          hint={Math.abs(stats.netDelta) < 10 ? "Balanced · good" : "Leaning one way · flatten?"}
          tip={(
            <p>
              Are you accidentally betting the market goes up (positive) or down (negative)?
              Sellers usually want this near <b>0</b> (balanced). Far from 0 → hedge before selling more.
            </p>
          )}
        />
        <StatBox
          label="Still to earn"
          value={stats.premiumLeft != null ? "₹ " + fmt(stats.premiumLeft, 0) : "—"}
          tone="slate"
          hint="Left on sold options"
          tip={(
            <p>
              Premium still sitting in your sold options. If the market stays away until expiry /
              close, much of this can decay into your pocket. Estimate only — not guaranteed.
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
            Sold options <b>{stats.shortCount}</b>
            {stats.adjustCount > 0 ? (
              <span className="text-rose-700"> · {stats.adjustCount} too close — check them</span>
            ) : (
              <span className="text-emerald-700"> · all OK (market still away)</span>
            )}
          </span>
          {stats.thetaToClose != null && (
            <span title="Rough money time can still give you by today’s close">
              By close today ≈ <b className="font-mono-data text-emerald-800">₹ {fmt(stats.thetaToClose, 0)}</b>
            </span>
          )}
          {funds?.net != null && (
            <span title="Free cash in Kite">
              Cash left <b className="font-mono-data">₹ {fmt(funds.net, 0)}</b>
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
          Helpful tips (on / off)
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
                  Warnings tighter after 1pm
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
                <b className="font-mono-data">{positionLabel(w)}</b>
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
          <div className="text-center py-6 text-slate-400 text-xs border border-slate-100 rounded-md">No F&amp;O positions today.</div>
        ) : rows.map((r) => {
          const thetaInr = !r.exited && Number.isFinite(r.theta) ? r.theta * r.quantity : null;
          return (
            <div
              key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
              data-testid="position-card"
              data-exited={r.exited ? "1" : "0"}
              className={`rounded-md border px-3 py-2.5 ${
                r.exited
                  ? "border-slate-200/80 bg-slate-100/70 text-slate-500 shadow-none"
                  : r.breachedAdjust
                    ? "border-rose-300 bg-rose-50/80"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className={`flex items-start justify-between gap-2 ${r.exited ? "opacity-70" : ""}`}>
                <div className="min-w-0">
                  <div className={`text-sm font-semibold truncate ${r.exited ? "text-slate-500" : "text-slate-900"}`}>
                    {positionLabel(r)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {r.product} · {r.exchange}
                    {r.exited ? " · booked today" : ""}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <GreeksHealthChip health={r.greeksHealth} />
                  <StatusChip breached={r.breachedAdjust} isShortOpt={!r.exited && r.isShort && r.isOpt} exited={r.exited} />
                </div>
              </div>
              <div className={`mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono-data ${r.exited ? "opacity-75" : ""}`}>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Qty</div>
                  <div className={r.exited ? "text-slate-400 font-semibold" : r.isShort ? "text-rose-600 font-semibold" : "text-sky-700 font-semibold"}>
                    {r.exited ? 0 : r.quantity}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Avg</div>
                  <div><AvgCell row={r} /></div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">P&amp;L</div>
                  <div className={`font-semibold ${r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-90" : ""}`}>
                    {r.pnl >= 0 ? "+" : ""}{fmt(r.pnl, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">LTP</div>
                  <div>{fmt(r.last_price)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">₹/day</div>
                  <div className={thetaInr == null ? "" : thetaInr >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                    {thetaInr != null ? fmt(thetaInr, 0) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">ATM dist</div>
                  <div><AtmDistanceCell row={r} /></div>
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
              <th className="text-left px-2 py-2">Instrument</th>
              <th className="text-right px-2 py-2">Qty</th>
              <th className="text-right px-2 py-2">Avg</th>
              <th className="text-right px-2 py-2">LTP</th>
              <th className="text-right px-2 py-2">P&amp;L</th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Tilt
                  <InfoTip title="Direction tilt" size="xs" testId="delta-col-tip">
                    Does this leg push you to bet up or down? Near 0 is calmer for sellers.
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  ₹/day
                  <InfoTip title="Daily time money" size="xs" testId="theta-col-tip">
                    Rough ₹ this leg earns or costs each day as time passes. Sold options usually earn.
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Still earn
                  <InfoTip title="Still to earn" size="xs" testId="prem-left-col-tip">
                    Premium left on a sold option that can still decay into your pocket if the market stays away.
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">IV</th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Days left
                  <InfoTip title="Days left" size="xs" testId="dte-col-tip">
                    How many days until this option expires (rough).
                  </InfoTip>
                </span>
              </th>
              <th className="text-left px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  Status
                  <InfoTip title="OK vs Too close" size="xs" testId="signal-col-tip">
                    <p><b>OK</b> — market still away from your sold strike. Hold for now.</p>
                    <p className="mt-1"><b>Too close</b> — market walked near that strike. Hedge, roll, or exit.</p>
                  </InfoTip>
                </span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  ATM Dist
                  <InfoTip title="ATM Distance" size="xs" testId="atm-dist-col-tip">
                    <p>
                      How far the market (ATM) is from <b>this strike</b>.
                    </p>
                    <p className="mt-1">
                      <b>+</b> means your strike is above ATM · <b>−</b> means below.
                      Green on sold options usually means you are still out-of-the-money.
                    </p>
                  </InfoTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-6 text-slate-400 text-xs bg-white">No F&amp;O positions today.</td></tr>
            ) : rows.map((r) => {
              const thetaInr = !r.exited && Number.isFinite(r.theta) ? r.theta * r.quantity : null;
              return (
              <tr
                key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
                data-testid="position-row"
                data-exited={r.exited ? "1" : "0"}
                className={`border-b border-slate-100 ${
                  r.exited
                    ? "bg-slate-100/80 text-slate-500"
                    : r.breachedAdjust
                      ? "bg-rose-50/80"
                      : "bg-white"
                }`}
              >
                <td className={`px-2 py-1.5 ${r.exited ? "opacity-75" : ""}`}>
                  <div className={`font-semibold tracking-tight ${r.exited ? "text-slate-500" : "text-slate-900"}`}>
                    {positionLabel(r)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {r.product} · {r.exchange}
                    {r.exited ? " · booked today" : ""}
                  </div>
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "text-slate-400 opacity-75" : r.isShort ? "text-rose-600" : "text-sky-700"}`}>
                  {r.exited ? 0 : r.quantity}
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-75" : ""}`}>
                  <AvgCell row={r} />
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-75" : ""}`}>{fmt(r.last_price)}</td>
                <td className={`text-right px-2 py-1.5 font-semibold ${r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-90" : ""}`}>
                  {r.pnl >= 0 ? "+" : ""}{fmt(r.pnl, 0)}
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-60" : ""}`}>{Number.isFinite(r.delta) ? r.delta.toFixed(2) : "—"}</td>
                <td className={`text-right px-2 py-1.5 font-semibold ${thetaInr == null ? "" : thetaInr >= 0 ? "text-emerald-700" : "text-rose-700"} ${r.exited ? "opacity-60" : ""}`}>
                  {thetaInr != null ? fmt(thetaInr, 0) : "—"}
                </td>
                <td className={`text-right px-2 py-1.5 text-slate-700 ${r.exited ? "opacity-60" : ""}`}>
                  {!r.exited && r.isShort && r.extrinsicLeft != null ? (
                    <span title={r.onExpiryDay ? "Expiry day — extrinsic left to 15:30" : "Extrinsic left"}>
                      ₹{fmt(r.extrinsicLeft, 0)}
                    </span>
                  ) : "—"}
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-60" : ""}`}>{Number.isFinite(r.iv) ? r.iv.toFixed(1) + "%" : "—"}</td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-60" : ""}`}>{r.dte != null ? r.dte.toFixed(1) + "d" : "—"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <GreeksHealthChip health={r.greeksHealth} />
                    <StatusChip breached={r.breachedAdjust} isShortOpt={!r.exited && r.isShort && r.isOpt} exited={r.exited} />
                    {!r.exited && !r.breachedAdjust && !(r.isShort && r.isOpt) && (!r.greeksHealth || r.greeksHealth === "ok") ? "—" : null}
                  </div>
                </td>
                <td className={`text-right px-2 py-1.5 ${r.exited ? "opacity-60" : ""}`}>
                  <AtmDistanceCell row={r} />
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
  const label = health === "no_spot" ? "no price" : "can't price";
  return (
    <span
      data-testid={`greeks-health-${health}`}
      title={
        health === "no_spot"
          ? "We don't have this index's live price yet — numbers skipped"
          : "Couldn't calculate option numbers for this row (price / expiry)"
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
