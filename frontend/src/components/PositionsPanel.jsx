import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import usePortaledMenu from "@/hooks/usePortaledMenu";
import OiPulseLogo from "@/components/OiPulseLogo";
import {
  RefreshCw,
  PlugZap,
  AlertTriangle,
  Zap,
  ShieldAlert,
  Crosshair,
  Pin,
  LineChart,
  Columns3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Receipt,
  Eye,
  EyeOff,
  BookOpen,
  Sparkles,
  X,
  GripHorizontal,
  GripVertical,
} from "lucide-react";
import { loadBookSlot, saveBookSlot } from "@/lib/positionsBookLayout";
import { api } from "@/lib/api";
import { istMinutesOfDay, getPositionsCatchupMinute, getMarketCloseHm, getMarketOpenMinute } from "@/lib/marketTimes";
import {
  todayIST,
  isJournalSessionDayIST,
  specialSessionOpenMinute,
  specialSessionCatchupMinute,
} from "@/lib/holidays";
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
  minutesToCloseIST,
} from "@/lib/blackScholes";
import { computeSellCandidates } from "@/lib/sellCandidates";
import { compactTopSells, summarizeIndexTape } from "@/lib/deskAiTape";
import {
  loadPositionsToggles,
  savePositionsToggles,
  computeBookVerdict,
  computeAssignmentWatch,
  computeDeltaHedgeSuggestions,
  computeExpiryDayClock,
  effectiveAdjustThreshold,
  nearestWeeklyExpiry,
  compactAdjustSnapshot,
} from "@/lib/positionsSellerInsights";
import {
  POSITIONS_COLUMN_DEFS,
  loadColumnVisibility,
  saveColumnVisibility,
  visibleColumnIds,
} from "@/lib/positionsColumns";
import { resolvePositionSpot, positionExpiryISO } from "@/lib/positionPayoff";
import OvernightRiskScore from "@/components/OvernightRiskScore";
import MarketIntelCard from "@/components/MarketIntelCard";
import { RADAR_AI_LAYOUT_KEY } from "@/lib/deskAiLayout";
import PositionsAnalyzeModal from "@/components/PositionsAnalyzeModal";
import OiRiskMeter from "@/components/OiRiskMeter";
import PositionHeatmap from "@/components/PositionHeatmap";
import TradeJournalModal from "@/components/TradeJournalModal";
import PositionsInsightTiles from "@/components/PositionsInsightTiles";
import InfoTip from "@/components/InfoTip";
import {
  fetchPositionsBook,
  startPositionsBookPolling,
  stopPositionsBookPolling,
  subscribePositionsBook,
  openLiveCount,
  setPositionsBookPollMs,
} from "@/lib/positionsBook";
import { optionSide, optionSideLabel } from "@/lib/optionSide";

const PRIVACY_LS_KEY = "oi_positions_privacy";
const PRIVACY_MASK = "••••";

function loadPrivacyMode() {
  try {
    return localStorage.getItem(PRIVACY_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function savePrivacyMode(on) {
  try {
    localStorage.setItem(PRIVACY_LS_KEY, on ? "1" : "0");
    // Same-tab listeners (Header Today P&L) — `storage` only fires cross-tab.
    window.dispatchEvent(new CustomEvent("oi-positions-privacy", { detail: { on: !!on } }));
  } catch { /* noop */ }
}

function fmtSessionLeft(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return "Market closed";
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  if (h <= 0) return `${m}m to close`;
  return `${h}h ${m}m to close`;
}

function journalPositionsCatchupMinute(iso = todayIST()) {
  return specialSessionCatchupMinute(iso) ?? getPositionsCatchupMinute();
}

/** Auto-refresh the book on session days (Muhurat uses that day's close + 5 min). */
function journalPositionsRefreshOn() {
  const iso = todayIST();
  if (!isJournalSessionDayIST(iso)) return false;
  const mins = istMinutesOfDay();
  const open = specialSessionOpenMinute(iso) ?? getMarketOpenMinute();
  if (mins < open) return false;
  return mins < journalPositionsCatchupMinute(iso);
}

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Mask money / qty figures when Positions privacy mode is on (admin only). */
function priv(privacy, visible) {
  return privacy ? PRIVACY_MASK : visible;
}

/** Kite equity margins. Tile uses Available margin (`equity.net`), not available.cash. */
function fundsBreakdown(funds) {
  if (!funds) return null;
  const cash =
    funds.cash != null ? Number(funds.cash)
      : funds.opening_balance != null ? Number(funds.opening_balance)
        : null;
  const used =
    funds.utilised_debits != null ? Number(funds.utilised_debits)
      : (funds.span != null || funds.exposure != null)
        ? Number(funds.span || 0) + Number(funds.exposure || 0)
        : null;
  const net = funds.net != null ? Number(funds.net) : null;
  const live = funds.live_balance != null ? Number(funds.live_balance) : null;
  // https://support.zerodha.com/.../kite-dashboard-and-fund-values-calculation
  // Available margin = cash + collateral (what you can use for new trades) = Kite `net`.
  const available = net != null ? net : cash;
  return { cash, used, net, live, available };
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
      Trade Excel lives in <b>Journal → Download trades</b> (entry/exit clocks and partials).
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

/** CALL / PUT chip sits on the same row as NRML / MIS on phone cards and desktop. */
function ProductSidePair({ row, exited }) {
  return (
    <div className="inline-flex flex-row flex-nowrap items-center gap-1">
      <ProductBadge product={row.product} exited={exited} />
      <OptionSideBadge row={row} exited={exited} />
    </div>
  );
}
function OptionSideBadge({ row, exited }) {
  const side = optionSide(row);
  const label = optionSideLabel(side);
  if (!label) return null;
  const call = side === "CE";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold tracking-wide ${
        exited
          ? "bg-slate-100 text-slate-400 border border-slate-200/60"
          : call
            ? "bg-rose-100 text-rose-800 border border-rose-200/70"
            : "bg-emerald-100 text-emerald-800 border border-emerald-200/70"
      }`}
      data-testid="option-side-badge"
    >
      {label}
    </span>
  );
}

function BookDropZone({ slot, dragging, onDrop, label }) {
  if (!dragging) return null;
  return (
    <div
      data-testid={`book-drop-${slot}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.(slot);
      }}
      className="h-9 rounded-md border border-dashed border-emerald-400 bg-emerald-50 text-[10px] font-semibold text-emerald-800 flex items-center justify-center"
    >
      {label}
    </div>
  );
}

function BookVerdictCard({ bookVerdict, slot = "top", onSlot, collapsed, onToggleCollapsed, onDragChange }) {
  if (!bookVerdict) return null;
  return (
    <div
      className={`rounded-md border px-3 py-2 space-y-1.5 ${
        bookVerdict.band === "GOOD"
          ? "border-emerald-300 bg-emerald-50/70"
          : bookVerdict.band === "WEAK"
            ? "border-rose-300 bg-rose-50/70"
            : "border-amber-300 bg-amber-50/70"
      }`}
      data-testid="positions-book-verdict"
      data-place={slot}
      draggable
      onDragStart={(e) => {
        try {
          e.dataTransfer.setData("text/plain", "book-verdict");
          e.dataTransfer.effectAllowed = "move";
        } catch { /* noop */ }
        onDragChange?.(true);
      }}
      onDragEnd={() => onDragChange?.(false)}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          className="text-xs font-semibold text-slate-900 inline-flex items-center gap-1 min-w-0 text-left"
          onClick={onToggleCollapsed}
          data-testid="btn-book-verdict-collapse"
          aria-expanded={!collapsed}
        >
          <span className="text-slate-400 cursor-grab active:cursor-grabbing" title="Drag to move" data-testid="book-verdict-grip">
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">Your book · {bookVerdict.headline}</span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
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
          <label className="sr-only" htmlFor="book-verdict-slot">Place Your book</label>
          <select
            id="book-verdict-slot"
            data-testid="book-verdict-slot"
            value={slot}
            onChange={(e) => onSlot?.(e.target.value)}
            className="text-[10px] font-semibold text-slate-600 border border-slate-200 rounded-sm px-1 py-0.5 bg-white"
            title="Keep this placement (this browser)"
          >
            <option value="top">Above list</option>
            <option value="after-live">After live</option>
            <option value="bottom">Below list</option>
          </select>
        </div>
      </div>
      {!collapsed && (
        <ul className="text-[11px] text-slate-700 space-y-0.5 list-disc pl-4">
          {bookVerdict.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Professional symbol: NIFTY 11TH AUG 24800 CE */
function positionLabel(r) {
  return r?.display_name || r?.tradingsymbol || "—";
}

function AvgCell({ row, privacy = false }) {
  if (privacy) return <span className="text-slate-400 tracking-widest">{PRIVACY_MASK}</span>;
  if (row?.exited) {
    // Kite shows 0.00 average on flat / squared-off rows.
    return <span className="text-slate-400">0.00</span>;
  }
  return <span>{fmt(row?.average_price)}</span>;
}

function ExpiryLeftoverSettleBtn({ count, onSettle, busy }) {
  if (!count) return null;
  return (
    <button
      type="button"
      data-testid="btn-settle-expiry-leftovers"
      className="ml-2 inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-950 hover:bg-amber-100 disabled:opacity-60"
      onClick={(e) => {
        e.stopPropagation();
        onSettle?.();
      }}
      disabled={busy}
      title="Zerodha already squares 0.05 expiry hedges after close. Book them here so Profit booked / journal match Today P&L. Does not place a Kite order."
    >
      {busy ? "Booking…" : `Square ${count} leftover${count === 1 ? "" : "s"} in book`}
    </button>
  );
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
  isGuest = false,
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
  pollEnabled = true,
  deskAiShow = false,
  deskAiAsk = true,
  deskAiPositions = false,
  deskAiRadar = true,
  canConfigureDeskAi = false,
  onDeskAiPositions,
  onDeskAiRadar,
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
  const [privacyMode, setPrivacyMode] = useState(() => loadPrivacyMode());
  const [colsOpen, setColsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [oiRiskOpen, setOiRiskOpen] = useState(false);
  const [highlightSymbol, setHighlightSymbol] = useState(null);
  const jumpToPosition = (sym) => {
    setHighlightSymbol(sym);
    const nodes = document.querySelectorAll(`[data-position-symbol="${CSS.escape(sym)}"]`);
    const el = [...nodes].find((n) => n.getClientRects().length > 0) || nodes[0];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const [guestNeedsConnect, setGuestNeedsConnect] = useState(() => !!isGuest);
  const [guestKiteId, setGuestKiteId] = useState(null);
  const [exitedOpen, setExitedOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [leftoverOpenCount, setLeftoverOpenCount] = useState(0);
  const [expirySettledCount, setExpirySettledCount] = useState(0);
  const [settleBusy, setSettleBusy] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(() => {
    try {
      const v = localStorage.getItem("oiPositionsInsightsOpen");
      if (v === "1") return true;
      if (v === "0") return false;
      return typeof window !== "undefined" && window.innerWidth < 768;
    } catch {
      return false;
    }
  });
  const [bookCollapsed, setBookCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem("oiBookVerdictCollapsed");
      if (v === "0") return false;
      return true;
    } catch {
      return true;
    }
  });
  const [bookSlot, setBookSlot] = useState(() => loadBookSlot());
  const [bookDragging, setBookDragging] = useState(false);
  const [deskGuide, setDeskGuide] = useState(null);
  const [outside, setOutside] = useState(null);
  const [radarAiH, setRadarAiH] = useState(() => {
    try {
      const n = Number(localStorage.getItem("oiRadarAiH"));
      if (Number.isFinite(n)) return Math.min(360, Math.max(120, n));
    } catch { /* noop */ }
    return 200;
  });
  const radarDrag = useRef(null);
  const colsAnchorRef = useRef(null);
  const colsPanelRef = useRef(null);
  const closeCols = useCallback(() => setColsOpen(false), []);
  const { pos: colsPos, place: placeCols } = usePortaledMenu({
    open: colsOpen,
    onClose: closeCols,
    anchorRef: colsAnchorRef,
    panelRef: colsPanelRef,
    width: 288,
    align: "right",
  });
  const pollMs = Math.max(5000, Number(positionsPollMs) || 30000);
  useEffect(() => {
    setPositionsBookPollMs(pollMs);
  }, [pollMs]);
  const loadGen = useRef(0);
  const hasLiveRef = useRef(true);
  const shownBookRef = useRef(false);

  const setInsights = useCallback((open) => {
    setInsightsOpen(open);
    try {
      localStorage.setItem("oiPositionsInsightsOpen", open ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const setBookCollapsedPersist = useCallback((on) => {
    setBookCollapsed(on);
    try { localStorage.setItem("oiBookVerdictCollapsed", on ? "1" : "0"); } catch { /* noop */ }
  }, []);
  const setBookSlotPersist = useCallback((slot) => {
    setBookSlot(saveBookSlot(slot));
    setBookDragging(false);
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
  const closeRadar = useCallback(() => setOiRiskOpen(false), []);
  const colOn = useCallback((id) => shownCols.includes(id), [shownCols]);

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

  const applyBook = useCallback((data) => {
    if (!data) return;
    if (data.connect_required) {
      setGuestNeedsConnect(true);
      setGuestKiteId(data?.user_kite?.kite_user_id || null);
      setPositions([]);
      setError(data.error || "Connect your Zerodha account");
      setErrorHard(false);
      setLastRefresh(new Date().toISOString());
      hasLiveRef.current = false;
      return;
    }
    if (isGuest) {
      setGuestNeedsConnect(false);
      setGuestKiteId(data?.user_kite?.kite_user_id || null);
    }
    const next = data.positions || [];
    setLeftoverOpenCount(Number(data.expiry_leftover_open_count) || 0);
    setExpirySettledCount(Number(data.expiry_settled_count) || 0);
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
        if (data.funds != null) setFunds(data.funds);
        if (data.pnl_today != null) setPnlToday(data.pnl_today);
      }
      const open = openLiveCount(data);
      hasLiveRef.current = open > 0;
      shownBookRef.current = true;
      if (data.spot && typeof data.spot === "object") setSpotByIndex(data.spot);
      if (data.oi && typeof data.oi === "object") setOiByIndex(data.oi);
    }
    if (data.maintenance || /zerodha maintenance|under maintenance|scheduled maintenance/i.test(String(data.error || ""))) {
      setError(data.error || "Zerodha / Kite maintenance");
      setErrorHard(false);
    } else if (data.error) {
      setError(data.error);
      setErrorHard(hard && !maintenance);
    } else {
      setError(null);
      setErrorHard(false);
    }
    setLastRefresh(new Date().toISOString());
    setSecsLeft(Math.max(1, Math.round(pollMs / 1000)));
  }, [isGuest, pollMs]);

  const settleExpiryLeftovers = useCallback(async () => {
    setSettleBusy(true);
    try {
      const data = await fetchPositionsBook({ force: true, settleExpiry: true });
      applyBook(data);
    } catch {
      /* keep last book */
    } finally {
      setSettleBusy(false);
    }
  }, [applyBook]);

  const load = useCallback(async (opts) => {
    const gen = ++loadGen.current;
    const force = !!(opts && opts.force);
    if (force || !shownBookRef.current) setLoading(true);
    try {
      const data = await fetchPositionsBook({ force: true });
      if (gen !== loadGen.current) return;
      applyBook(data);
    } catch (e) {
      if (gen !== loadGen.current) return;
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e.message;
      setError(detail);
      setErrorHard(status === 401 || status === 403);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [applyBook]);

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

  const kiteReady = isGuest ? true : (isKiteMode || stickyKite);
  const catchupDoneRef = useRef(false);

  useEffect(() => subscribePositionsBook((payload) => {
    applyBook(payload);
    setLoading(false);
  }), [applyBook]);

  useEffect(() => {
    if (!kiteReady || !pollEnabled) return undefined;
    startPositionsBookPolling();
    const bootId = setTimeout(() => {
      loadBrokerage();
    }, 2000);
    const mins0 = istMinutesOfDay();
    if (isJournalSessionDayIST(todayIST()) && mins0 >= journalPositionsCatchupMinute()) {
      catchupDoneRef.current = true;
    }
    const poll = () => {
      const iso = todayIST();
      if (!isJournalSessionDayIST(iso)) return;
      const mins = istMinutesOfDay();
      const open = specialSessionOpenMinute(iso) ?? getMarketOpenMinute();
      const catchupAt = journalPositionsCatchupMinute(iso);
      if (mins < open) return;
      if (mins >= catchupAt) loadBrokerage();
    };
    const id = setInterval(poll, pollMs);
    const catchId = setInterval(() => {
      const trading = isJournalSessionDayIST(todayIST());
      const mins = istMinutesOfDay();
      if (trading && mins >= journalPositionsCatchupMinute() && !catchupDoneRef.current) {
        catchupDoneRef.current = true;
        loadBrokerage();
      }
    }, 5000);
    const chargesId = setInterval(() => {
      if (journalPositionsRefreshOn()) loadBrokerage();
    }, Math.max(pollMs * 4, 120_000));
    return () => {
      stopPositionsBookPolling();
      clearTimeout(bootId);
      clearInterval(id);
      clearInterval(catchId);
      clearInterval(chargesId);
    };
  }, [kiteReady, pollEnabled, loadBrokerage, pollMs]);

  useEffect(() => {
    if (!kiteReady || !journalPositionsRefreshOn()) return undefined;
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
      const openN = Number(pnlToday.unbooked ?? pnlToday.open);
      const exitedN = Number(pnlToday.exited);
      const totalN = Number(pnlToday.total);
      const bookedN = Number(pnlToday.booked);
      if (Number.isFinite(openN)) openPnl = openN;
      if (Number.isFinite(exitedN)) exitedPnl = exitedN;
      if (Number.isFinite(bookedN)) {
        bookedToday = bookedN;
      } else if (Number.isFinite(exitedN)) {
        bookedToday = exitedN;
        for (const r of rows) {
          if (r.exited) continue;
          const realised = Number(r.realised);
          if (Number.isFinite(realised) && Math.abs(realised) > 1e-9) {
            bookedToday += realised;
          }
        }
      }
      netPnl = Number.isFinite(totalN) ? totalN : (Number.isFinite(bookedN) ? bookedN + openPnl : openPnl + exitedPnl);
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
      minutesToClose: minutesToCloseIST(),
      shortCount,
      adjustCount,
      openCount,
      exitedCount,
    };
  }, [rows, pnlToday]);

  const openRows = useMemo(() => rows.filter((r) => !r.exited), [rows]);
  const exitedRows = useMemo(() => rows.filter((r) => r.exited), [rows]);

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

  const sellsSnap = useMemo(
    () => compactTopSells(sellIdeas, activeIndex),
    [sellIdeas, activeIndex],
  );

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

  const bookCard = bookVerdict ? (
    <BookVerdictCard
      bookVerdict={bookVerdict}
      slot={bookSlot}
      collapsed={bookCollapsed}
      onToggleCollapsed={() => setBookCollapsedPersist(!bookCollapsed)}
      onSlot={setBookSlotPersist}
      onDragChange={setBookDragging}
    />
  ) : null;

  const adjustSnap = useMemo(
    () => compactAdjustSnapshot({ rows, stats, assignmentWatch, privacy: privacyMode }),
    [rows, stats, assignmentWatch, privacyMode],
  );
  const adjustRef = useRef(adjustSnap);
  adjustRef.current = adjustSnap;
  const adjustSig = `${adjustSnap.adjustCount}|${adjustSnap.shortCount}|${Math.round(Number(adjustSnap.netDelta) || 0)}|${(adjustSnap.legs || [])
    .filter((l) => l.close || l.itm)
    .map((l) => l.s)
    .join(",")}`;

  useEffect(() => {
    if (!deskAiShow || !deskAiRadar || !oiRiskOpen) {
      return undefined;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const out = await api.get("/desk-outside", {
          params: activeIndex ? { index: activeIndex } : {},
        }).catch(() => ({ data: null }));
        if (!cancelled) setOutside(out.data || null);
        const mem = await api.get("/desk-memory", { params: { days: 60 } }).catch(() => ({ data: null }));
        const oiTape = summarizeIndexTape(current, previous);
        const { data } = await api.post("/desk-guide", {
          surface: "positions",
          skip_llm: !deskAiAsk,
          index: activeIndex || undefined,
          session_focus: activeIndex || undefined,
          band: bookVerdict?.band || null,
          adjust: adjustRef.current,
          oi: oiTape ? [oiTape] : undefined,
          sells: sellsSnap,
          memory: mem?.data && Array.isArray(mem.data.lines)
            ? { lines: mem.data.lines.slice(0, 6) }
            : undefined,
          outside: out.data || undefined,
        });
        if (!cancelled) setDeskGuide(data || null);
      } catch {
        if (!cancelled) setDeskGuide(null);
      }
    };
    run();
    const id = setInterval(run, 45 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [deskAiShow, deskAiRadar, deskAiAsk, oiRiskOpen, adjustSig, bookVerdict?.band, activeIndex, sellsSnap, current, previous]);

  const pinWeeklyDate = useMemo(() => nearestWeeklyExpiry(expiriesMeta), [expiriesMeta]);

  const TOGGLE_DEFS = [
    { key: "bookVerdict", label: "Book score" },
    { key: "sellIdeas", label: "What to sell" },
    { key: "decayBook", label: "Still decaying" },
    { key: "expiryDayMode", label: "Expiry day" },
    { key: "deltaHedge", label: "Flatten tilt" },
    { key: "assignmentWatch", label: "Exercise risk" },
  ];

  if (!isGuest && !kiteReady) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center space-y-3" data-testid="positions-kite-required">
        <PlugZap className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <div className="text-sm font-semibold text-slate-700">Kite Live mode required</div>
        <div className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Connect Zerodha Kite to pull your open F&amp;O positions here. Trade journal still reads booked days from our database.
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {typeof onOpenKite === "function" && (
            <Button
              size="sm"
              className="h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700"
              onClick={onOpenKite}
              data-testid="btn-positions-reconnect-kite"
            >
              <PlugZap className="w-3.5 h-3.5 mr-1.5" />
              Connect Kite
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white text-emerald-800 border-emerald-200"
            onClick={() => setJournalOpen(true)}
            data-testid="btn-trade-journal"
          >
            <BookOpen className="w-3.5 h-3.5 mr-1" />
            Journal
          </Button>
        </div>
        <TradeJournalModal open={journalOpen} onOpenChange={setJournalOpen} privacy={privacyMode} />
      </div>
    );
  }

  if (isGuest && guestNeedsConnect) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-6 text-center" data-testid="positions-user-kite-required">
        <PlugZap className="w-8 h-8 mx-auto text-emerald-700 mb-2" />
        <div className="text-sm font-semibold text-slate-800">Connect your Zerodha</div>
        <div className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
          Log in with your Kite account to load <b>your</b> positions. Charts still use the publisher OI feed.
          Tokens expire around 06:00 IST — reconnect each morning.
          If Kite says the user is not enabled for the app, the desk owner must add your user_id in developers.kite.tech (or publish the app).
          {guestKiteId ? ` Last login: ${guestKiteId}.` : ""}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
        {typeof onOpenKite === "function" && (
          <Button
            size="sm"
            className="h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700"
            onClick={onOpenKite}
            data-testid="btn-positions-connect-zerodha"
          >
            <PlugZap className="w-3.5 h-3.5 mr-1.5" />
            Connect Zerodha
          </Button>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 sm:p-4" data-testid="positions-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <OiPulseLogo className="w-5 h-5 overflow-hidden rounded-md shrink-0" pulse={false} />
          <div className="text-sm font-semibold text-slate-900 leading-tight">Kite Positions</div>
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
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm border border-slate-300 bg-white text-[13px] font-semibold text-slate-900 hover:border-slate-500 hover:bg-slate-50 transition-colors"
                data-testid="positions-brokerage-day"
                title="Today’s trading charges — click for breakdown"
              >
                <Receipt className="w-3.5 h-3.5 text-slate-800" />
                <span className="text-slate-900">Charges</span>
                <span className="font-mono-data font-bold text-slate-950">
                  {privacyMode
                    ? PRIVACY_MASK
                    : brokerage?.charges_total != null
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
                <ChevronDown className="w-3.5 h-3.5 text-slate-700" />
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
                    ? `${brokerage.order_count} order${brokerage.order_count === 1 ? "" : "s"}`
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
                        {privacyMode ? PRIVACY_MASK : `₹${fmt(row.amount, 2)}`}
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
                  {brokerage?.gst && (Number(brokerage.gst.cgst) || Number(brokerage.gst.sgst)) ? (
                    <div className="rounded-sm bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 space-y-0.5">
                      <div className="font-semibold uppercase tracking-wider text-slate-400">GST detail</div>
                      {brokerage.gst.igst ? (
                        <div className="flex justify-between"><span>IGST</span><span className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹${fmt(brokerage.gst.igst, 2)}`}</span></div>
                      ) : null}
                      {brokerage.gst.cgst ? (
                        <div className="flex justify-between"><span>CGST</span><span className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹${fmt(brokerage.gst.cgst, 2)}`}</span></div>
                      ) : null}
                      {brokerage.gst.sgst ? (
                        <div className="flex justify-between"><span>SGST</span><span className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹${fmt(brokerage.gst.sgst, 2)}`}</span></div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
              <div className="border-t border-slate-100 px-3 py-2.5 flex items-center justify-between bg-slate-50/80">
                <span className="text-xs font-semibold text-slate-700">Total today</span>
                <span className="font-mono-data text-sm font-bold text-slate-900" data-testid="charges-total">
                  {privacyMode
                    ? PRIVACY_MASK
                    : brokerage?.charges_total != null
                      ? `₹${fmt(brokerage.charges_total, 2)}`
                      : "—"}
                </span>
              </div>
            </PopoverContent>
          </Popover>
          <label
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-sm border border-slate-300 bg-white text-[13px] font-semibold text-slate-900 cursor-pointer select-none hover:border-slate-500 hover:bg-slate-50"
            title="Mask Qty, Avg, P&L and ₹ amounts on Positions and Today P&L in the header"
            data-testid="positions-privacy-toggle"
          >
            {privacyMode ? <EyeOff className="w-3.5 h-3.5 text-slate-800" /> : <Eye className="w-3.5 h-3.5 text-slate-800" />}
            <span className="text-slate-900">Privacy</span>
            <Switch
              checked={privacyMode}
              onCheckedChange={(on) => {
                setPrivacyMode(!!on);
                savePrivacyMode(!!on);
              }}
              className="scale-90 origin-center"
              data-testid="positions-privacy-switch"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            className={`h-8 rounded-full bg-white shrink-0 px-2.5 ${
              oiRiskOpen
                ? "text-rose-900 border-rose-400 bg-rose-50"
                : "text-rose-800 border-rose-200 hover:bg-rose-50"
            }`}
            onClick={() => setOiRiskOpen((v) => !v)}
            data-testid="btn-oi-risk-meter"
            aria-pressed={oiRiskOpen}
            title="Book radar: 15-min OI vs nearest sold strike, plus position heatmap"
          >
            <ShieldAlert className="w-3.5 h-3.5 mr-1" />
            Radar
          </Button>
          {!isGuest && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white shrink-0 text-emerald-800 border-emerald-200 hover:bg-emerald-50 px-2.5"
            onClick={() => setJournalOpen(true)}
            data-testid="btn-trade-journal"
            title="Monthly P&L calendar and session notes"
          >
            <BookOpen className="w-3.5 h-3.5 mr-1" />
            Journal
          </Button>
          )}
          {isGuest && typeof onOpenKite === "function" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white shrink-0 text-emerald-800 border-emerald-300 hover:bg-emerald-50 px-2.5"
            onClick={onOpenKite}
            data-testid="btn-positions-connect-zerodha-toolbar"
            title="Your book uses your Zerodha login. OI charts still use the publisher feed."
          >
            <PlugZap className="w-3.5 h-3.5 mr-1" />
            {guestKiteId ? "Reconnect Zerodha" : "Connect Zerodha"}
          </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white shrink-0 text-orange-700 border-orange-200 hover:bg-orange-50 px-2.5"
            onClick={() => setAnalyzeOpen(true)}
            disabled={!rows.length}
            data-testid="btn-analyze-positions"
          >
            <LineChart className="w-3.5 h-3.5 mr-1" />
            Analyze
          </Button>
          <div className="relative" ref={colsAnchorRef}>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-sm bg-white px-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setColsOpen((v) => !v);
                requestAnimationFrame(() => placeCols());
              }}
              data-testid="btn-positions-columns"
              title="Show / hide columns"
            >
              <Columns3 className="w-3.5 h-3.5 mr-1" />
              Columns
              {colsOpen ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
            {colsOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={colsPanelRef}
                className="fixed z-[80] max-h-[min(50vh,20rem)] overflow-auto rounded-md border border-slate-200 bg-white shadow-xl p-2 w-[16.5rem] max-w-[calc(100vw-1.5rem)]"
                style={{ top: colsPos.top, left: colsPos.left }}
                data-testid="positions-columns-menu"
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-400 px-1.5 pb-1.5">
                  Table columns
                </div>
                <div className="space-y-0.5">
                  {POSITIONS_COLUMN_DEFS.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-sm text-[12px] ${
                        c.required
                          ? "text-slate-400 cursor-default"
                          : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600 h-4 w-4"
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
              </div>,
              document.body,
            )}
          </div>
          <span id="positions-tiles-anchor" className="inline-flex" data-testid="positions-tiles-anchor" />
          <Button size="sm" variant="outline" className="h-7 rounded-sm bg-white min-h-[28px] px-2" onClick={() => { load({ force: true }); loadBrokerage(); }} data-testid="btn-refresh-positions">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
            {journalPositionsRefreshOn() && (
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

      <PositionsInsightTiles
        layoutAnchorId="positions-tiles-anchor"
        nodes={{
          todayPnl: (
        <StatBox
          label="Today P&L"
          value={priv(privacyMode, "₹ " + fmt(stats.netPnl))}
          tone={privacyMode ? "slate" : stats.netPnl >= 0 ? "emerald" : "rose"}
          hint={
            privacyMode
              ? "Masked"
              : `Unbooked ₹ ${fmt(stats.openPnl, 0)} · Booked ₹ ${fmt(stats.bookedToday, 0)}`
          }
          tip={(
            <div className="space-y-1.5">
              <p>
                <b>Today P&amp;L</b> matches Kite <b>Total P&amp;L</b> = Booked + Unbooked.
                Booked is realised on closed and partial legs; Unbooked is open MTM.
              </p>
              {!privacyMode && (
                <p>
                  Unbooked: ₹ {fmt(stats.openPnl, 0)} · Booked: ₹ {fmt(stats.bookedToday, 0)}
                  {brokerage?.charges_total != null
                    ? ` · Day charges ₹ ${fmt(brokerage.charges_total, 0)}`
                    : ""}
                </p>
              )}
            </div>
          )}
        />
          ),
          funds: (
        <StatBox
          label="Funds available"
          value={(() => {
            if (privacyMode) return PRIVACY_MASK;
            const b = fundsBreakdown(funds);
            if (!b || b.available == null) return "—";
            return "₹ " + fmt(b.available, 0);
          })()}
          tone={(() => {
            if (privacyMode) return "slate";
            const b = fundsBreakdown(funds);
            if (!b || b.available == null) return "slate";
            if (b.available < 0) return "rose";
            return "slate";
          })()}
          hint={(() => {
            if (privacyMode) return "Masked";
            const b = fundsBreakdown(funds);
            if (!b) return "Kite available margin";
            if (b.used != null) return `Used margin ₹ ${fmt(b.used, 0)}`;
            return "Cash + collateral · Kite";
          })()}
          tip={(
            <div className="space-y-1.5">
              <p>
                Same as Kite <b>Available margin</b> (cash + collateral) — the amount you can use
                for new trades. Not Available cash (that can be a large debit while margin is still positive).
              </p>
              {!privacyMode && (
                <p>
                  Available: {funds?.net != null ? `₹ ${fmt(funds.net, 0)}` : "—"}.
                  Cash: {funds?.cash != null ? `₹ ${fmt(funds.cash, 0)}` : "—"}.
                  Used: {funds?.utilised_debits != null ? `₹ ${fmt(funds.utilised_debits, 0)}` : "—"}.
                </p>
              )}
            </div>
          )}
        />
          ),
          dailyTheta: (
        <StatBox
          label="Daily time money"
          value={priv(privacyMode, "₹ " + fmt(stats.netTheta, 0))}
          tone={privacyMode ? "slate" : stats.netTheta >= 0 ? "emerald" : "rose"}
          hint={privacyMode ? "Masked" : stats.netTheta >= 0 ? "Time is paying you" : "Time is costing you"}
          tip={(
            <p>
              Rough ₹ from time passing if the market stays put — capped to premium still left in
              each option (so expiry-day Black–Scholes cannot show fake −₹10k on a ₹500 long).
              This is <b>not</b> your P&amp;L; P&amp;L matches Kite in the P&amp;L column.
            </p>
          )}
        />
          ),
          tilt: (
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
          ),
          stillEarn: (
        <StatBox
          label="Still to earn"
          value={privacyMode ? PRIVACY_MASK : (stats.premiumLeft != null ? "₹ " + fmt(stats.premiumLeft, 0) : "—")}
          tone="slate"
          hint={privacyMode ? "Masked" : "Left on sold options"}
          tip={(
            <p>
              Premium still sitting in your sold options. If the market stays away until expiry /
              close, much of this can decay into your pocket. Estimate only — not guaranteed.
            </p>
          )}
        />
          ),
          booked: (
        <StatBox
          label="Profit booked today"
          value={priv(privacyMode, "₹ " + fmt(stats.bookedToday))}
          tone={privacyMode ? "slate" : stats.bookedToday >= 0 ? "emerald" : "rose"}
          hint={
            privacyMode
              ? "Masked"
              : stats.exitedCount > 0
                ? `Kite Booked · closed + partials`
                : "Kite Booked (incl. partials)"
          }
          tip={(
            <p>
              Same as Kite Positions <b>Booked</b>: realised on squared-off legs plus
              partial closes that are still open. Not live LTP.
            </p>
          )}
        />
          ),
          untilClose: (
        <StatBox
          label="Until close"
          value={priv(privacyMode, stats.thetaToClose != null ? "₹ " + fmt(stats.thetaToClose, 0) : "—")}
          tone={privacyMode ? "slate" : (stats.thetaToClose || 0) >= 0 ? "emerald" : "rose"}
          hint={privacyMode ? "Masked" : fmtSessionLeft(stats.minutesToClose)}
          tip={(
            <p>
              Rough rupees time-decay can still add (or cost) from <b>now until 15:40 IST</b> if spot stays put.
              This is the leftover slice of Daily time money for the rest of the session — not extra P&amp;L on top of it,
              and not guaranteed.
            </p>
          )}
        />
          ),
          overnight: (
        <OvernightRiskScore
          vix={vix}
          netDelta={stats.netDelta}
          positionsCount={stats.openCount}
          minutesToExpiry={stats.minMinutes}
        />
          ),
        }}
      />

      {stats.adjustCount > 0 && (
        <div className="text-[11px] text-rose-800 dark:text-rose-200 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 flex flex-wrap gap-x-4 gap-y-1" data-testid="positions-seller-strip">
          <span>
            Sold options <b>{stats.shortCount}</b>
            <span> · {stats.adjustCount} too close — check them</span>
          </span>
          {(() => {
            const b = fundsBreakdown(funds);
            if (!b || (b.available == null && b.used == null)) return null;
            return (
              <span title="Kite available margin vs used margin">
                {b.available != null && (
                  <>Avail <b className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹ ${fmt(b.available, 0)}`}</b></>
                )}
                {b.used != null && (
                  <>{b.available != null ? " · " : ""}Used <b className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹ ${fmt(b.used, 0)}`}</b></>
                )}
              </span>
            );
          })()}
        </div>
      )}

      <BookDropZone slot="top" dragging={bookDragging} onDrop={setBookSlotPersist} label="Drop Your book above the list" />
      {bookSlot === "top" && bookCard}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2 pb-1" data-testid="positions-mobile-cards">
        {rows.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs border border-slate-100 rounded-md">No F&amp;O positions today.</div>
        ) : (
          <>
        {openRows.length > 0 && (
          <button
            type="button"
            className="relative z-20 w-full min-h-11 inline-flex items-center justify-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/90 py-2.5 pl-3 pr-3 text-[13px] font-semibold text-emerald-900 touch-manipulation"
            onClick={() => setLiveOpen((v) => !v)}
            data-testid="btn-toggle-live-positions-mobile"
          >
                      {liveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Live · {openRows.length}
            <ExpiryLeftoverSettleBtn count={leftoverOpenCount} onSettle={settleExpiryLeftovers} busy={settleBusy} />
          </button>
        )}
        {(liveOpen ? openRows : []).map((r) => {
          const thetaInr = !r.exited && Number.isFinite(r.thetaInr) ? r.thetaInr : null;
          return (
            <div
              key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
              data-testid="position-card"
              data-position-symbol={r.tradingsymbol}
              data-exited={r.exited ? "1" : "0"}
              className={`rounded-lg border px-3 py-2.5 transition-colors ${
                highlightSymbol && r.tradingsymbol === highlightSymbol
                  ? "ring-2 ring-emerald-400 bg-emerald-50/80"
                  : r.exited
                  ? "border-slate-200/70 bg-slate-100/80 text-slate-400 shadow-none opacity-[0.58]"
                  : r.breachedAdjust
                    ? "border-rose-300 bg-rose-50/80 shadow-sm"
                    : "border-slate-200/80 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <ProductSidePair row={r} exited={r.exited} />
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
                    {privacyMode ? PRIVACY_MASK : (r.exited ? 0 : r.quantity)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Avg</div>
                  <div><AvgCell row={r} privacy={privacyMode} /></div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">P&amp;L</div>
                  <div className={`font-semibold ${privacyMode ? "text-slate-500" : r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-70" : ""}`}>
                    {privacyMode ? PRIVACY_MASK : `${r.pnl >= 0 ? "+" : ""}${fmt(r.pnl, 0)}`}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">LTP</div>
                  <div>{fmt(r.last_price)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">₹/day</div>
                  <div className={privacyMode || thetaInr == null ? "" : thetaInr >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                    {privacyMode ? PRIVACY_MASK : (thetaInr != null ? fmt(thetaInr, 0) : "—")}
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
        <BookDropZone slot="after-live" dragging={bookDragging} onDrop={setBookSlotPersist} label="Drop Your book after live" />
        {bookSlot === "after-live" && <div className="md:hidden">{bookCard}</div>}
        {exitedRows.length > 0 && (
          <button
            type="button"
            className="relative z-20 w-full min-h-11 inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 py-2.5 text-[13px] font-semibold text-slate-700 touch-manipulation"
            onClick={() => setExitedOpen((v) => !v)}
            data-testid="btn-toggle-exited-positions-mobile"
          >
            {exitedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Exited today · {exitedRows.length}
          </button>
        )}
        {(exitedOpen ? exitedRows : []).map((r) => {
          const thetaInr = !r.exited && Number.isFinite(r.thetaInr) ? r.thetaInr : null;
          return (
            <div
              key={`ex-${r.exchange}-${r.product}-${r.tradingsymbol}`}
              data-testid="position-card"
              data-position-symbol={r.tradingsymbol}
              data-exited="1"
              className={`rounded-lg border px-3 py-2.5 border-slate-200/70 bg-slate-100/80 text-slate-400 shadow-none opacity-[0.58] ${
                highlightSymbol && r.tradingsymbol === highlightSymbol ? "ring-2 ring-emerald-400" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <ProductSidePair row={r} exited />
                    <span className="text-[9px] uppercase tracking-wide text-slate-400">Squared off</span>
                  </div>
                  <div className="text-base font-semibold truncate text-slate-400">{positionLabel(r)}</div>
                  <div className="text-xs text-slate-300">{r.exchange}</div>
                </div>
                <StatusChip breached={false} isShortOpt={false} exited />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm font-mono-data text-slate-400">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Qty</div>
                  <div className="font-semibold">{privacyMode ? PRIVACY_MASK : 0}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">Avg</div>
                  <div><AvgCell row={r} privacy={privacyMode} /></div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400">P&amp;L</div>
                  <div className={`font-semibold ${privacyMode ? "text-slate-500" : r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} opacity-70`}>
                    {privacyMode ? PRIVACY_MASK : `${r.pnl >= 0 ? "+" : ""}${fmt(r.pnl, 0)}`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-auto rounded-lg border border-slate-200/80 shadow-sm bg-white">
        <table className="w-full text-sm font-mono-data">
          <thead className="bg-slate-50/90 text-slate-500 uppercase tracking-wider text-xs sticky top-0 z-10">
            <tr className="border-b border-slate-200/80">
              {colOn("product") && <th className="text-left px-2.5 py-1.5 font-semibold">Product</th>}
              {colOn("instrument") && <th className="text-left px-2.5 py-1.5 font-semibold">Instrument</th>}
              {colOn("qty") && <th className="text-right px-2.5 py-1.5 font-semibold">Qty</th>}
              {colOn("avg") && <th className="text-right px-2.5 py-1.5 font-semibold">Avg</th>}
              {colOn("ltp") && <th className="text-right px-2.5 py-1.5 font-semibold">LTP</th>}
              {colOn("pnl") && <th className="text-right px-2.5 py-1.5 font-semibold">P&amp;L</th>}
              {colOn("tilt") && (
                <th className="text-right px-2.5 py-1.5 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Tilt
                    <InfoTip title="Direction tilt" size="xs" testId="delta-col-tip">
                      Does this leg push you to bet up or down? Near 0 is calmer for sellers.
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("theta") && (
                <th className="text-right px-2.5 py-1.5 font-semibold">
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
                <th className="text-right px-2.5 py-1.5 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Still earn
                    <InfoTip title="Still to earn" size="xs" testId="prem-left-col-tip">
                      Premium left on a sold option that can still decay into your pocket if the market stays away.
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("iv") && <th className="text-right px-2.5 py-1.5 font-semibold">IV</th>}
              {colOn("dte") && (
                <th className="text-right px-2.5 py-1.5 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Days left
                    <InfoTip title="Days left" size="xs" testId="dte-col-tip">
                      How many days until this option expires (rough).
                    </InfoTip>
                  </span>
                </th>
              )}
              {colOn("status") && (
                <th className="text-left px-2.5 py-1.5 font-semibold">
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
                <th className="text-right px-2.5 py-1.5 font-semibold">
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
            ) : [...(liveOpen ? openRows : []), ...(exitedOpen ? exitedRows : [])].map((r, idx) => {
              const thetaInr = !r.exited && Number.isFinite(r.thetaInr) ? r.thetaInr : null;
              const shownOpen = liveOpen ? openRows : [];
              const showLiveDivider = idx === 0 && openRows.length > 0;
              const showExitedDivider = idx === shownOpen.length && exitedRows.length > 0;
              return (
              <Fragment key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}>
              {showLiveDivider && (
                <tr data-testid="live-section-divider">
                  <td
                    colSpan={Math.max(shownCols.length, 1)}
                    className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-emerald-900 bg-emerald-50/90 border-y border-emerald-100"
                  >
                    <button
                      type="button"
                      className="inline-flex items-center justify-start gap-1.5 hover:text-emerald-950"
                      onClick={() => setLiveOpen((v) => !v)}
                      data-testid="btn-toggle-live-positions"
                    >
                      {liveOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Live · {openRows.length}
                    </button>
                    <ExpiryLeftoverSettleBtn count={leftoverOpenCount} onSettle={settleExpiryLeftovers} busy={settleBusy} />
                  </td>
                </tr>
              )}
              {showExitedDivider && (
                <tr data-testid="exited-section-divider">
                  <td
                    colSpan={Math.max(shownCols.length, 1)}
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border-y border-slate-100"
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-slate-800"
                      onClick={() => setExitedOpen((v) => !v)}
                      data-testid="btn-toggle-exited-positions"
                    >
                      {exitedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Exited today · {exitedRows.length}
                    </button>
                  </td>
                </tr>
              )}
              <tr
                data-testid="position-row"
                data-position-symbol={r.tradingsymbol}
                data-exited={r.exited ? "1" : "0"}
                className={`border-b border-slate-100/80 ${
                  highlightSymbol && r.tradingsymbol === highlightSymbol
                    ? "ring-2 ring-emerald-400 bg-emerald-50/80"
                    : r.exited
                    ? "bg-slate-100/70 text-slate-400 opacity-[0.58]"
                    : r.breachedAdjust
                      ? "bg-rose-50/80"
                      : idx % 2 === 0
                        ? "bg-white"
                        : "bg-emerald-50/25"
                }`}
              >
                {colOn("product") && (
                  <td className="px-2 py-1 min-w-[7.25rem]">
                    <ProductSidePair row={r} exited={r.exited} />
                  </td>
                )}
                {colOn("instrument") && (
                  <td className="px-2 py-1">
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
                  <td className={`text-right px-2 py-1 font-semibold ${r.exited ? "text-slate-400" : r.isShort ? "text-rose-600" : "text-sky-700"}`}>
                    {privacyMode ? PRIVACY_MASK : (r.exited ? 0 : r.quantity)}
                  </td>
                )}
                {colOn("avg") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-400" : ""}`}>
                    <AvgCell row={r} privacy={privacyMode} />
                  </td>
                )}
                {colOn("ltp") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-400" : ""}`}>{fmt(r.last_price)}</td>
                )}
                {colOn("pnl") && (
                  <td className={`text-right px-2 py-1 font-semibold ${privacyMode ? "text-slate-500" : r.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} ${r.exited ? "opacity-80" : ""}`}>
                    {privacyMode ? PRIVACY_MASK : `${r.pnl >= 0 ? "+" : ""}${fmt(r.pnl, 0)}`}
                  </td>
                )}
                {colOn("tilt") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-300" : ""}`}>
                    {Number.isFinite(r.delta) ? r.delta.toFixed(2) : "—"}
                  </td>
                )}
                {colOn("theta") && (
                  <td className={`text-right px-2 py-1 font-semibold ${privacyMode || thetaInr == null ? (r.exited ? "text-slate-300" : "") : thetaInr >= 0 ? "text-emerald-700" : "text-rose-700"} ${r.exited ? "opacity-50" : ""}`}>
                    {privacyMode ? PRIVACY_MASK : (thetaInr != null ? fmt(thetaInr, 0) : "—")}
                  </td>
                )}
                {colOn("stillEarn") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-300" : "text-slate-700"}`}>
                    {privacyMode
                      ? PRIVACY_MASK
                      : (!r.exited && r.isShort && r.extrinsicLeft != null ? (
                        <span title={r.onExpiryDay ? `Expiry day — extrinsic left to ${getMarketCloseHm()}` : "Extrinsic left"}>
                          ₹{fmt(r.extrinsicLeft, 0)}
                        </span>
                      ) : "—")}
                  </td>
                )}
                {colOn("iv") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-300" : ""}`}>
                    {Number.isFinite(r.iv) ? `${r.iv.toFixed(1)}%` : "—"}
                  </td>
                )}
                {colOn("dte") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-300" : ""}`}>
                    {r.dte != null ? `${r.dte.toFixed(1)}d` : "—"}
                  </td>
                )}
                {colOn("status") && (
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <GreeksHealthChip health={r.greeksHealth} />
                      <StatusChip breached={r.breachedAdjust} isShortOpt={!r.exited && r.isShort && r.isOpt} exited={r.exited} />
                      {!r.exited && !r.breachedAdjust && !(r.isShort && r.isOpt) && (!r.greeksHealth || r.greeksHealth === "ok") ? "—" : null}
                    </div>
                  </td>
                )}
                {colOn("atmDist") && (
                  <td className={`text-right px-2 py-1 ${r.exited ? "text-slate-300" : ""}`}>
                    {r.exited ? "—" : <AtmDistanceCell row={r} />}
                  </td>
                )}
              </tr>
              {idx === shownOpen.length - 1 && shownOpen.length > 0 && bookSlot === "after-live" && (
                <tr data-testid="book-verdict-table-slot">
                  <td colSpan={Math.max(shownCols.length, 1)} className="p-2 bg-white">{bookCard}</td>
                </tr>
              )}
              </Fragment>
              );
            })}
            {openRows.length > 0 && !liveOpen && (
              <tr data-testid="live-section-divider">
                <td
                  colSpan={Math.max(shownCols.length, 1)}
                  className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-emerald-900 bg-emerald-50/90 border-y border-emerald-100"
                >
                  <button
                    type="button"
                    className="inline-flex items-center justify-start gap-1.5 hover:text-emerald-950"
                    onClick={() => setLiveOpen(true)}
                    data-testid="btn-toggle-live-positions"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    Live · {openRows.length}
                  </button>
                  <ExpiryLeftoverSettleBtn count={leftoverOpenCount} onSettle={settleExpiryLeftovers} busy={settleBusy} />
                </td>
              </tr>
            )}
            {openRows.length > 0 && !liveOpen && bookSlot === "after-live" && (
              <tr data-testid="book-verdict-table-slot">
                <td colSpan={Math.max(shownCols.length, 1)} className="p-2 bg-white">{bookCard}</td>
              </tr>
            )}
            {exitedRows.length > 0 && !exitedOpen && (
              <tr data-testid="exited-section-divider">
                <td
                  colSpan={Math.max(shownCols.length, 1)}
                  className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border-y border-slate-100"
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-slate-800"
                    onClick={() => setExitedOpen(true)}
                    data-testid="btn-toggle-exited-positions"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    Exited today · {exitedRows.length}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BookDropZone slot="bottom" dragging={bookDragging} onDrop={setBookSlotPersist} label="Drop Your book below the list" />
      {bookSlot === "bottom" && bookCard}

      <div className="flex items-center justify-between gap-2 max-md:pb-12">
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
          <PositionHeatmap
            compact
            rows={rows}
            activeIndex={activeIndex}
            privacy={privacyMode}
            onSelect={jumpToPosition}
          />
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
                    Prem left vs time to {getMarketCloseHm()} ·{" "}
                    <b className="font-mono-data">{expiryClock.minutesToClose ?? "—"} min</b>
                    {" · total extrinsic "}
                    <b className="font-mono-data">{privacyMode ? PRIVACY_MASK : `₹${fmt(expiryClock.totalExtrinsic, 0)}`}</b>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {expiryClock.items.slice(0, 4).map((it) => (
                      <span key={it.tradingsymbol} className="font-mono-data text-[10px]">
                        {it.strike}{it.side} {privacyMode ? PRIVACY_MASK : `₹${fmt(it.extrinsicLeft, 0)}`}
                        {!privacyMode && it.rupeesPerMinute != null && (
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
                      {" "}{privacyMode ? PRIVACY_MASK : `₹${fmt(r.extrinsicLeft, 0)}`}
                      {!privacyMode && r.thetaInr != null && (
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
        <div className="text-[10px] text-slate-400 text-right" data-testid="positions-last-refresh">
          Next refresh ({secsLeft}s)
        </div>
      )}

      <BookRadarPanel open={oiRiskOpen} onClose={closeRadar}>
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
          <div>
            <div className="text-[15px] font-semibold text-slate-900 tracking-tight">Book radar</div>
            <p className="text-[11px] text-slate-600 leading-snug mt-0.5">
              15-minute OI vs your nearest sold strike, plus the live position heatmap. The page stays usable — click anywhere else to close.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {deskAiShow && canConfigureDeskAi ? (
              <label
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-900"
                data-testid="radar-desk-ai-toggle"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI
                <Switch
                  checked={!!deskAiRadar}
                  onCheckedChange={(on) => onDeskAiRadar?.(!!on)}
                  className="scale-90 origin-center"
                  data-testid="radar-desk-ai-switch"
                />
              </label>
            ) : null}
            <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 shrink-0"
            onClick={closeRadar}
            data-testid="btn-book-radar-close"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
          </div>
        </div>
        <div className="px-4 pb-4 space-y-3 overflow-y-auto">
          {deskAiShow && deskAiRadar ? (
            <div
              className="rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2"
              data-testid="radar-market-intel"
            >
              <div className="overflow-y-auto" style={{ height: radarAiH }}>
                <MarketIntelCard outside={outside} guide={deskGuide} compact layoutKey={RADAR_AI_LAYOUT_KEY} />
              </div>
              <button
                type="button"
                aria-label="Resize radar AI"
                data-testid="radar-ai-resize"
                className="flex w-full items-center justify-center h-3 cursor-ns-resize touch-none text-violet-400 hover:text-violet-700"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startH = radarAiH;
                  radarDrag.current = { startY, startH };
                  const onMove = (ev) => {
                    if (!radarDrag.current) return;
                    const next = Math.min(360, Math.max(120, radarDrag.current.startH + (ev.clientY - radarDrag.current.startY)));
                    setRadarAiH(next);
                  };
                  const onUp = () => {
                    radarDrag.current = null;
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    setRadarAiH((h) => {
                      try { localStorage.setItem("oiRadarAiH", String(h)); } catch { /* noop */ }
                      return h;
                    });
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
              >
                <GripHorizontal className="w-4 h-4" />
              </button>
            </div>
          ) : null}
          <OiRiskMeter activeIndex={activeIndex} expiry={expiry} rows={rows} />
          <PositionHeatmap
            rows={rows}
            activeIndex={activeIndex}
            privacy={privacyMode}
            onSelect={jumpToPosition}
          />
        </div>
      </BookRadarPanel>
      <TradeJournalModal
        open={journalOpen}
        onOpenChange={setJournalOpen}
        privacy={privacyMode}
      />
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
        privacyMode={privacyMode}
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

function BookRadarPanel({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-testid='oi-risk-sheet']")) return;
      if (t.closest("[data-testid='btn-oi-risk-meter']")) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <aside
      data-testid="oi-risk-sheet"
      className="fixed z-[80] right-2 top-[4.75rem] bottom-2 w-[min(100vw-1rem,26rem)] rounded-3xl border border-slate-200/90 bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] overflow-hidden flex flex-col"
    >
      {children}
    </aside>,
    document.body,
  );
}

function StatBox({ label, value, tone = "slate", hint, tip }) {
  const cls = tone === "emerald"
    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
    : tone === "rose"
      ? "border-rose-300 bg-rose-50 text-rose-950"
      : tone === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-slate-300 bg-white text-slate-900";
  return (
    <div className={`rounded-xl border px-2.5 py-1.5 md:py-2 h-full min-h-[4.75rem] md:min-h-0 flex flex-col gap-0.5 shadow-sm ${cls}`} data-testid={`stat-${label.replace(/\s|&|₹|\+|\//g, "-").toLowerCase()}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-700 font-semibold inline-flex items-center gap-1 pr-4 leading-none">
        {label}
        {tip && (
          <InfoTip title={label} size="xs">{tip}</InfoTip>
        )}
      </div>
      <div className="text-[15px] md:text-[17px] font-semibold font-mono-data leading-tight tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-slate-600 leading-tight line-clamp-2">{hint}</div>}
    </div>
  );
}
