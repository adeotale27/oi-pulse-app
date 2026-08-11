import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  RefreshCw,
  PlugZap,
  AlertTriangle,
  Building2,
  Zap,
  ShieldAlert,
  Crosshair,
  Pin,
  LineChart,
  Columns3,
  ChevronDown,
  ChevronUp,
  Receipt,
} from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  yearsToExpiry,
  greeks,
  impliedVol,
  shortPremiumLeft,
  extrinsicPremium,
  dailyThetaRupees,
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
import {
  POSITIONS_COLUMN_DEFS,
  loadColumnVisibility,
  saveColumnVisibility,
  visibleColumnIds,
} from "@/lib/positionsColumns";
import { resolvePositionSpot, positionExpiryISO } from "@/lib/positionPayoff";
import OvernightRiskScore from "@/components/OvernightRiskScore";
import PositionsAnalyzeModal from "@/components/PositionsAnalyzeModal";
import InfoTip from "@/components/InfoTip";

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Prefer live/cash for "cash left"; net can be deeply negative under F&O span. */
function freeCashValue(funds) {
  if (!funds) return null;
  if (funds.live_balance != null) return Number(funds.live_balance);
  if (funds.cash != null) return Number(funds.cash);
  if (funds.net != null) return Number(funds.net);
  return null;
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
      <b> Daily time money (Θ ₹/day)</b> — rough ₹ from time passing, capped to premium left (not your P&amp;L).
    </p>
    <p>
      <b>Still to earn</b> — leftover premium on sold options that can still decay into your pocket.
      <b> Profit booked today</b> — realised P&amp;L from same-day exits (and partial closes).
      <b> Day charges</b> — brokerage + STT + GST + exchange fees (Zerodha contract note, read-only).
    </p>
  </div>
);

function ExitedChip() {
  return (
    <span
      title="Squared off today — booked P&L stays in Today’s total until end of day"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-slate-200/80 bg-slate-100/80 text-slate-400 text-[10px] font-semibold tracking-wide"
      data-testid="status-exited"
    >
      Closed
    </span>
  );
}

/** Zerodha-style product badge — muted when exited. */
function ProductBadge({ product, exited }) {
  const p = String(product || "—").toUpperCase();
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold tracking-wide ${
        exited
          ? "bg-slate-100 text-slate-400 border border-slate-200/60"
          : "bg-violet-100 text-violet-700 border border-violet-200/70"
      }`}
      data-testid="product-badge"
    >
      {p}
    </span>
  );
}

/** Professional symbol: NIFTY 11TH AUG 24800 CE */
function positionLabel(r) {
  return r?.display_name || r?.tradingsymbol || "—";
}

function AvgCell({ row }) {
  if (row?.exited) {
    // Kite shows 0.00 average on flat / squared-off rows.
    return <span className="text-slate-400">0.00</span>;
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
  onOpenKite,
  hasKiteCredentials = null,
}) {
  const [positions, setPositions] = useState([]);
  const [spotByIndex, setSpotByIndex] = useState({});
  const [oiByIndex, setOiByIndex] = useState({});
  const [funds, setFunds] = useState(null);
  const [pnlToday, setPnlToday] = useState(null);
  const [brokerage, setBrokerage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorHard, setErrorHard] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [stickyKite, setStickyKite] = useState(!!isKiteMode);
  const brokerageGen = useRef(0);
  const [adjustThreshPct, setAdjustThreshPct] = useState(60);
  const [toggles, setToggles] = useState(() => loadPositionsToggles());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [secsLeft, setSecsLeft] = useState(() => Math.max(1, Math.round(positionsPollMs / 1000)));
  const [colVis, setColVis] = useState(() => loadColumnVisibility());
  const [colsOpen, setColsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(() => {
    try {
      return localStorage.getItem("oiPositionsInsightsOpen") === "1";
    } catch {
      return false;
    }
  });
  const colsMenuRef = useRef(null);
  const pollMs = Math.max(5000, Number(positionsPollMs) || 30000);
  const loadGen = useRef(0);

  const setInsights = useCallback((open) => {
    setInsightsOpen(open);
    try {
      localStorage.setItem("oiPositionsInsightsOpen", open ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const setToggle = useCallback((key, on) => {
    setToggles((prev) => {
      const next = { ...prev, [key]: !!on };
      savePositionsToggles(next);
      return next;
    });
  }, []);

  const setCol = useCallback((id, on) => {
    setColVis((prev) => {
      const def = POSITIONS_COLUMN_DEFS.find((c) => c.id === id);
      if (def?.required) return prev;
      const next = { ...prev, [id]: !!on };
      saveColumnVisibility(next);
      return next;
    });
  }, []);

  const shownCols = useMemo(() => visibleColumnIds(colVis), [colVis]);
  const colOn = useCallback((id) => shownCols.includes(id), [shownCols]);

  useEffect(() => {
    if (!colsOpen) return undefined;
    const onDoc = (e) => {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target)) {
        setColsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colsOpen]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const loadBrokerage = useCallback(async () => {
    const gen = ++brokerageGen.current;
    try {
      const { data } = await api.get("/positions/brokerage-day");
      if (gen !== brokerageGen.current) return;
      if (!data) return;
      // Keep last good totals on soft failures (Charges API blip).
      if (data.ok === false && data.charges_total == null) {
        setBrokerage((prev) => {
          if (!prev || prev.charges_total == null) return data;
          return {
            ...prev,
            error: data.error || prev.error,
            warning: data.warning || prev.warning,
            book: data.book || prev.book,
          };
        });
        return;
      }
      setBrokerage(data);
    } catch {
      /* keep last good charges — do not wipe the chip to "—" */
    }
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    try {
      const { data } = await api.get("/positions");
      if (gen !== loadGen.current) return;
      const next = data.positions || [];
      const hard =
        data.token_issue === true
        || data.kite_connected === false
        || /not connected|connect kite|tokenexception|invalid token|api_key|unauthorized|forbidden/i.test(
          String(data.error || ""),
        );
      const maintenance =
        data.maintenance === true
        || /zerodha maintenance|under maintenance|scheduled maintenance/i.test(String(data.error || ""));
      // Keep last good book on transient Kite blips — do not wipe the table.
      if (next.length > 0 || !data.error || hard) {
        setPositions(next);
        if (hard && (data.kite_connected === false || data.token_issue === true)) {
          setFunds(data.funds ?? null);
          setPnlToday(data.pnl_today ?? null);
        } else {
          if (data.funds) setFunds(data.funds);
          if (data.pnl_today) setPnlToday(data.pnl_today);
        }
        if (data.spot && typeof data.spot === "object") setSpotByIndex(data.spot);
        if (data.oi && typeof data.oi === "object") setOiByIndex(data.oi);
      }
      if (data.error) {
        setError(data.error);
        // Soft only when API explicitly marks transient; never treat missing flag as hard.
        setErrorHard(hard && !maintenance);
      } else {
        setError(null);
        setErrorHard(false);
      }
      setLastRefresh(new Date().toISOString());
      setSecsLeft(Math.max(1, Math.round(pollMs / 1000)));
    } catch (e) {
      if (gen !== loadGen.current) return;
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e.message;
      setError(detail);
      setErrorHard(status === 401 || status === 403);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [pollMs]);

  useEffect(() => {
    if (isKiteMode) {
      setStickyKite(true);
      return;
    }
    // Sign-out: credentials gone → stop sticky polling as if still live.
    // Keep sticky only while credentials may still exist (brief mode flaps).
    if (hasKiteCredentials === false) {
      setStickyKite(false);
    }
  }, [isKiteMode, hasKiteCredentials]);

  const kiteReady = isKiteMode || stickyKite;

  useEffect(() => {
    if (!kiteReady) return undefined;
    const closed = isMarketQuiescent();
    load();
    loadBrokerage();
    if (closed) return undefined;
    const id = setInterval(() => {
      load();
    }, pollMs);
    // Charges change with fills — refresh less often than the live book.
    const chargesId = setInterval(() => {
      loadBrokerage();
    }, Math.max(pollMs * 4, 120_000));
    return () => {
      clearInterval(id);
      clearInterval(chargesId);
    };
  }, [kiteReady, load, loadBrokerage, pollMs]);

  useEffect(() => {
    if (!kiteReady || isMarketQuiescent()) return;
    setSecsLeft(Math.max(1, Math.round(pollMs / 1000)));
    const id = setInterval(() => {
      setSecsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [kiteReady, pollMs, lastRefresh]);

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
                T,
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
      // Desk-safe ₹/day — never show BS θ blow-ups larger than premium left.
      const thetaInr = exited
        ? null
        : dailyThetaRupees({
            thetaPerUnit: theta,
            quantity: p.quantity,
            marketPrice: Number(p.last_price || p.average_price),
            S,
            K: p.strike,
            isCall: p.side === "CE",
            T,
          });
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
        thetaInr,
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
    let bookedToday = 0;
    for (const r of rows) {
      const rowPnl = (() => {
        const raw = r.exited && r.booked_pnl != null ? r.booked_pnl : r.pnl;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      })();
      if (r.exited) {
        exitedCount += 1;
        exitedPnl += rowPnl;
        bookedToday += rowPnl;
      } else {
        openCount += 1;
        openPnl += rowPnl;
        const realised = Number(r.realised);
        if (Number.isFinite(realised) && Math.abs(realised) > 1e-9) {
          bookedToday += realised;
        }
      }
      // Live book greeks only from open legs; Today P&L includes exits.
      if (!r.exited) {
        if (r.delta != null && Number.isFinite(r.delta)) netDelta += r.delta * r.quantity;
        if (r.thetaInr != null && Number.isFinite(r.thetaInr)) netTheta += r.thetaInr;
        else if (r.theta != null && Number.isFinite(r.theta)) netTheta += r.theta * r.quantity;
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
      const openN = Number(pnlToday.open);
      const exitedN = Number(pnlToday.exited);
      const totalN = Number(pnlToday.total);
      // Prefer server totals; never use `x || fallback` (0 is a valid P&L).
      if (Number.isFinite(openN)) openPnl = openN;
      if (Number.isFinite(exitedN)) {
        exitedPnl = exitedN;
        // Server exited total is the clean booked figure when present.
        bookedToday = exitedN;
        for (const r of rows) {
          if (r.exited) continue;
          const realised = Number(r.realised);
          if (Number.isFinite(realised) && Math.abs(realised) > 1e-9) {
            bookedToday += realised;
          }
        }
      }
      netPnl = Number.isFinite(totalN) ? totalN : openPnl + exitedPnl;
    } else {
      netPnl = openPnl + exitedPnl;
    }
    return {
      netDelta,
      netTheta,
      netPnl,
      openPnl,
      exitedPnl,
      bookedToday,
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

  if (!kiteReady) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center" data-testid="positions-kite-required">
        <PlugZap className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <div className="text-sm font-semibold text-slate-700">Kite Live mode required</div>
        <div className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Connect Zerodha Kite to pull your open F&amp;O positions here.
        </div>
        {typeof onOpenKite === "function" && (
          <Button
            size="sm"
            className="mt-3 h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700"
            onClick={onOpenKite}
            data-testid="btn-positions-reconnect-kite"
          >
            <PlugZap className="w-3.5 h-3.5 mr-1.5" />
            Connect Kite
          </Button>
        )}
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
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-sm border border-slate-200 bg-white text-[11px] text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900 transition-colors"
                data-testid="positions-brokerage-day"
                title="Today’s trading charges — click for breakdown"
              >
                <Receipt className="w-3 h-3 text-slate-400" />
                <span className="text-slate-400">Charges</span>
                <span className="font-mono-data font-semibold text-slate-800">
                  {brokerage?.charges_total != null
                    ? `₹${fmt(brokerage.charges_total, 0)}`
                    : brokerage?.brokerage != null
                      ? `₹${fmt(brokerage.brokerage, 0)}`
                      : "—"}
                </span>
                {brokerage?.book?.open_today > 0 ? (
                  <span className="text-[9px] text-amber-700 font-semibold" title="Open / pending orders today">
                    · {brokerage.book.open_today} open
                  </span>
                ) : null}
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-0"
              data-testid="positions-charges-breakdown"
            >
              <div className="border-b border-slate-100 px-3 py-2.5">
                <div className="text-xs font-semibold text-slate-900">Day charges</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Zerodha virtual contract note ·{" "}
                  {brokerage?.order_count != null
                    ? `${brokerage.order_count} fill${brokerage.order_count === 1 ? "" : "s"}`
                    : "today"}
                  {brokerage?.book?.source ? ` · via ${brokerage.book.source}` : ""}
                </div>
              </div>
              {brokerage?.error ? (
                <div className="px-3 py-3 text-[11px] text-rose-700">{brokerage.error}</div>
              ) : (
                <div className="px-3 py-2 space-y-1.5">
                  {brokerage?.warning ? (
                    <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-sm px-2 py-1">
                      {brokerage.warning}
                    </div>
                  ) : null}
                  {brokerage?.note && !(brokerage?.charges_total > 0) ? (
                    <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-sm px-2 py-1.5">
                      {brokerage.note}
                      {brokerage?.book?.trades_fetched != null ? (
                        <span className="block mt-0.5 font-mono-data text-slate-400">
                          trades {brokerage.book.trades_fetched} · orders {brokerage.book.orders_fetched ?? "—"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {(brokerage?.breakdown || []).map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center justify-between gap-3 text-[12px]"
                      data-testid={`charge-row-${row.key}`}
                    >
                      <span className="text-slate-500">{row.label}</span>
                      <span className="font-mono-data font-medium text-slate-800">
                        ₹{fmt(row.amount, 2)}
                      </span>
                    </div>
                  ))}
                  {(!brokerage?.breakdown || brokerage.breakdown.length === 0) && (
                    <div className="text-[11px] text-slate-400 py-2">
                      {brokerage?.charges_total == null
                        ? "Charges not available yet."
                        : "No charge lines returned."}
                    </div>
                  )}
                  {brokerage?.gst && (brokerage.gst.igst || brokerage.gst.cgst || brokerage.gst.sgst) ? (
                    <div className="rounded-sm bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 space-y-0.5">
                      <div className="font-semibold uppercase tracking-wider text-slate-400">GST detail</div>
                      {brokerage.gst.igst ? (
                        <div className="flex justify-between"><span>IGST</span><span className="font-mono-data">₹{fmt(brokerage.gst.igst, 2)}</span></div>
                      ) : null}
                      {brokerage.gst.cgst ? (
                        <div className="flex justify-between"><span>CGST</span><span className="font-mono-data">₹{fmt(brokerage.gst.cgst, 2)}</span></div>
                      ) : null}
                      {brokerage.gst.sgst ? (
                        <div className="flex justify-between"><span>SGST</span><span className="font-mono-data">₹{fmt(brokerage.gst.sgst, 2)}</span></div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
              <div className="border-t border-slate-100 px-3 py-2.5 flex items-center justify-between bg-slate-50/80">
                <span className="text-xs font-semibold text-slate-700">Total today</span>
                <span className="font-mono-data text-sm font-bold text-slate-900" data-testid="charges-total">
                  {brokerage?.charges_total != null ? `₹${fmt(brokerage.charges_total, 2)}` : "—"}
                </span>
              </div>
            </PopoverContent>
          </Popover>
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
          <div className="relative" ref={colsMenuRef}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-sm bg-white min-h-[28px] px-2"
              onClick={() => setColsOpen((v) => !v)}
              data-testid="btn-positions-columns"
              title="Show / hide columns"
            >
              <Columns3 className="w-3.5 h-3.5 mr-1" />
              Columns
              {colsOpen ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
            {colsOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-40 w-52 rounded-md border border-slate-200 bg-white shadow-lg p-2"
                data-testid="positions-columns-menu"
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-400 px-1.5 pb-1.5">
                  Table columns
                </div>
                <div className="max-h-64 overflow-auto space-y-0.5">
                  {POSITIONS_COLUMN_DEFS.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-sm text-[11px] ${
                        c.required
                          ? "text-slate-400 cursor-default"
                          : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600"
                        checked={c.required || colVis[c.id] !== false}
                        disabled={!!c.required}
                        onChange={(e) => setCol(c.id, e.target.checked)}
                        data-testid={`col-toggle-${c.id}`}
                      />
                      {c.label}
                      {c.required ? <span className="text-[9px] text-slate-400">always</span> : null}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
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
        <div
          className={`rounded-md border px-3 py-2 text-xs flex flex-wrap items-center gap-2 ${
            errorHard
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
          data-testid="positions-error"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">
            {errorHard
              ? error
              : /zerodha maintenance|under maintenance/i.test(String(error || ""))
                ? error
                : `Temporary Kite hiccup — keeping last book. ${error}`}
          </span>
          {errorHard && typeof onOpenKite === "function" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-sm border-rose-300 bg-white text-rose-800 hover:bg-rose-100"
              onClick={onOpenKite}
              data-testid="btn-positions-error-reconnect"
            >
              <PlugZap className="w-3.5 h-3.5 mr-1" />
              Reconnect
            </Button>
          )}
          {!errorHard && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-sm border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              onClick={() => { load(); loadBrokerage(); }}
              data-testid="btn-positions-error-retry"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Retry
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-2">
        <StatBox
          label="Today P&L"
          value={"₹ " + fmt(stats.netPnl)}
          tone={stats.netPnl >= 0 ? "emerald" : "rose"}
          hint={
            stats.exitedCount > 0
              ? `Open ₹ ${fmt(stats.openPnl, 0)} · Exited ₹ ${fmt(stats.exitedPnl, 0)}`
              : brokerage?.charges_total != null && Number(brokerage.charges_total) > 0
                ? `After charges ₹ ${fmt(stats.netPnl - Number(brokerage.charges_total), 2)}`
                : brokerage?.charges_total === 0
                  ? "No day charges yet"
                  : brokerage?.error
                    ? "Charges temporarily unavailable"
                    : "Open + booked exits"
          }
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Today P&amp;L</b> = open positions + same-day <b>exited</b> booked P&amp;L
                (exited legs stay in the list until end of day).
              </p>
              <p>
                Open: ₹ {fmt(stats.openPnl, 0)} · Exited: ₹ {fmt(stats.exitedPnl, 0)}
                {brokerage?.charges_total != null
                  ? ` · Day charges ₹ ${fmt(brokerage.charges_total, 0)}`
                  : ""}
              </p>
            </div>
          )}
        />
        <StatBox
          label="Cash left"
          value={(() => {
            const v = freeCashValue(funds);
            return v != null ? "₹ " + fmt(v, 0) : "—";
          })()}
          tone={
            freeCashValue(funds) != null && freeCashValue(funds) < 0
              ? "rose"
              : "slate"
          }
          hint={
            funds?.utilised_debits != null
              ? `Blocked ₹ ${fmt(funds.utilised_debits, 0)}`
              : funds?.net != null && funds?.live_balance != null && funds.net !== funds.live_balance
                ? `Net avail ₹ ${fmt(funds.net, 0)}`
                : "Free to trade"
          }
          tip={(
            <div className="space-y-1.5">
              <p>Money Kite still shows as free for new trades (read-only margins).</p>
              <p>
                Live: {funds?.live_balance != null ? `₹ ${fmt(funds.live_balance, 0)}` : "—"}.
                Cash: {funds?.cash != null ? `₹ ${fmt(funds.cash, 0)}` : "—"}.
                Net: {funds?.net != null ? `₹ ${fmt(funds.net, 0)}` : "—"}.
                Collateral: {funds?.collateral != null ? `₹ ${fmt(funds.collateral, 0)}` : "—"}.
              </p>
              <p className="text-[11px] opacity-80">
                Large negative <b>net</b> with big blocked margin is normal for a heavy short F&amp;O
                book — it is not a P&amp;L loss.
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
              Rough ₹ from time passing if the market stays put — capped to premium still left in
              each option (so expiry-day Black–Scholes cannot show fake −₹10k on a ₹500 long).
              This is <b>not</b> your P&amp;L; P&amp;L matches Kite in the P&amp;L column.
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
        <StatBox
          label="Profit booked today"
          value={"₹ " + fmt(stats.bookedToday)}
          tone={stats.bookedToday >= 0 ? "emerald" : "rose"}
          hint={
            stats.exitedCount > 0
              ? `${stats.exitedCount} exited · realised`
              : "No exits booked yet"
          }
          tip={(
            <p>
              Realised money locked in today from <b>squared-off</b> legs (plus any partial
              closes still showing as open). Separate from Still to earn, which is premium not
              yet decayed.
            </p>
          )}
        />
        <OvernightRiskScore
          vix={vix}
          netDelta={stats.netDelta}
          positionsCount={stats.openCount}
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
          {freeCashValue(funds) != null && (
            <span title="Free cash in Kite (live/cash preferred over net)">
              Cash left <b className="font-mono-data">₹ {fmt(freeCashValue(funds), 0)}</b>
            </span>
          )}
        </div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2" data-testid="positions-mobile-cards">
        {rows.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs border border-slate-100 rounded-md">No F&amp;O positions today.</div>
        ) : rows.map((r) => {
          const thetaInr = !r.exited && Number.isFinite(r.thetaInr) ? r.thetaInr : null;
          return (
            <div
              key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
              data-testid="position-card"
              data-exited={r.exited ? "1" : "0"}
              className={`rounded-lg border px-3 py-2.5 transition-colors ${
                r.exited
                  ? "border-slate-200/70 bg-slate-100/80 text-slate-400 shadow-none opacity-[0.58]"
                  : r.breachedAdjust
                    ? "border-rose-300 bg-rose-50/80 shadow-sm"
                    : "border-slate-200/80 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <ProductBadge product={r.product} exited={r.exited} />
                    {r.exited ? (
                      <span className="text-[9px] uppercase tracking-wide text-slate-400">Squared off</span>
                    ) : null}
                  </div>
                  <div className={`text-base font-semibold truncate ${r.exited ? "text-slate-400" : "text-slate-900"}`}>
                    {positionLabel(r)}
                  </div>
                  <div className={`text-xs ${r.exited ? "text-slate-300" : "text-slate-400"}`}>
                    {r.exchange}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <GreeksHealthChip health={r.greeksHealth} />
                  <StatusChip breached={r.breachedAdjust} isShortOpt={!r.exited && r.isShort && r.isOpt} exited={r.exited} />
                </div>
              </div>
              <div className={`mt-2 grid grid-cols-3 gap-2 text-sm font-mono-data ${r.exited ? "text-slate-400" : ""}`}>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Qty</div>
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
                  <div className={`font-semibold ${r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-70" : ""}`}>
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
      <div className="hidden md:block overflow-auto rounded-lg border border-slate-200/80 shadow-sm bg-white">
        <table className="w-full text-sm font-mono-data">
          <thead className="bg-slate-50/90 text-slate-500 uppercase tracking-wider text-xs sticky top-0 z-10">
            <tr className="border-b border-slate-200/80">
              {colOn("product") && <th className="text-left px-2.5 py-3 font-semibold">Product</th>}
              {colOn("instrument") && <th className="text-left px-2.5 py-3 font-semibold">Instrument</th>}
              {colOn("qty") && <th className="text-right px-2.5 py-3 font-semibold">Qty</th>}
              {colOn("avg") && <th className="text-right px-2.5 py-3 font-semibold">Avg</th>}
              {colOn("ltp") && <th className="text-right px-2.5 py-3 font-semibold">LTP</th>}
              {colOn("pnl") && <th className="text-right px-2.5 py-3 font-semibold">P&amp;L</th>}
              {colOn("tilt") && (
                <th className="text-right px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Tilt
                    <InfoTip title="Direction tilt" size="xs" testId="delta-col-tip">
                      Does this leg push you to bet up or down? Near 0 is calmer for sellers.
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("theta") && (
                <th className="text-right px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    ₹/day
                    <InfoTip title="Daily time money (not P&L)" size="xs" testId="theta-col-tip">
                      Estimate of ₹ this leg earns or costs from time passing — capped to premium
                      left so expiry-day maths cannot invent huge fake losses. Your real P&amp;L is
                      the P&amp;L column (matches Kite).
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("stillEarn") && (
                <th className="text-right px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Still earn
                    <InfoTip title="Still to earn" size="xs" testId="prem-left-col-tip">
                      Premium left on a sold option that can still decay into your pocket if the market stays away.
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("iv") && <th className="text-right px-2.5 py-3 font-semibold">IV</th>}
              {colOn("dte") && (
                <th className="text-right px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Days left
                    <InfoTip title="Days left" size="xs" testId="dte-col-tip">
                      How many days until this option expires (rough).
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("status") && (
                <th className="text-left px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Status
                    <InfoTip title="OK vs Too close" size="xs" testId="signal-col-tip">
                      <p><b>OK</b> — market still away from your sold strike. Hold for now.</p>
                      <p className="mt-1"><b>Too close</b> — market walked near that strike. Hedge, roll, or exit.</p>
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("atmDist") && (
                <th className="text-right px-2.5 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    ATM Dist
                    <InfoTip title="ATM Distance" size="xs" testId="atm-dist-col-tip">
                      <p>How far the market (ATM) is from <b>this strike</b>.</p>
                      <p className="mt-1"><b>+</b> above ATM · <b>−</b> below. Green on sold options usually means still OTM.</p>
                    </InfoTip>
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(shownCols.length, 1)} className="text-center py-8 text-slate-400 text-xs bg-white">
                  No F&amp;O positions today.
                </td>
              </tr>
            ) : rows.map((r, idx) => {
              const thetaInr = !r.exited && Number.isFinite(r.thetaInr) ? r.thetaInr : null;
              const prev = rows[idx - 1];
              const showExitedDivider = r.exited && prev && !prev.exited;
              return (
              <Fragment key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}>
              {showExitedDivider && (
                <tr data-testid="exited-section-divider">
                  <td
                    colSpan={Math.max(shownCols.length, 1)}
                    className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50 border-y border-slate-100"
                  >
                    Exited today · Kite-style shadowed (qty 0)
                  </td>
                </tr>
              )}
              <tr
                data-testid="position-row"
                data-exited={r.exited ? "1" : "0"}
                className={`border-b border-slate-100/80 ${
                  r.exited
                    ? "bg-slate-100/70 text-slate-400 opacity-[0.58]"
                    : r.breachedAdjust
                      ? "bg-rose-50/70"
                      : idx % 2 === 0
                        ? "bg-white"
                        : "bg-slate-50/40"
                }`}
              >
                {colOn("product") && (
                  <td className="px-2 py-2">
                    <ProductBadge product={r.product} exited={r.exited} />
                  </td>
                )}
                {colOn("instrument") && (
                  <td className="px-2 py-2">
                    <div className={`font-semibold tracking-tight ${r.exited ? "text-slate-400" : "text-slate-900"}`}>
                      {positionLabel(r)}
                    </div>
                    <div className={`text-[10px] ${r.exited ? "text-slate-300" : "text-slate-400"}`}>
                      {r.exchange}
                      {r.exited ? " · exited" : ""}
                    </div>
                  </td>
                )}
                {colOn("qty") && (
                  <td className={`text-right px-2 py-2 font-semibold ${r.exited ? "text-slate-400" : r.isShort ? "text-rose-600" : "text-sky-700"}`}>
                    {r.exited ? 0 : r.quantity}
                  </td>
                )}
                {colOn("avg") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-400" : ""}`}>
                    <AvgCell row={r} />
                  </td>
                )}
                {colOn("ltp") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-400" : ""}`}>{fmt(r.last_price)}</td>
                )}
                {colOn("pnl") && (
                  <td className={`text-right px-2 py-2 font-semibold ${r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-80" : ""}`}>
                    {r.pnl >= 0 ? "+" : ""}{fmt(r.pnl, 0)}
                  </td>
                )}
                {colOn("tilt") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-300" : ""}`}>
                    {Number.isFinite(r.delta) ? r.delta.toFixed(2) : "—"}
                  </td>
                )}
                {colOn("theta") && (
                  <td className={`text-right px-2 py-2 font-semibold ${thetaInr == null ? (r.exited ? "text-slate-300" : "") : thetaInr >= 0 ? "text-emerald-700" : "text-rose-700"} ${r.exited ? "opacity-50" : ""}`}>
                    {thetaInr != null ? fmt(thetaInr, 0) : "—"}
                  </td>
                )}
                {colOn("stillEarn") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-300" : "text-slate-700"}`}>
                    {!r.exited && r.isShort && r.extrinsicLeft != null ? (
                      <span title={r.onExpiryDay ? "Expiry day — extrinsic left to 15:30" : "Extrinsic left"}>
                        ₹{fmt(r.extrinsicLeft, 0)}
                      </span>
                    ) : "—"}
                  </td>
                )}
                {colOn("iv") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-300" : ""}`}>
                    {Number.isFinite(r.iv) ? `${r.iv.toFixed(1)}%` : "—"}
                  </td>
                )}
                {colOn("dte") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-300" : ""}`}>
                    {r.dte != null ? `${r.dte.toFixed(1)}d` : "—"}
                  </td>
                )}
                {colOn("status") && (
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <GreeksHealthChip health={r.greeksHealth} />
                      <StatusChip breached={r.breachedAdjust} isShortOpt={!r.exited && r.isShort && r.isOpt} exited={r.exited} />
                      {!r.exited && !r.breachedAdjust && !(r.isShort && r.isOpt) && (!r.greeksHealth || r.greeksHealth === "ok") ? "—" : null}
                    </div>
                  </td>
                )}
                {colOn("atmDist") && (
                  <td className={`text-right px-2 py-2 ${r.exited ? "text-slate-300" : ""}`}>
                    {r.exited ? "—" : <AtmDistanceCell row={r} />}
                  </td>
                )}
              </tr>
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setInsights(!insightsOpen)}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-sm border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          data-testid="btn-positions-insights"
          aria-expanded={insightsOpen}
        >
          Insights
          {insightsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="text-[10px] font-normal text-slate-400">
            score · decay · hedge
          </span>
        </button>
      </div>

      {insightsOpen && (
        <div className="space-y-3 border-t border-slate-100 pt-3" data-testid="positions-insights-drawer">
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
                      {r.thetaInr != null && (
                        <span className="text-emerald-700"> · Θ ₹{fmt(r.thetaInr, 0)}/d</span>
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
