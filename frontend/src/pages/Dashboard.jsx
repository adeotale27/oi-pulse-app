import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import OIChart from "@/components/OIChart";
import TimeframePills from "@/components/TimeframePills";
import AlertsPanel from "@/components/AlertsPanel";
import GuestBanner from "@/components/GuestBanner";
import MarketStatusBanner from "@/components/MarketStatusBanner";
import AdminUploadAdvisor from "@/components/AdminUploadAdvisor";
import DeskStatusRail from "@/components/DeskStatusRail";
import DataTruthStrip from "@/components/DataTruthStrip";
import OvernightGapBrief from "@/components/OvernightGapBrief";
import DeskAiBar from "@/components/DeskAiBar";
import WriterDefenseMap from "@/components/WriterDefenseMap";
import KiteTokenBanner from "@/components/KiteTokenBanner";
import KiteMaintenanceBanner from "@/components/KiteMaintenanceBanner";
import StrikeTable from "@/components/StrikeTable";
import CredentialsModal from "@/components/CredentialsModal";
import MorningRefreshModal from "@/components/MorningRefreshModal";
import TelegramPrefsModal from "@/components/TelegramPrefsModal";
import SettingsModal from "@/components/SettingsModal";
import TradeJournalModal from "@/components/TradeJournalModal";
import ReplayScrubber from "@/components/ReplayScrubber";
import SentimentBar from "@/components/SentimentBar";
import HugeShiftModal from "@/components/HugeShiftModal";
import ActivityFeed from "@/components/ActivityFeed";
import HolidaysTab from "@/components/HolidaysTab";
import BuildupTable from "@/components/BuildupTable";
import PositionsPanel from "@/components/PositionsPanel";
import RightPanel from "@/components/RightPanel";
import OverflowTabBar from "@/components/OverflowTabBar";
import SoundSettingsModal from "@/components/SoundSettingsModal";
import UploadModal from "@/components/UploadModal";
import EventRiskWidget from "@/components/EventRiskWidget";
import StraddleChart from "@/components/StraddleChart";
import CasPanel from "@/components/CasPanel";
import MobileStickyChrome from "@/components/MobileStickyChrome";
import MobileIndexTicker from "@/components/MobileIndexTicker";
import SellCandidatesPanel from "@/components/SellCandidatesPanel";
import SuggestionBox from "@/components/SuggestionBox";
import InfoTip from "@/components/InfoTip";
import InfoTilesRow, { DEFAULT_TILE_IDS } from "@/components/InfoTilesRow";
import MobileBottomNav from "@/components/MobileBottomNav";
import StrikeAroundChips from "@/components/StrikeAroundChips";
import {
  loadTabOrder,
  saveTabOrder,
  orderPages,
  moveIdBefore,
  moveIdByOffset,
  pinIdFirst,
  loadTileOrder,
  saveTileOrder,
} from "@/lib/tabOrder";
import { biasGuide, pcrGuide, maxPainGuide, supportGuide, resistanceGuide } from "@/lib/metricGuides";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PanelRightOpen, PanelLeftOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchOIChange, fetchAlerts, clearAlerts, fetchStatus, fetchVRP, fetchTickers, api, completeUserKiteSession, userKiteLoginUrl } from "@/lib/api";
import { friendlyKiteConnectError } from "@/lib/kiteConnectError";
import { safeHttpUrl } from "@/lib/safeUrl";
import { isMarketQuiescent, EVENT_WARNING_MINUTE, applyMarketHoursFromStatus, getMarketOpenMinute, getMarketCloseMinute } from "@/lib/marketTimes";
import { connectSpotWS } from "@/lib/spotWs";
import { downloadOICsv } from "@/lib/csv";
import { toast } from "sonner";
import { useNotify } from "@/hooks/useNotify";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { useHugeShiftMonitor } from "@/hooks/useHugeShiftMonitor";
import { loadOISettings } from "@/lib/oiSettings";
import { playForAlert } from "@/lib/sounds";
import { Play, HelpCircle } from "lucide-react";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const INDEX_STEP = { NIFTY: 50, SENSEX: 100, BANKNIFTY: 100 };

/** Keep tracked indices in a stable canonical order (NIFTY → SENSEX → BANKNIFTY). */
function normalizeEnabledIndices(list) {
  const set = new Set(
    (Array.isArray(list) ? list : [])
      .map((x) => String(x || "").trim().toUpperCase().replace(/\s+/g, ""))
      .map((x) => (x === "BANKNIFTY" || x === "BANK" ? "BANKNIFTY" : x))
      .filter((x) => INDICES.includes(x)),
  );
  return INDICES.filter((i) => set.has(i));
}
const POLL_OPTIONS = [15000, 30000, 60000];
const DEFAULT_POLL_MS = 15000;
const DASHBOARD_PAGES = [
  { v: "oi-change", l: "OI Change" },
  { v: "open-interest", l: "Open Interest" },
  { v: "strike-table", l: "Strike Table" },
  { v: "sell-candidates", l: "Sell Candidates" },
  { v: "buildup", l: "Build-up" },
  { v: "positions", l: "Positions" },
  { v: "alerts", l: "Alerts" },
  { v: "activity", l: "Activity" },
  { v: "holidays", l: "Events" },
  { v: "straddle", l: "Straddle" },
  { v: "index-events", l: "Index Risk" },
  { v: "cas", l: "CAS" },
];
const PUBLIC_DEFAULT_PAGES = DASHBOARD_PAGES
  .filter((page) => !page.adminOnly && page.v !== "cas")
  .map((page) => page.v);
const ALL_DASHBOARD_PAGE_IDS = DASHBOARD_PAGES.map((page) => page.v);

function pageAllowed(id, { isAdmin, visiblePages, adminPages }) {
  if (isAdmin) {
    if (!Array.isArray(adminPages) || adminPages.length === 0) return true;
    return adminPages.includes(id);
  }
  return Array.isArray(visiblePages) && visiblePages.includes(id);
}
// Threshold on aggregate |PE - CE| change relative to base OI that triggers a
// frontend-side alert on each data-pull for the currently viewed timeframe.
const ALERT_INTENSITY = 0.35;
const ALERT_COOLDOWN_MS = 60000;
// User-configurable "OI change" toast threshold — fires when |PE change| OR
// |CE change| exceeds this percentage of the previous OI in the selected
// timeframe. Stored in localStorage so it survives reloads.
const CHANGE_ALERT_PCT_KEY = "oiChangeAlertPct";
const CHANGE_ALERT_PCT_DEFAULT = 5.0;
function loadChangeAlertPct() {
  try {
    const v = parseFloat(localStorage.getItem(CHANGE_ALERT_PCT_KEY) || "");
    return Number.isFinite(v) && v > 0 ? v : CHANGE_ALERT_PCT_DEFAULT;
  } catch { return CHANGE_ALERT_PCT_DEFAULT; }
}

const STRIKES_AROUND_KEY = "oiStrikesAround";
const STRIKES_AROUND_ALLOWED = [2, 5, 10, 15, 20, 25];
function loadStrikesAround() {
  try {
    const raw = localStorage.getItem(STRIKES_AROUND_KEY);
    if (raw === "all") return "all";
    const n = Number(raw);
    if (STRIKES_AROUND_ALLOWED.includes(n)) return n;
  } catch { /* noop */ }
  return 10;
}

function formatDayLabel(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatClock(iso, withSeconds = false) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
    });
  } catch {
    return "";
  }
}

// Format an absolute OI delta with adaptive units so tiny changes don't collapse to "+0.00L".
function formatDelta(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

// Minutes elapsed since today's NSE market open (admin market_open_ist), CLAMPED at
// configured close (market_close_ist). During market hours this returns the live
// open → now window; after close it caps at a full session so "Full Day"
// stays open–close. Before open (or on weekends/holidays), return the full
// prior session length — NEVER ~24h, which previously pulled yesterday's OI.
function minutesSinceMarketOpenIST() {
  const MARKET_OPEN_MIN = getMarketOpenMinute();
  const MARKET_CLOSE_MIN = getMarketCloseMinute();
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const s = parseInt(parts.find((p) => p.type === "second").value, 10);
  const nowMin = h * 60 + m + s / 60;
  const sessionLen = Math.max(1, MARKET_CLOSE_MIN - MARKET_OPEN_MIN);

  if (nowMin >= MARKET_OPEN_MIN && nowMin <= MARKET_CLOSE_MIN) {
    return Math.max(1, Math.ceil(nowMin - MARKET_OPEN_MIN));
  }
  // Pre-open / post-close / weekend: request a full session window. The backend
  // clamps lookback to the current (or last) session open anyway.
  return sessionLen;
}

// Turn a timeframe pill key into a concrete "minutes" value the API accepts.
function resolveMinutes(tf) {
  if (tf === "full") return Math.min(1440, minutesSinceMarketOpenIST());
  return Number(tf) || 15;
}

export default function Dashboard() {
  const [activeIndex, setActiveIndex] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState(15);
  const [current, setCurrent] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [status, setStatus] = useState(null);
  const [authState, setAuthState] = useState({ is_admin: false, is_guest: false, guest_name: null, admin_display_name: null });
  const [alerts, setAlerts] = useState([]);
  const [dataStatus, setDataStatus] = useState(null);
  const [strikesAround, setStrikesAround] = useState(loadStrikesAround);
  const [strikeRange, setStrikeRange] = useState({ min: null, max: null });
  const [credsOpen, setCredsOpen] = useState(false);
  const [morningRefreshOpen, setMorningRefreshOpen] = useState(false);
  const [telegramPrefsOpen, setTelegramPrefsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [flash, setFlash] = useState(false);
  const [expiries, setExpiries] = useState([]);
  const [expiriesMeta, setExpiriesMeta] = useState([]);
  const [expiriesNote, setExpiriesNote] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [replayFrame, setReplayFrame] = useState(null);
  // Show OI ON (default) → Sensibull-style stacked bars: solid base + striped increase / outlined
  // decrease overlay. Flip to OFF to see ONLY the signed delta change bars around a y=0 baseline.
  const [showOI, setShowOI] = useState(true);
  const [replayOpen, setReplayOpen] = useState(false);
  const [lastPulledAt, setLastPulledAt] = useState(null);
  const [lastUpdatedByIndex, setLastUpdatedByIndex] = useState({});
  const [lastPullChange, setLastPullChange] = useState(null); // { ce, pe, at }
  const [pulsePull, setPulsePull] = useState(false); // green flash on each fresh pull
  const [oiSettings, setOiSettings] = useState(loadOISettings());
  const [visiblePages, setVisiblePages] = useState(PUBLIC_DEFAULT_PAGES);
  const [adminVisiblePages, setAdminVisiblePages] = useState(ALL_DASHBOARD_PAGE_IDS);
  const [tabOrder, setTabOrder] = useState(() => loadTabOrder());
  const [tileOrder, setTileOrder] = useState(() => loadTileOrder());
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [hugeShift, setHugeShift] = useState(null);   // currently shown modal
  const hugeShiftQueueRef = useRef([]);                // queued shifts if multiple fire back-to-back
  const [activity, setActivity] = useState([]);       // unusual activity feed events
  const [activityFilter, setActivityFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("oi-change");
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("darkMode") === "1"; } catch { return false; }
  });
  const [compact, setCompact] = useState(() => {
    try {
      const stored = localStorage.getItem("compact");
      if (stored === "1" || stored === "0") return stored === "1";
    } catch { /* noop */ }
    // Phone only — laptops keep sidebar open so ATM / expiry / strikes stay one click away.
    try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; }
  });
  const [soundsOpen, setSoundsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRefreshKey, setUploadRefreshKey] = useState(0);
  const [rightPanelOpen, setRightPanelOpen] = useState(() => {
    try {
      const stored = localStorage.getItem("rightPanelOpen");
      if (stored === "1" || stored === "0") return stored === "1";
    } catch { /* noop */ }
    // Phones: keep chart full-width — side panel was crushing the layout.
    // Align with Tailwind md (min-width: 768px) → phone is max-width: 767px.
    try { return !window.matchMedia("(max-width: 767px)").matches; } catch { return true; }
  });
  const [infoTilesOpen, setInfoTilesOpen] = useState(() => {
    try {
      const stored = localStorage.getItem("oiInfoTilesOpen");
      if (stored === "1" || stored === "0") return stored === "1";
    } catch { /* noop */ }
    return true;
  });
  const [headerRail, setHeaderRail] = useState(() => {
    try {
      const stored = localStorage.getItem("oiHeaderRail");
      if (stored === "1" || stored === "0") return stored === "1";
    } catch { /* noop */ }
    // Default normal (tall colorful tiles) — slim is hard to read; toggle in View.
    return false;
  });
  const [slimStatusRail, setSlimStatusRail] = useState(() => {
    try {
      const stored = localStorage.getItem("oiSlimStatusRail");
      if (stored === "1" || stored === "0") return stored === "1";
    } catch { /* noop */ }
    return false;
  });
  const infoTilesAutoOpenRef = useRef(null);
  const [rightPanelView, setRightPanelView] = useState(() => {
    try { return localStorage.getItem("rightPanelView") || "alerts"; } catch { return "alerts"; }
  });
  const [isMobile, setIsMobile] = useState(() => {
    try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; }
  });
  const [replayJumpTs, setReplayJumpTs] = useState(null);
  const clearReplayJump = useCallback(() => setReplayJumpTs(null), []);
  const [vixSessionOpen, setVixSessionOpen] = useState(() => {
    try {
      const raw = localStorage.getItem("vixSessionOpen");
      if (!raw) return null;
      const { date, vix } = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if (date !== today) return null;
      return vix;
    } catch { return null; }
  });
  const seenActivityRef = useRef(new Set());          // dedupe key set per session
  const activeIndexRef = useRef(activeIndex);
  const [liveSpotPrices, setLiveSpotPrices] = useState({});
  const [tickerQuotes, setTickerQuotes] = useState({});
  // Warm cache for ALL enabled indices so switching NIFTY ↔ SENSEX is instant.
  const oiCacheRef = useRef({});          // index -> last /change payload
  const expiryByIndexRef = useRef({});    // index -> { list, meta, note, selected }
  const timeframeRef = useRef(timeframe);
  const selectedExpiryRef = useRef(selectedExpiry);
  const enabledIndicesRef = useRef(["NIFTY", "SENSEX", "BANKNIFTY"]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);

  // Force Sell Candidates panel to recompute every minute so scores stay fresh
  // even if the underlying OI snapshot only ticks every 30s.
  const [scTick, setScTick] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setScTick(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  // VRP (Volatility Risk Premium) — one per active index. Fetched on index
  // change and refreshed every 5 minutes (EOD data doesn't change intraday).
  const [vrp, setVrp] = useState(null);
  const fetchVrp = useCallback(async () => {
    try {
      const data = await fetchVRP(activeIndex, 30);
      setVrp(data);
    } catch (e) {
      console.error("fetchVRP failed", e);
    }
  }, [activeIndex]);
  useQuiescentAwarePolling(fetchVrp, 5 * 60_000, [fetchVrp, status?.market?.is_market_open], { status });

  const lastAlertIdRef = useRef(null);
  const lastLocalAlertRef = useRef(0);
  const { alarm, siren, push, requestPermission } = useNotify();

  // Poll status
  useEffect(() => {
    try { localStorage.setItem("rightPanelOpen", rightPanelOpen ? "1" : "0"); } catch (_) { /* noop */ }
  }, [rightPanelOpen]);
  useEffect(() => {
    try { localStorage.setItem("oiInfoTilesOpen", infoTilesOpen ? "1" : "0"); } catch (_) { /* noop */ }
  }, [infoTilesOpen]);
  useEffect(() => {
    try { localStorage.setItem("oiHeaderRail", headerRail ? "1" : "0"); } catch (_) { /* noop */ }
  }, [headerRail]);
  useEffect(() => {
    try { localStorage.setItem("oiSlimStatusRail", slimStatusRail ? "1" : "0"); } catch (_) { /* noop */ }
  }, [slimStatusRail]);

  // Weekday 15:15 IST — force-open holiday/FII/event tiles so next-day risk is visible.
  useEffect(() => {
    const check = () => {
      try {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            weekday: "short",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).formatToParts(new Date()).map((p) => [p.type, p.value]),
        );
        const wd = parts.weekday; // Mon..Sun
        if (wd === "Sat" || wd === "Sun") return;
        const minutes = Number(parts.hour) * 60 + Number(parts.minute);
        if (minutes < EVENT_WARNING_MINUTE) return;
        const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
        if (infoTilesAutoOpenRef.current === dayKey) return;
        let already = false;
        try { already = localStorage.getItem("oiInfoTilesAutoOpenDay") === dayKey; } catch { /* noop */ }
        if (already) {
          infoTilesAutoOpenRef.current = dayKey;
          return;
        }
        infoTilesAutoOpenRef.current = dayKey;
        try { localStorage.setItem("oiInfoTilesAutoOpenDay", dayKey); } catch { /* noop */ }
        setInfoTilesOpen(true);
      } catch { /* noop */ }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("rightPanelView", rightPanelView); } catch (_) { /* noop */ }
  }, [rightPanelView]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  useEffect(() => {
    if (isMobile) setCompact(true);
  }, [isMobile]);

  // On phones, never keep the side panel open by default — it was leaving a narrow
  // Alerts/Suggestion strip and a blank chart area.
  // On desktop, respect the saved preference.
  const showRightPanel = isMobile
    ? false
    : rightPanelOpen;
  // Credentials / kite_ok beat brief mode=offline flaps (Positions + CAS + side panel).
  const kiteLiveConnected =
    status?.mode === "kite"
    || !!status?.has_kite_credentials
    || !!status?.kite_ok;
  const startUserKite = async () => {
    try {
      const data = await userKiteLoginUrl();
      const href = safeHttpUrl(data?.login_url);
      if (href) window.location.assign(href);
      else toast.error("Kite login URL unavailable");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start Kite login");
    }
  };
  const openKiteCreds = authState.is_admin ? () => setCredsOpen(true) : startUserKite;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const qs = new URLSearchParams(window.location.search);
    const token = qs.get("request_token");
    if (!token || authState.is_admin || !authState.is_guest) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await completeUserKiteSession(token);
        if (cancelled) return;
        toast.success(`Zerodha connected${data?.kite_user_id ? ` · ${data.kite_user_id}` : ""}`);
        qs.delete("request_token");
        qs.delete("status");
        qs.delete("action");
        const next = qs.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
        setActiveTab("positions");
      } catch (e) {
        if (!cancelled) toast.error(friendlyKiteConnectError(e?.response?.data?.detail || e.message || "Could not complete Kite login"));
      }
    })();
    return () => { cancelled = true; };
  }, [authState.is_admin, authState.is_guest]);

  useEffect(() => {
    const onSaved = (e) => {
      const settings = e?.detail;
      if (Array.isArray(settings?.visible_pages)) setVisiblePages(settings.visible_pages);
      if (Array.isArray(settings?.admin_visible_pages)) setAdminVisiblePages(settings.admin_visible_pages);
    };
    window.addEventListener("oi-settings-saved", onSaved);
    return () => window.removeEventListener("oi-settings-saved", onSaved);
  }, []);

  useEffect(() => {
    // Connect WebSocket (spot). The WS wrapper will itself defer connects
    // during quiescent periods and auto-reconnect on reopen.
    const conn = connectSpotWS((message) => {
      if (message?.type !== "spot" || !Array.isArray(message.tickers)) return;
      const nextPrices = {};
      message.tickers.forEach((ticker) => {
        if (ticker?.index) nextPrices[ticker.index] = ticker.price;
      });
      setLiveSpotPrices((prev) => ({ ...prev, ...nextPrices }));
      const match = message.tickers.find((ticker) => ticker.index === activeIndexRef.current);
      if (!match) return;
      setCurrent((prevCurrent) => {
        if (!prevCurrent) return prevCurrent;
        return {
          ...prevCurrent,
          price: match.price != null ? match.price : prevCurrent.price,
          atm: match.atm != null ? match.atm : prevCurrent.atm,
          // Do NOT overwrite OI snapshot timestamp with spot-tick time —
          // that remounted the chart every tick and made "OI pulled" lag/lie.
        };
      });
    });
    return () => conn.stop();
  }, [status]);

  const tabOn = useCallback(
    (id) => pageAllowed(id, {
      isAdmin: !!authState.is_admin,
      visiblePages,
      adminPages: adminVisiblePages,
    }),
    [authState.is_admin, visiblePages, adminVisiblePages],
  );

  useEffect(() => {
    const allowedTabs = orderPages(DASHBOARD_PAGES, tabOrder)
      .filter((page) => {
        if (page.adminOnly && !authState.is_admin) return false;
        return tabOn(page.v);
      })
      .map((page) => page.v);
    if (allowedTabs.length === 0) return;
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [authState.is_admin, activeTab, visiblePages, adminVisiblePages, tabOrder, tabOn]);

  const dashboardTabs = useMemo(
    () =>
      orderPages(DASHBOARD_PAGES, tabOrder).filter(
        (t) => (!t.adminOnly || authState.is_admin) && tabOn(t.v),
      ),
    [tabOrder, authState.is_admin, tabOn],
  );

  const handleReorderTabs = useCallback(
    (dragId, dropId) => {
      setTabOrder((prev) => {
        const base = orderPages(DASHBOARD_PAGES, prev).map((p) => p.v);
        const next = moveIdBefore(base, dragId, dropId);
        saveTabOrder(next);
        return next;
      });
    },
    [],
  );

  const handleFavoriteTab = useCallback((id) => {
    setTabOrder((prev) => {
      const base = orderPages(DASHBOARD_PAGES, prev).map((p) => p.v);
      const next = pinIdFirst(base, id);
      saveTabOrder(next);
      return next;
    });
  }, []);

  const handleMoveTab = useCallback((id, delta) => {
    setTabOrder((prev) => {
      const base = orderPages(DASHBOARD_PAGES, prev).map((p) => p.v);
      const next = moveIdByOffset(base, id, delta);
      saveTabOrder(next);
      return next;
    });
  }, []);

  const handleReorderTiles = useCallback((dragId, dropId) => {
    setTileOrder((prev) => {
      const base = (prev && prev.length ? prev : DEFAULT_TILE_IDS).slice();
      for (const tid of DEFAULT_TILE_IDS) {
        if (!base.includes(tid)) base.push(tid);
      }
      const next = moveIdBefore(base, dragId, dropId);
      saveTileOrder(next);
      return next;
    });
  }, []);

  const handleFavoriteTile = useCallback((id) => {
    setTileOrder((prev) => {
      const base = (prev && prev.length ? prev : DEFAULT_TILE_IDS).slice();
      for (const tid of DEFAULT_TILE_IDS) {
        if (!base.includes(tid)) base.push(tid);
      }
      const next = pinIdFirst(base, id);
      saveTileOrder(next);
      return next;
    });
  }, []);

  const handleMoveTile = useCallback((id, delta) => {
    setTileOrder((prev) => {
      const base = (prev && prev.length ? prev : DEFAULT_TILE_IDS).slice();
      for (const tid of DEFAULT_TILE_IDS) {
        if (!base.includes(tid)) base.push(tid);
      }
      const next = moveIdByOffset(base, id, delta);
      saveTileOrder(next);
      return next;
    });
  }, []);

  const openHolidaysTab = useCallback(() => setActiveTab("holidays"), []);
  const openIndexEventsTab = useCallback(() => setActiveTab("index-events"), []);
  const showImpactTile = tabOn("index-events");

  // Dark mode -> toggle html.dark class + persist
  useEffect(() => {
    const el = document.documentElement;
    if (darkMode) el.classList.add("dark"); else el.classList.remove("dark");
    try { localStorage.setItem("darkMode", darkMode ? "1" : "0"); } catch (_) { /* noop */ }
  }, [darkMode]);
  useEffect(() => {
    try { localStorage.setItem("compact", compact ? "1" : "0"); } catch (_) { /* noop */ }
  }, [compact]);
  // Ctrl/Cmd + B toggles compact sidebar
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setCompact((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Capture the FIRST VIX value we see today as the session baseline so we can
  // compute today's % change accurately.
  useEffect(() => {
    const v = current?.vix;
    if (v == null || v <= 0 || vixSessionOpen) return;
    const today = new Date().toISOString().slice(0, 10);
    setVixSessionOpen(v);
    try { localStorage.setItem("vixSessionOpen", JSON.stringify({ date: today, vix: v })); } catch (_) { /* noop */ }
  }, [current?.vix, vixSessionOpen]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchStatus();
      applyMarketHoursFromStatus(s);
      setStatus(s);
    } catch (e) {
      console.error("loadStatus failed", e);
    }
    // Auth state is owned by AuthGate / Header — do not re-fetch on every OI poll.
  }, []);

  const [historyReady, setHistoryReady] = useState(true);
  const [availableHistoryMin, setAvailableHistoryMin] = useState(0);
  const [changeBundle, setChangeBundle] = useState(null);
  const [expiryReady, setExpiryReady] = useState(false);
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
  const [enabledIndices, setEnabledIndices] = useState(INDICES);
  // Admin Alert Settings focus — OI toasts/sounds only for these indices.
  // null = not loaded yet → do not client-suppress (backend /alerts already scopes).
  // A hardcoded ["NIFTY"] default used to swallow SENSEX-focus days while still
  // advancing the toast cursor, so alerts looked "dead" forever after.
  const [alertEnabledIndices, setAlertEnabledIndices] = useState(null);
  const alertEnabledRef = useRef(alertEnabledIndices);
  useEffect(() => {
    alertEnabledRef.current = alertEnabledIndices;
  }, [alertEnabledIndices]);
  const indexInAlertFocus = useCallback((idx) => {
    const list = alertEnabledRef.current;
    if (list == null) return true; // settings not loaded — allow
    if (!Array.isArray(list) || list.length === 0) return true;
    const u = String(idx || "").toUpperCase();
    return list.some((x) => String(x).toUpperCase() === u);
  }, []);
  const [oiLoading, setOiLoading] = useState(false);
  const [showStrikeRange, setShowStrikeRange] = useState(false);
  const [showWriterDefense, setShowWriterDefense] = useState(true);
  const [showSuggestion, setShowSuggestion] = useState(true);
  const [showChartSignals, setShowChartSignals] = useState(false);
  const [deskAiShow, setDeskAiShow] = useState(true);
  const [deskAiAsk, setDeskAiAsk] = useState(true);
  const [deskAiPositions, setDeskAiPositions] = useState(false);
  const [deskAiRadar, setDeskAiRadar] = useState(true);
  const [deskAiAdmin, setDeskAiAdmin] = useState(true);
  const [deskAiPublic, setDeskAiPublic] = useState(false);
  const [deskAiOnGrid, setDeskAiOnGrid] = useState(() => {
    try {
      const v = localStorage.getItem("oiDeskAiOnGrid");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch { /* noop */ }
    return true;
  });
  const toggleDeskAiOnGrid = useCallback((on) => {
    setDeskAiOnGrid(!!on);
    try { localStorage.setItem("oiDeskAiOnGrid", on ? "1" : "0"); } catch { /* noop */ }
  }, []);
  const openDeskAiPanel = useCallback(() => {
    const phone = (() => {
      try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; }
    })();
    if (phone) {
      toggleDeskAiOnGrid(true);
      window.dispatchEvent(new CustomEvent("oi-desk-ai-expand"));
      setTimeout(() => {
        document.getElementById("desk-ai-bar")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
      return;
    }
    setRightPanelView("desk-ai");
    setRightPanelOpen(true);
  }, [toggleDeskAiOnGrid]);
  // Wall-clock timestamp of the last /change response — used together with a
  // 1s ticker to render a LIVE countdown in the "warming up" banner so users
  // can see the exact time remaining until a true N-min compare unlocks.
  const availableFetchedAtRef = useRef(Date.now());
  const oiReqGenRef = useRef(0);
  const [warmingTick, setWarmingTick] = useState(Date.now());
  useEffect(() => {
    enabledIndicesRef.current = enabledIndices.length ? enabledIndices : INDICES;
  }, [enabledIndices]);
  useEffect(() => {
    if (historyReady) return undefined;
    const id = setInterval(() => setWarmingTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [historyReady]);

  const applyOiPayload = useCallback((data, { pulse = true } = {}) => {
    if (!data?.current) return;
    setCurrent(data.current);
    setPrevious(data.previous);
    setHistoryReady(data.history_ready !== false);
    setAvailableHistoryMin(Number(data.available_history_minutes || 0));
    availableFetchedAtRef.current = Date.now();
    setDataStatus(data.data_status || null);
    setChangeBundle({
      current: data.current,
      also_windows: data.also_windows || {},
      at: Date.now(),
    });
    setLastPulledAt(data.current?.timestamp || new Date().toISOString());
    if (pulse) {
      setPulsePull(true);
      setTimeout(() => setPulsePull(false), 600);
    }
  }, []);

  const istToday = useCallback(() => {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, []);

  const ensureExpiryForIndex = useCallback(async (idx, { force = false } = {}) => {
    const today = istToday();
    const cached = expiryByIndexRef.current[idx];
    const selectedPast = !!(cached?.selected && String(cached.selected).slice(0, 10) < today);
    const selectedMissing = !!(
      cached?.selected
      && Array.isArray(cached.list)
      && cached.list.length
      && !cached.list.includes(cached.selected)
    );
    const staleDay = !!(cached?.asOf && cached.asOf !== today);
    if (!force && !selectedPast && !selectedMissing && !staleDay && (cached?.selected || cached?.fetched)) {
      return cached;
    }
    try {
      const r = await api.get(`/expiries/${idx}`);
      const list = r.data.expiries || [];
      const meta = r.data.expiries_meta || [];
      const note = r.data.note || null;
      const serverSel = r.data.selected && list.includes(r.data.selected) ? r.data.selected : null;
      // Keep a still-valid user/cache pick; otherwise take server nearest (weekly roll).
      let selected = serverSel || list[0] || null;
      if (
        cached?.selected
        && list.includes(cached.selected)
        && String(cached.selected).slice(0, 10) >= today
      ) {
        selected = cached.selected;
      }
      const entry = { list, meta, note, selected, fetched: true, asOf: today };
      expiryByIndexRef.current[idx] = entry;
      if (idx === activeIndexRef.current) {
        setExpiries(list);
        setExpiriesMeta(meta);
        setExpiriesNote(note);
        setSelectedExpiry(selected);
        setExpiryReady(true);
      }
      return entry;
    } catch (e) {
      console.error(`loadExpiries(${idx}) failed`, e);
      const entry = { list: [], meta: [], note: null, selected: null, fetched: true, asOf: today };
      expiryByIndexRef.current[idx] = entry;
      return entry;
    }
  }, [istToday]);

  // Poll OI for ALL enabled indices in the background; UI updates only for the active tab.
  const oiInflightRef = useRef(false);
  const loadOI = useCallback(async () => {
    if (oiInflightRef.current) return; // never stack overlapping multi-index waves
    const indices = enabledIndicesRef.current?.length ? enabledIndicesRef.current : INDICES;
    const active = activeIndexRef.current;
    // Active tab still waits for its expiry picker to settle (avoids cross-index expiry).
    if (active && !expiryReady && !expiryByIndexRef.current[active]?.selected) return;

    const gen = ++oiReqGenRef.current;
    oiInflightRef.current = true;
    setOiLoading(true);
    const also = [
      ...(oiSettings.hugeShiftWindows || [1, 3, 5]),
      "session", // whole-day bias (9:15 → now) — independent of timeframe pill
    ].join(",");
    const minutes = resolveMinutes(timeframeRef.current);

    try {
      // Prefetch expiries for every enabled index (cheap + cached after first hit).
      await Promise.all(indices.map((idx) => ensureExpiryForIndex(idx)));

      const fetches = indices.map(async (idx) => {
        const exp =
          idx === active
            ? (selectedExpiryRef.current || expiryByIndexRef.current[idx]?.selected || undefined)
            : (expiryByIndexRef.current[idx]?.selected || undefined);
        try {
          const data = await fetchOIChange(idx, minutes, {
            expiry: exp || undefined,
            also,
          });
          oiCacheRef.current[idx] = {
            current: data.current,
            previous: data.previous,
            history_ready: data.history_ready,
            available_history_minutes: data.available_history_minutes,
            data_status: data.data_status,
            also_windows: data.also_windows || {},
            expiry: exp || null,
            at: Date.now(),
          };
          if (data.current?.timestamp) {
            setLastUpdatedByIndex((prev) => (
              prev[idx] === data.current.timestamp
                ? prev
                : { ...prev, [idx]: data.current.timestamp }
            ));
          }
          return { idx, data, ok: true };
        } catch (e) {
          console.error(`loadOI(${idx}) failed`, e);
          return { idx, ok: false };
        }
      });

      const results = await Promise.all(fetches);
      if (gen !== oiReqGenRef.current) return;

      const activeRow = results.find((r) => r.ok && r.idx === activeIndexRef.current);
      if (activeRow?.data) {
        applyOiPayload(activeRow.data, { pulse: true });
      }
    } catch (e) {
      if (gen !== oiReqGenRef.current) return;
      console.error("loadOI failed", e);
    } finally {
      oiInflightRef.current = false;
      if (gen === oiReqGenRef.current) setOiLoading(false);
    }
  }, [expiryReady, oiSettings.hugeShiftWindows, ensureExpiryForIndex, applyOiPayload]);

  // Load expiries for the active index (hydrate from warm cache when available).
  useEffect(() => {
    let cancelled = false;
    const cached = expiryByIndexRef.current[activeIndex];
    if (cached?.selected || cached?.fetched) {
      setExpiries(cached.list || []);
      setExpiriesMeta(cached.meta || []);
      setExpiriesNote(cached.note || null);
      setSelectedExpiry(cached.selected || null);
      setExpiryReady(true);
    } else {
      setExpiryReady(false);
      setSelectedExpiry(null);
    }
    ensureExpiryForIndex(activeIndex, { force: true }).then((entry) => {
      if (cancelled || !entry) return;
      setExpiries(entry.list || []);
      setExpiriesMeta(entry.meta || []);
      setExpiriesNote(entry.note || null);
      setSelectedExpiry(entry.selected || null);
      setExpiryReady(true);
    }).catch((e) => {
      console.error("loadExpiries failed", e);
      if (!cancelled) setExpiryReady(true); // allow unscoped fetch as fallback
    });
    return () => { cancelled = true; };
  }, [activeIndex, ensureExpiryForIndex]);

  const handleChangeExpiry = async (exp) => {
    setSelectedExpiry(exp);
    const prev = expiryByIndexRef.current[activeIndex] || {};
    expiryByIndexRef.current[activeIndex] = { ...prev, selected: exp, fetched: true };
    try {
      await api.post(`/expiries/${activeIndex}`, { expiry: exp });
    } catch (e) {
      console.error("setExpiry failed", e);
    }
  };

  // Poll alerts — toast/sound for new backend alerts regardless of which
  // dashboard tab is open (Positions, Straddle, etc.). Backend /alerts already
  // filters by admin alert-focus indices; do not re-filter here or a stale
  // client default can skip every toast while burning the cursor.
  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts();
      const list = data.alerts || [];
      setAlerts(list);

      if (!list.length) {
        // Empty poll must not leave cursor at null — otherwise the first real
        // alert looks like "first hydrate" and is silently swallowed.
        if (lastAlertIdRef.current === null) lastAlertIdRef.current = "";
        return;
      }

      const newestId = list[0].created_at;
      if (lastAlertIdRef.current === null) {
        // First non-empty hydrate — seed cursor only, no historical toasts.
        lastAlertIdRef.current = newestId;
        return;
      }
      if (newestId === lastAlertIdRef.current) return;

      const prevId = lastAlertIdRef.current;
      lastAlertIdRef.current = newestId;

      // Surface every new alert since last poll (newest last → toast newest on top).
      const fresh = [];
      for (const a of list) {
        if (prevId && a.created_at === prevId) break;
        // After clear/empty sentinel (""), treat entire current page as new
        // but cap so we do not spam a huge backlog.
        fresh.push(a);
        if (fresh.length >= 5) break;
      }
      for (const a of fresh.reverse()) {
        const isBullish = a.direction?.toLowerCase().includes("bullish") || a.severity === "info";
        const toastFn = isBullish ? toast.success : toast.error;
        toastFn(a.message || `OI alert · ${a.index}`, {
          description: [
            a.index,
            a.direction,
            a.price != null ? `Price ${Number(a.price).toFixed(2)}` : null,
            a.atm != null ? `ATM ${a.atm}` : null,
          ].filter(Boolean).join(" · "),
          duration: 8000,
        });
        playForAlert("reversal");
        push(`OI Reversal · ${a.index}`, a.direction || a.message || "OI alert");
      }
      if (fresh.length) {
        setFlash(true);
        setTimeout(() => setFlash(false), 1800);
      }
    } catch (e) {
      console.error("loadAlerts failed", e);
    }
  }, [push]);

  const loadTickers = useCallback(async () => {
    try {
      const data = await fetchTickers();
      const map = {};
      for (const t of data?.tickers || []) {
        if (t?.index) map[t.index] = t;
      }
      setTickerQuotes(map);
    } catch (e) {
      console.error("loadTickers failed", e);
    }
  }, []);

  // Keep Alerts UI visibility in a ref so the poller does not remount on tab switches.
  const alertViewRef = useRef({ activeTab, rightPanelView, showRightPanel });
  useEffect(() => {
    alertViewRef.current = { activeTab, rightPanelView, showRightPanel };
  }, [activeTab, rightPanelView, showRightPanel]);

  // ---- Straddle + Positions poll intervals (from API settings) ----
  const [straddlePollMs, setStraddlePollMs] = useState(15000); // dense chart default 15s
  const [positionsPollMs, setPositionsPollMs] = useState(30000);

  // Prefetch expiries for every enabled index once settings land (keeps SENSEX warm on NIFTY tab).
  useEffect(() => {
    const indices = enabledIndices.length ? enabledIndices : INDICES;
    let cancelled = false;
    (async () => {
      for (const idx of indices) {
        if (cancelled) return;
        await ensureExpiryForIndex(idx);
      }
    })();
    return () => { cancelled = true; };
  }, [enabledIndices, ensureExpiryForIndex]);

  const applyDeskAi = useCallback((d) => {
    if (!d) return;
    if (typeof d.desk_ai_show === "boolean") setDeskAiShow(d.desk_ai_show);
    if (typeof d.desk_ai_ask === "boolean") setDeskAiAsk(d.desk_ai_ask);
    if (typeof d.desk_ai_positions === "boolean") setDeskAiPositions(d.desk_ai_positions);
    if (typeof d.desk_ai_radar === "boolean") setDeskAiRadar(d.desk_ai_radar);
    if (typeof d.desk_ai_admin === "boolean") setDeskAiAdmin(d.desk_ai_admin);
    if (typeof d.desk_ai_public === "boolean") setDeskAiPublic(d.desk_ai_public);
  }, []);

  const patchDeskAi = useCallback(async (patch) => {
    try {
      const { data } = await api.post("/settings", patch);
      applyDeskAi(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save Desk AI");
    }
  }, [applyDeskAi]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get("/settings");
      if (res.data) {
        applyMarketHoursFromStatus(res.data);
        if (typeof res.data.oi_poll_interval_seconds === "number") {
          const next = res.data.oi_poll_interval_seconds * 1000;
          setPollMs((prev) => (prev === next ? prev : next));
        }
        if (res.data.straddle_poll_interval_seconds) {
          const next = res.data.straddle_poll_interval_seconds * 1000;
          setStraddlePollMs((prev) => (prev === next ? prev : next));
        }
        if (typeof res.data.positions_poll_interval_seconds === "number") {
          const next = res.data.positions_poll_interval_seconds * 1000;
          setPositionsPollMs((prev) => (prev === next ? prev : next));
        }
        if (Array.isArray(res.data.visible_pages)) {
          setVisiblePages(res.data.visible_pages);
        }
        if (Array.isArray(res.data.admin_visible_pages)) {
          setAdminVisiblePages(res.data.admin_visible_pages);
        }
        if (Array.isArray(res.data.enabled_indices) && res.data.enabled_indices.length) {
          setEnabledIndices(res.data.enabled_indices);
        }
        if (Array.isArray(res.data.alert_enabled_indices) && res.data.alert_enabled_indices.length) {
          setAlertEnabledIndices(res.data.alert_enabled_indices);
        }
        if (typeof res.data.show_strike_range === "boolean") {
          setShowStrikeRange(res.data.show_strike_range);
        }
        if (typeof res.data.show_writer_defense === "boolean") {
          setShowWriterDefense(res.data.show_writer_defense);
        }
        if (typeof res.data.show_suggestion === "boolean") {
          setShowSuggestion(res.data.show_suggestion);
        }
        if (typeof res.data.show_chart_signals === "boolean") {
          setShowChartSignals(res.data.show_chart_signals);
        }
        applyDeskAi(res.data);
      }
    } catch (e) {
      console.error("Failed to fetch settings", e);
    }
  }, [applyDeskAi]);

  // Boot: pull /config once so poll interval is correct before first OI tick.
  useEffect(() => {
    api.get("/config").then((r) => {
      const d = r.data || {};
      if (typeof d.oi_poll_interval_seconds === "number") {
        setPollMs(d.oi_poll_interval_seconds * 1000);
      } else if (typeof d.poll_interval_seconds === "number") {
        setPollMs(d.poll_interval_seconds * 1000);
      }
      if (typeof d.straddle_poll_interval_seconds === "number") {
        setStraddlePollMs(d.straddle_poll_interval_seconds * 1000);
      }
      if (typeof d.positions_poll_interval_seconds === "number") {
        setPositionsPollMs(d.positions_poll_interval_seconds * 1000);
      }
      if (Array.isArray(d.enabled_indices) && d.enabled_indices.length) {
        setEnabledIndices(d.enabled_indices);
      }
      if (Array.isArray(d.alert_enabled_indices) && d.alert_enabled_indices.length) {
        setAlertEnabledIndices(d.alert_enabled_indices);
      }
      if (Array.isArray(d.visible_pages)) {
        setVisiblePages(d.visible_pages);
      }
      if (Array.isArray(d.admin_visible_pages)) {
        setAdminVisiblePages(d.admin_visible_pages);
      }
      if (typeof d.show_strike_range === "boolean") {
        setShowStrikeRange(d.show_strike_range);
      }
      if (typeof d.show_writer_defense === "boolean") {
        setShowWriterDefense(d.show_writer_defense);
      }
      if (typeof d.show_suggestion === "boolean") {
        setShowSuggestion(d.show_suggestion);
      }
      if (typeof d.show_chart_signals === "boolean") {
        setShowChartSignals(d.show_chart_signals);
      }
      applyDeskAi(d);
    }).catch(() => { /* ignore — settings poll will retry */ });
  }, [applyDeskAi]);

  // Auth state — once on mount + every 60s (broadcast so Header/Sidebar don't re-poll).
  useEffect(() => {
    let cancelled = false;
    const refreshAuth = async () => {
      try {
        const { data } = await api.get("/auth/state");
        if (cancelled) return;
        setAuthState(data);
        try {
          window.dispatchEvent(new CustomEvent("oi-admin-auth-state", { detail: data }));
        } catch (_) { /* noop */ }
      } catch (_) { /* ignore */ }
    };
    refreshAuth();
    const id = setInterval(refreshAuth, 60_000);
    const onState = (e) => {
      if (!cancelled && e?.detail) setAuthState(e.detail);
    };
    window.addEventListener("oi-admin-auth-state", onState);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("oi-admin-auth-state", onState);
    };
  }, []);

  useQuiescentAwarePolling(fetchSettings, 60000, [fetchSettings, status?.market?.is_market_open], { status, dedupeKey: "dash-settings" });

  useQuiescentAwarePolling(loadStatus, Math.max(pollMs, 30000), [loadStatus, pollMs, status?.market?.is_market_open], { status, dedupeKey: "dash-status" });
  useQuiescentAwarePolling(loadOI, pollMs, [loadOI, pollMs, status?.market?.is_market_open, expiryReady], { status, dedupeKey: "dash-oi" });
  // Force an IMMEDIATE refetch whenever the user picks a different timeframe,
  // index, or expiry. `useQuiescentAwarePolling` only fires the callback on
  // the FIRST mount, so without this the chart would wait up to `pollMs`
  // (15 s by default) before showing the new selection's data.
  const oiCtxRef = useRef({ timeframe, activeIndex, selectedExpiry, expiryReady });
  useEffect(() => {
    const prev = oiCtxRef.current;
    if (prev.timeframe === timeframe && prev.activeIndex === activeIndex && prev.selectedExpiry === selectedExpiry && prev.expiryReady === expiryReady) return;
    oiCtxRef.current = { timeframe, activeIndex, selectedExpiry, expiryReady };
    if (expiryReady) loadOI();
  }, [timeframe, activeIndex, selectedExpiry, expiryReady, loadOI]);
  useQuiescentAwarePolling(loadTickers, 60000, [loadTickers, status?.market?.is_market_open], { status, dedupeKey: "dash-tickers" });
  useQuiescentAwarePolling(
    async () => {
      // During market hours always poll + toast — Positions / Straddle / any tab.
      // Off-hours only refresh when the Alerts UI is open (avoid idle spam).
      const marketClosed = status?.market?.is_market_open === false;
      if (!marketClosed) {
        await loadAlerts();
        return;
      }
      const v = alertViewRef.current;
      const viewingAlerts =
        v.activeTab === "alerts" || (v.showRightPanel && v.rightPanelView === "alerts");
      if (viewingAlerts) await loadAlerts();
    },
    5000,
    [loadAlerts, status?.market?.is_market_open],
    { status, dedupeKey: "dash-alerts" },
  );

  // When index changes, hydrate from warm cache immediately so the chart never goes cold.
  const prevIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (prevIndexRef.current === activeIndex) return;
    prevIndexRef.current = activeIndex;
    setStrikeRange({ min: null, max: null });
    const cached = oiCacheRef.current[activeIndex];
    if (cached?.current) {
      applyOiPayload(cached, { pulse: false });
    } else {
      setChangeBundle(null);
    }
  }, [activeIndex, applyOiPayload]);

  // If enabled_indices no longer includes activeIndex, switch to the first enabled.
  useEffect(() => {
    if (enabledIndices.length && !enabledIndices.includes(activeIndex)) {
      setActiveIndex(enabledIndices[0]);
    }
  }, [enabledIndices, activeIndex]);

  // Once fresh snapshot arrives, initialise strike range to ATM±strikesAround
  // (or full chain). Strike Range alone drives the chart window.
  useEffect(() => {
    if (!current?.strikes?.length) return;
    if (strikeRange.min != null && strikeRange.max != null) return;
    const sorted = [...current.strikes].sort((a, b) => a.strike - b.strike);
    if (strikesAround === "all") {
      setStrikeRange({ min: sorted[0].strike, max: sorted[sorted.length - 1].strike });
      return;
    }
    const atm = current.atm;
    const atmIdx = sorted.findIndex((s) => s.strike === atm);
    if (atmIdx < 0) {
      setStrikeRange({ min: sorted[0].strike, max: sorted[sorted.length - 1].strike });
      return;
    }
    const n = Number(strikesAround) || 10;
    const lo = Math.max(0, atmIdx - n);
    const hi = Math.min(sorted.length - 1, atmIdx + n);
    setStrikeRange({ min: sorted[lo].strike, max: sorted[hi].strike });
  }, [current, strikeRange.min, strikeRange.max, strikesAround]);

  // Chart window = Strike Range only (ATM quick-picks rewrite min/max).
  const filteredCurrent = useMemo(() => {
    if (!current) return null;
    let strikes = [...current.strikes].sort((a, b) => a.strike - b.strike);
    if (strikeRange.min != null && strikeRange.max != null && strikeRange.min !== "" && strikeRange.max !== "") {
      const lo = Math.min(Number(strikeRange.min), Number(strikeRange.max));
      const hi = Math.max(Number(strikeRange.min), Number(strikeRange.max));
      strikes = strikes.filter((s) => s.strike >= lo && s.strike <= hi);
    }
    return { ...current, strikes };
  }, [current, strikeRange]);

  const handleToggleNotif = async () => {
    const perm = await requestPermission();
    setNotifEnabled(perm === "granted");
    if (perm === "granted") toast.success("Desktop notifications enabled");
    else if (perm === "denied") toast.error("Notifications blocked by browser");
  };

  const handleClearAlerts = async () => {
    await clearAlerts();
    setAlerts([]);
    // Sentinel (not null): next real alert must toast, not look like first hydrate.
    lastAlertIdRef.current = "";
    toast.success("Alerts cleared");
  };

  const applyStrikesAround = useCallback((n) => {
    setStrikesAround(n);
    try {
      localStorage.setItem(STRIKES_AROUND_KEY, String(n));
    } catch { /* noop */ }
    if (!current?.strikes?.length) return;
    const sorted = [...current.strikes].sort((a, b) => a.strike - b.strike);
    if (n === "all") {
      setStrikeRange({ min: sorted[0].strike, max: sorted[sorted.length - 1].strike });
      return;
    }
    const atm = current.atm;
    const atmIdx = sorted.findIndex((s) => s.strike === atm);
    if (atmIdx < 0) {
      setStrikeRange({ min: sorted[0].strike, max: sorted[sorted.length - 1].strike });
      return;
    }
    const count = Number(n) || 10;
    const lo = Math.max(0, atmIdx - count);
    const hi = Math.min(sorted.length - 1, atmIdx + count);
    setStrikeRange({ min: sorted[lo].strike, max: sorted[hi].strike });
  }, [current]);

  const handleStrikeRangeChange = useCallback((next) => {
    setStrikeRange(next);
    // Manual range edit → leave ATM pill highlighting alone but chart follows range.
  }, []);

  const handleReset = () => {
    applyStrikesAround(10);
  };

  const changeSummary = useMemo(() => {
    if (!filteredCurrent || !previous) return null;
    const prevMap = new Map();
    (previous.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    let ce = 0, pe = 0, baseCE = 0, basePE = 0;
    for (const s of filteredCurrent.strikes) {
      const p = prevMap.get(s.strike);
      if (!p) continue;
      ce += s.ce_oi - p.ce_oi;
      pe += s.pe_oi - p.pe_oi;
      baseCE += p.ce_oi || 0;
      basePE += p.pe_oi || 0;
    }
    const denom = (baseCE + basePE) || 1;
    const rawIntensity = Math.abs(pe - ce) / denom;
    const intensity = Math.min(1, rawIntensity * 20);
    // Percentage change vs baseline for CE and PE separately — used by the
    // configurable Change Alert toast so the user can set "notify me when CE
    // or PE OI moves >= X %".
    const cePct = baseCE > 0 ? (ce / baseCE) * 100 : 0;
    const pePct = basePE > 0 ? (pe / basePE) * 100 : 0;
    return { ce, pe, cePct, pePct, baseCE, basePE, prevAt: previous?.timestamp, intensity, bullish: pe - ce >= 0 };
  }, [filteredCurrent, previous]);

  // Whole-day bias: session open (≈9:15 IST) → latest snapshot.
  // Independent of the timeframe pill so NIFTY/SENSEX/BANKNIFTY each show
  // their own day bias with the same methodology.
  const dayBiasSummary = useMemo(() => {
    const sessPrev = changeBundle?.also_windows?.session?.previous;
    if (!filteredCurrent || !sessPrev) return null;
    const prevMap = new Map();
    (sessPrev.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    let ce = 0, pe = 0;
    for (const s of filteredCurrent.strikes || []) {
      const p = prevMap.get(s.strike);
      if (!p) continue;
      ce += (s.ce_oi || 0) - (p.ce_oi || 0);
      pe += (s.pe_oi || 0) - (p.pe_oi || 0);
    }
    const total = Math.abs(ce) + Math.abs(pe) || 1;
    const net = pe - ce;
    const intensity = Math.min(1, Math.abs(net) / total);
    return {
      ce,
      pe,
      intensity,
      bullish: net >= 0,
      minutes: changeBundle?.also_windows?.session?.minutes || null,
      prevAt: sessPrev.timestamp,
      asOf: filteredCurrent.timestamp,
    };
  }, [filteredCurrent, changeBundle]);

  // Frontend-side alert engine: fires a toast + browser notification whenever
  // the aggregated CE / PE change for the CURRENT timeframe crosses a strong
  // intensity threshold. Cooldown prevents repeated alerts on every 30s pull
  // while the same condition persists.
  const tfLabelMap = {
    1: "1 min", 3: "3 mins", 5: "5 mins", 10: "10 mins", 15: "15 mins",
    30: "30 mins", 60: "1 Hr", 120: "2 Hrs", 180: "3 Hrs", full: "Full Day",
  };
  const timeframeLabel = tfLabelMap[timeframe] || `${timeframe} min`;

  // Human-readable start-of-window label used for the mini time slider.
  const windowStartLabel = useMemo(() => {
    if (timeframe === "full") return "9:15 AM";
    if (previous?.timestamp) return formatClock(previous.timestamp);
    if (current?.timestamp) {
      const d = new Date(new Date(current.timestamp).getTime() - Number(timeframe) * 60000);
      return formatClock(d.toISOString());
    }
    return "—";
  }, [timeframe, previous, current]);

  // ---------- Trader intelligence panel ----------
  // Max Pain = strike with minimum aggregate option value at expiry
  // (Σ_all-strikes max(0, spot-K) * CE_OI + max(0, K-spot) * PE_OI).
  const marketIntel = useMemo(() => {
    if (!filteredCurrent?.strikes?.length) return null;
    const strikes = filteredCurrent.strikes;
    const spot = filteredCurrent.price || filteredCurrent.atm;

    // Max Pain
    let maxPainStrike = null;
    let minPain = Infinity;
    for (const s of strikes) {
      let pain = 0;
      for (const t of strikes) {
        pain += Math.max(0, s.strike - t.strike) * (t.ce_oi || 0);
        pain += Math.max(0, t.strike - s.strike) * (t.pe_oi || 0);
      }
      if (pain < minPain) { minPain = pain; maxPainStrike = s.strike; }
    }

    // Support & resistance = strikes with highest OI (writers = smart money)
    const byCE = [...strikes].sort((a, b) => (b.ce_oi || 0) - (a.ce_oi || 0));
    const byPE = [...strikes].sort((a, b) => (b.pe_oi || 0) - (a.pe_oi || 0));
    const resistance = byCE[0]?.strike;
    const support = byPE[0]?.strike;

    // PCR (Put/Call Ratio) on total OI in filtered window
    let totCE = 0, totPE = 0;
    strikes.forEach((s) => { totCE += s.ce_oi || 0; totPE += s.pe_oi || 0; });
    const pcr = totCE > 0 ? totPE / totCE : 0;

    // ATM-band buildup classification (uses previous snapshot deltas + price change)
    const prevMap = new Map();
    (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    const priceDeltaPct = previous?.price && spot
      ? ((spot - previous.price) / previous.price) * 100
      : 0;

    let atmPeDelta = 0, atmCeDelta = 0;
    const atm = filteredCurrent.atm;
    for (const s of strikes) {
      if (Math.abs(s.strike - atm) <= (atm * 0.005)) {
        const p = prevMap.get(s.strike);
        if (p) { atmPeDelta += s.pe_oi - p.pe_oi; atmCeDelta += s.ce_oi - p.ce_oi; }
      }
    }

    // Overall verdict blends OI-change intensity (from changeSummary), PCR level
    // and short-term price movement into a single -100..+100 score.
    let oiScore = 0;
    if (changeSummary) {
      const norm = changeSummary.pe - changeSummary.ce;
      const base = Math.max(1, totCE + totPE);
      oiScore = Math.max(-1, Math.min(1, (norm / base) * 25));
    }
    const pcrScore = Math.max(-1, Math.min(1, (pcr - 1) / 1)); // >1 bullish
    const priceScore = Math.max(-1, Math.min(1, priceDeltaPct / 0.4));
    const blended = (oiScore * 0.5 + pcrScore * 0.2 + priceScore * 0.3);
    const score = Math.round(blended * 100);

    let label = "Neutral", tone = "slate";
    if (score >= 60) { label = "Strong Bullish"; tone = "emerald"; }
    else if (score >= 25) { label = "Bullish"; tone = "emerald"; }
    else if (score <= -60) { label = "Strong Bearish"; tone = "rose"; }
    else if (score <= -25) { label = "Bearish"; tone = "rose"; }

    return {
      maxPain: maxPainStrike, support, resistance, pcr, pcrScore,
      atmPeDelta, atmCeDelta, priceDeltaPct, score, label, tone,
    };
  }, [filteredCurrent, previous, changeSummary]);

  // Configurable "OI Change" toast threshold — user-editable in the warming-up
  // banner (see below). Persisted in localStorage.
  const [changeAlertPct, setChangeAlertPct] = useState(loadChangeAlertPct);
  useEffect(() => {
    try { localStorage.setItem(CHANGE_ALERT_PCT_KEY, String(changeAlertPct)); } catch { /* noop */ }
  }, [changeAlertPct]);
  // Track last-fired timestamp for the percentage-based toast so we don't spam
  // the user on every 15-second pull while the same condition persists.
  const lastPctAlertRef = useRef(0);

  const pushActivity = useCallback((ev) => {
    // Dedupe: same (type,index,strike,side,window,bucket-of-minute) inside a run.
    const bucket = Math.floor(Date.now() / (60 * 1000)); // 1-minute bucket
    const key = `${ev.type}|${ev.index}|${ev.strike || ""}|${ev.side || ""}|${ev.window || ""}|${bucket}`;
    if (seenActivityRef.current.has(key)) return;
    seenActivityRef.current.add(key);
    setActivity((prev) => [{ ...ev, id: `${key}:${Date.now()}` }, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    if (!changeSummary || !lastPulledAt) return;
    // Update "last pull change" every time new data arrives so the UI can show
    // both when data was pulled and the OI change seen at that pull.
    setLastPullChange({ ce: changeSummary.ce, pe: changeSummary.pe, at: lastPulledAt, timeframeLabel });
    // Fire local alert ONLY when the market is currently open — no more stale
    // bullish / bearish toasts after 3:30 PM IST.
    if (status?.market && status.market.is_market_open === false) return;
    // Admin Alert Settings: only alert for selected indices (OI may still load others).
    if (!indexInAlertFocus(activeIndex)) return;
    // Fire local alert if intensity crosses threshold and cooldown has elapsed.
    const now = Date.now();
    if (
      changeSummary.intensity >= ALERT_INTENSITY &&
      now - lastLocalAlertRef.current > ALERT_COOLDOWN_MS
    ) {
      lastLocalAlertRef.current = now;
      const dir = changeSummary.bullish
        ? "Bullish pressure (Put OI building)"
        : "Bearish pressure (Call OI building)";
      const msg = `${activeIndex}: ${dir} in last ${timeframeLabel}`;
      const desc = `PE ${formatDelta(changeSummary.pe)} · CE ${formatDelta(changeSummary.ce)}`;
      if (changeSummary.bullish) toast.success(msg, { description: desc, duration: 6000 });
      else toast.error(msg, { description: desc, duration: 6000 });
      try { playForAlert("reversal"); } catch (_) { /* noop */ }
      try { push(`OI Change · ${activeIndex}`, msg); } catch (_) { /* noop */ }
      try {
        pushActivity({
          type: "oi-intensity",
          index: activeIndex,
          at: new Date().toISOString(),
          message: msg,
          ce: changeSummary.ce,
          pe: changeSummary.pe,
        });
      } catch (_) { /* noop */ }
      setFlash(true);
      setTimeout(() => setFlash(false), 1800);
    }

    // -------- Custom-threshold "Change Alert" toast --------
    // Fires whenever |CE %| OR |PE %| change vs the previous-window baseline
    // crosses the user-configured `changeAlertPct` value. Independent cooldown
    // from the intensity-based alert above so both can coexist without spam.
    const cePctAbs = Math.abs(changeSummary.cePct || 0);
    const pePctAbs = Math.abs(changeSummary.pePct || 0);
    const worstPct = Math.max(cePctAbs, pePctAbs);
    if (
      worstPct >= changeAlertPct &&
      now - lastPctAlertRef.current > ALERT_COOLDOWN_MS &&
      previous // fire once we have a compare baseline (even while warming toward full window)
    ) {
      lastPctAlertRef.current = now;
      const which = cePctAbs >= pePctAbs ? "CE" : "PE";
      const pctVal = which === "CE" ? changeSummary.cePct : changeSummary.pePct;
      const arrow = pctVal >= 0 ? "▲" : "▼";
      const title = `${activeIndex} · ${which} OI ${arrow} ${Math.abs(pctVal).toFixed(2)}% in ${timeframeLabel}`;
      const desc = `CE ${formatDelta(changeSummary.ce)} (${(changeSummary.cePct || 0).toFixed(2)}%) · PE ${formatDelta(changeSummary.pe)} (${(changeSummary.pePct || 0).toFixed(2)}%)`;
      // Direction color: PE up = bullish (green); CE up = bearish (red).
      const isBull = (which === "PE" && pctVal >= 0) || (which === "CE" && pctVal < 0);
      if (isBull) toast.success(title, { description: desc, duration: 7000 });
      else toast.error(title, { description: desc, duration: 7000 });
      try { playForAlert("reversal"); } catch (_) { /* noop */ }
      try { push(`OI Change Alert · ${activeIndex}`, title); } catch (_) { /* noop */ }
      try {
        pushActivity({
          type: "oi-change-alert",
          index: activeIndex,
          side: which,
          at: new Date().toISOString(),
          message: title,
          ce: changeSummary.ce,
          pe: changeSummary.pe,
        });
      } catch (_) { /* noop */ }
      setFlash(true);
      setTimeout(() => setFlash(false), 1800);
    }
  }, [changeSummary, lastPulledAt, activeIndex, timeframeLabel, push, changeAlertPct, previous, status?.market, pushActivity, indexInAlertFocus]);

  // -------- Huge OI shift monitor (ATM ± 1 across 1/3/5 min windows) --------
  const emitHugeShiftNotify = useCallback((shift) => {
    try { playForAlert("huge_shift"); } catch (_) { /* noop */ }
    try {
      push(
        `HUGE OI SHIFT · ${shift.index}`,
        `${shift.side} ${shift.value > 0 ? "build" : "unwind"} in last ${shift.window} min`,
      );
    } catch (_) { /* noop */ }
    try {
      api.post("/telegram/huge-shift", {
        index: shift.index,
        side: shift.side,
        value: shift.value,
        direction: shift.value > 0 ? "build" : "unwind",
        window: shift.window,
        price: shift.price,
        atm: shift.atm,
        contributing: shift.contributing || [],
      }).catch(() => { /* silent — user already sees the modal */ });
    } catch (_) { /* noop */ }
  }, [push]);

  const handleHugeShift = useCallback((shift) => {
    // Admin alert focus first — viewing SENSEX must not alert if only NIFTY is selected.
    if (!indexInAlertFocus(shift.index)) return;
    // Silence shifts for indices other than the currently viewed one.
    if (shift.index !== activeIndex) return;
    // Bookmark the live snapshot time so Replay can jump here.
    const bookmarkTs = changeBundle?.current?.timestamp || current?.timestamp || shift.at || null;
    if (bookmarkTs) {
      try {
        const key = `oi_replay_bookmark_${shift.index}`;
        localStorage.setItem(key, JSON.stringify({
          ts: bookmarkTs,
          at: shift.at,
          side: shift.side,
          window: shift.window,
          value: shift.value,
        }));
      } catch (_) { /* noop */ }
      setReplayJumpTs(bookmarkTs);
    }
    // Also log to activity feed
    pushActivity({
      type: "huge-shift",
      index: shift.index,
      side: shift.side,
      window: shift.window,
      value: shift.value,
      at: shift.at,
      snapshotTs: bookmarkTs,
      message: `${shift.side} OI ${shift.value > 0 ? "build" : "unwind"} across ATM ± 1 in ${shift.window} min`,
    });
    // Always notify immediately (toast path = desktop Notification + Telegram + sound)
    // even when another modal is already open — queue only delays the modal UI.
    emitHugeShiftNotify(shift);
    // If a modal is already showing, queue this one; user must acknowledge
    // each in turn so nothing gets missed.
    if (hugeShift) {
      hugeShiftQueueRef.current.push({ ...shift, snapshotTs: bookmarkTs, notified: true });
      return;
    }
    setHugeShift({ ...shift, snapshotTs: bookmarkTs });
  }, [activeIndex, hugeShift, pushActivity, changeBundle, current?.timestamp, indexInAlertFocus, emitHugeShiftNotify]);

  const dismissHugeShift = useCallback(() => {
    setHugeShift(null);
    // Small delay so the dialog exit animation completes before the next one.
    setTimeout(() => {
      const next = hugeShiftQueueRef.current.shift();
      if (next) {
        setHugeShift(next);
        // Sound again when the next modal surfaces (Notification/TG already sent on detect).
        try { playForAlert("huge_shift"); } catch (_) { /* noop */ }
      }
    }, 250);
  }, []);

  const replayHugeShiftMoment = useCallback((ts) => {
    if (!ts) return;
    setReplayJumpTs(ts);
    setReplayOpen(true);
    setActiveTab("oi-change");
    setHugeShift(null);
    hugeShiftQueueRef.current = [];
  }, []);

  useHugeShiftMonitor({
    index: activeIndex,
    windows: oiSettings.hugeShiftWindows,
    thresholdAbs: oiSettings.hugeShiftAbs,
    cooldownMs: 120000,
    onShift: handleHugeShift,
    // Only evaluate while market is open and this index is in admin alert focus.
    enabled:
      !(status?.market && status.market.is_market_open === false)
      && indexInAlertFocus(activeIndex),
    // Fed from the main loadOI batch (`also=` windows) — no extra API calls.
    changeBundle,
  });

  // -------- Per-strike activity detector (gamma wall / institution / fast velocity) --------
  // Also builds a Map<strike, {ce:[tags], pe:[tags]}> that the OI chart uses to
  // render institution / gamma-wall / velocity icons UNDER each bar.
  const perStrikeSignals = useMemo(() => {
    const map = new Map();
    if (!filteredCurrent?.strikes?.length || !previous?.strikes?.length) return map;
    const prevMap = new Map();
    previous.strikes.forEach((s) => prevMap.set(s.strike, s));
    const minutes = Math.max(1, resolveMinutes(timeframe));
    const gwWindow = oiSettings.gammaWallMinutes || 3;
    const gwThresh = oiSettings.gammaWallAbs || 200_000;
    const gwScale = minutes >= gwWindow ? 1 : minutes / gwWindow;
    const gwEffective = gwThresh * gwScale;

    const lot = oiSettings.lotSize?.[activeIndex] || 1;
    const oiMin = oiSettings.instOiMin || 50_000;
    const premCr = oiSettings.instPremiumCr || 10;
    let vSum = 0, vCount = 0;
    filteredCurrent.strikes.forEach((s) => { vSum += (s.ce_volume || 0) + (s.pe_volume || 0); vCount += 2; });
    const avgVolume = vCount > 0 ? vSum / vCount : 0;

    const velMin = oiSettings.velocityFastMin || 50_000;

    for (const s of filteredCurrent.strikes) {
      const p = prevMap.get(s.strike);
      if (!p) continue;
      const ceDelta = s.ce_oi - p.ce_oi;
      const peDelta = s.pe_oi - p.pe_oi;
      const ceVel = ceDelta / minutes;
      const peVel = peDelta / minutes;

      const ceTags = [];
      const peTags = [];

      if (ceDelta >= gwEffective) ceTags.push({ type: "gamma-wall", value: ceDelta, tooltip: `Gamma wall (+${(ceDelta / 1e5).toFixed(2)}L CE OI in last ${minutes} min)` });
      if (peDelta >= gwEffective) peTags.push({ type: "gamma-wall", value: peDelta, tooltip: `Gamma wall (+${(peDelta / 1e5).toFixed(2)}L PE OI in last ${minutes} min)` });

      if (Math.abs(ceVel) >= velMin) ceTags.push({ type: "velocity", value: ceVel, tooltip: `Fast CE OI ${ceDelta > 0 ? "build" : "unwind"} (${Math.round(ceVel / 1000)}K/min)` });
      if (Math.abs(peVel) >= velMin) peTags.push({ type: "velocity", value: peVel, tooltip: `Fast PE OI ${peDelta > 0 ? "build" : "unwind"} (${Math.round(peVel / 1000)}K/min)` });

      const cePrem = (s.ce_ltp || 0) * (s.ce_oi || 0) * lot;
      const pePrem = (s.pe_ltp || 0) * (s.pe_oi || 0) * lot;
      if ((s.ce_oi || 0) > oiMin && (s.ce_volume || 0) > avgVolume && cePrem >= premCr * 1e7) {
        ceTags.push({ type: "institution", value: cePrem, tooltip: `Institutional footprint · ₹${(cePrem / 1e7).toFixed(1)}Cr premium · vol ${(s.ce_volume / 1000).toFixed(0)}K` });
      }
      if ((s.pe_oi || 0) > oiMin && (s.pe_volume || 0) > avgVolume && pePrem >= premCr * 1e7) {
        peTags.push({ type: "institution", value: pePrem, tooltip: `Institutional footprint · ₹${(pePrem / 1e7).toFixed(1)}Cr premium · vol ${(s.pe_volume / 1000).toFixed(0)}K` });
      }

      if (ceTags.length || peTags.length) {
        map.set(s.strike, { ce: ceTags, pe: peTags });
      }
    }
    return map;
  }, [filteredCurrent, previous, timeframe, activeIndex, oiSettings]);

  // Same signals, side-effect: push into activity feed. (kept separate so the
  // useMemo above stays pure.)
  useEffect(() => {
    if (!filteredCurrent?.strikes?.length || !previous?.strikes?.length) return;
    const prevMap = new Map();
    previous.strikes.forEach((s) => prevMap.set(s.strike, s));
    const minutes = Math.max(1, resolveMinutes(timeframe));
    const gwWindow = oiSettings.gammaWallMinutes || 3;
    const gwThresh = oiSettings.gammaWallAbs || 200_000;
    const gwScale = minutes >= gwWindow ? 1 : minutes / gwWindow;
    const gwEffective = gwThresh * gwScale;

    const lot = oiSettings.lotSize?.[activeIndex] || 1;
    const oiMin = oiSettings.instOiMin || 50_000;
    const premCr = oiSettings.instPremiumCr || 10;
    // Average volume for institutional check
    let vSum = 0, vCount = 0;
    filteredCurrent.strikes.forEach((s) => { vSum += (s.ce_volume || 0) + (s.pe_volume || 0); vCount += 2; });
    const avgVolume = vCount > 0 ? vSum / vCount : 0;

    const atmVal = filteredCurrent.atm;
    for (const s of filteredCurrent.strikes) {
      // Only care about strikes near ATM (± 5 steps) to reduce noise
      if (Math.abs(s.strike - atmVal) > (filteredCurrent.strikes[1]?.strike - filteredCurrent.strikes[0]?.strike || 50) * 5) continue;
      const p = prevMap.get(s.strike);
      if (!p) continue;
      const ceDelta = s.ce_oi - p.ce_oi;
      const peDelta = s.pe_oi - p.pe_oi;

      // Gamma wall — CE side
      if (ceDelta >= gwEffective) {
        pushActivity({
          type: "gamma-wall", index: activeIndex, strike: s.strike, side: "CE",
          value: ceDelta, window: minutes, at: new Date().toISOString(),
          message: `Gamma wall building at ${s.strike} CE (+${(ceDelta / 1e5).toFixed(2)}L)`,
        });
      }
      if (peDelta >= gwEffective) {
        pushActivity({
          type: "gamma-wall", index: activeIndex, strike: s.strike, side: "PE",
          value: peDelta, window: minutes, at: new Date().toISOString(),
          message: `Gamma wall building at ${s.strike} PE (+${(peDelta / 1e5).toFixed(2)}L)`,
        });
      }

      // Velocity — fast build only
      const ceVel = ceDelta / minutes;
      const peVel = peDelta / minutes;
      if (Math.abs(ceVel) >= (oiSettings.velocityFastMin || 50_000)) {
        pushActivity({
          type: "velocity", index: activeIndex, strike: s.strike, side: "CE",
          value: ceDelta, window: minutes, at: new Date().toISOString(),
          message: `🔥 Fast CE OI ${ceDelta > 0 ? "build" : "unwind"} at ${s.strike} (${Math.round(ceVel / 1000)}K/min)`,
        });
      }
      if (Math.abs(peVel) >= (oiSettings.velocityFastMin || 50_000)) {
        pushActivity({
          type: "velocity", index: activeIndex, strike: s.strike, side: "PE",
          value: peDelta, window: minutes, at: new Date().toISOString(),
          message: `🔥 Fast PE OI ${peDelta > 0 ? "build" : "unwind"} at ${s.strike} (${Math.round(peVel / 1000)}K/min)`,
        });
      }

      // Institution
      const cePrem = (s.ce_ltp || 0) * (s.ce_oi || 0) * lot;
      const pePrem = (s.pe_ltp || 0) * (s.pe_oi || 0) * lot;
      if ((s.ce_oi || 0) > oiMin && (s.ce_volume || 0) > avgVolume && cePrem >= premCr * 1e7) {
        pushActivity({
          type: "institution", index: activeIndex, strike: s.strike, side: "CE",
          value: null, at: new Date().toISOString(),
          message: `🏦 Institutional footprint on ${s.strike} CE (₹${(cePrem / 1e7).toFixed(1)}Cr premium)`,
        });
      }
      if ((s.pe_oi || 0) > oiMin && (s.pe_volume || 0) > avgVolume && pePrem >= premCr * 1e7) {
        pushActivity({
          type: "institution", index: activeIndex, strike: s.strike, side: "PE",
          value: null, at: new Date().toISOString(),
          message: `🏦 Institutional footprint on ${s.strike} PE (₹${(pePrem / 1e7).toFixed(1)}Cr premium)`,
        });
      }
    }
  }, [filteredCurrent, previous, timeframe, activeIndex, oiSettings, pushActivity]);

  // Also log backend reversal alerts for alert-focus indices into the activity feed.
  useEffect(() => {
    if (!alerts.length) return;
    const a = alerts[0];
    if (!indexInAlertFocus(a.index)) return;
    const bullish = a.direction?.toLowerCase().includes("bullish");
    pushActivity({
      type: bullish ? "reversal-bullish" : "reversal-bearish",
      index: a.index, at: a.created_at,
      message: a.direction || a.message || "OI reversal",
    });
  }, [alerts, pushActivity, indexInAlertFocus]);

  const focusedAlerts = useMemo(() => {
    if (alertEnabledIndices == null) return alerts || [];
    if (!Array.isArray(alertEnabledIndices) || !alertEnabledIndices.length) {
      return alerts || [];
    }
    return (alerts || []).filter((a) => indexInAlertFocus(a.index));
  }, [alerts, alertEnabledIndices, indexInAlertFocus]);

  const mobileIndexQuotes = useMemo(() => {
    const idxs = enabledIndices.length ? enabledIndices : INDICES;
    const out = {};
    for (const idx of idxs) {
      const t = tickerQuotes[idx];
      const live = liveSpotPrices?.[idx];
      const fromLive = live != null && Number.isFinite(Number(live)) ? Number(live) : null;
      const fromActive = idx === activeIndex && current?.price != null ? Number(current.price) : null;
      const fromTicker = t?.ltp != null ? Number(t.ltp) : null;
      const price = fromLive ?? fromActive ?? fromTicker;
      const prev = Number(t?.prev_close || t?.day_open)
        || (idx === activeIndex ? Number(current?.prev_close || current?.day_open || 0) : 0);
      const changePts = price != null && prev
        ? price - prev
        : (t?.change != null ? Number(t.change) : null);
      const changePct = price != null && prev
        ? ((price - prev) / prev) * 100
        : (t?.change_pct != null ? Number(t.change_pct) : null);
      out[idx] = { price, changePts, changePct };
    }
    return out;
  }, [enabledIndices, tickerQuotes, liveSpotPrices, activeIndex, current]);

  const mobileIndexTicker = isMobile ? (
    <MobileIndexTicker
      activeIndex={activeIndex}
      onSelectIndex={setActiveIndex}
      spotPrices={liveSpotPrices}
      tickers={Object.values(tickerQuotes)}
    />
  ) : null;

  return (
    <div className="oi-shell relative h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden overscroll-none">
      {authState.is_guest && (
        <GuestBanner
          guestName={authState.guest_name}
          adminName={authState.admin_display_name}
          showKiteConnect={tabOn("positions")}
          onConnectKite={startUserKite}
        />
      )}
      {slimStatusRail ? (
        <DeskStatusRail
          dataStatus={dataStatus}
          marketOpen={status?.market?.is_market_open === true}
          mode={status?.mode}
          snapshotTs={current?.timestamp || dataStatus?.as_of}
          market={status?.market}
          lastPulledAt={lastPulledAt}
          status={status}
          isAdmin={!!authState.is_admin}
          onOpenCreds={() => setCredsOpen(true)}
          mobileTicker={mobileIndexTicker}
        />
      ) : (
        <>
          <DataTruthStrip
            dataStatus={dataStatus}
            marketOpen={status?.market?.is_market_open === true}
            mode={status?.mode}
            snapshotTs={current?.timestamp || dataStatus?.as_of}
            emphasize={!!authState.is_guest}
            mobileTicker={mobileIndexTicker}
          />
          <MarketStatusBanner
            market={status?.market}
            lastPulledAt={lastPulledAt}
            dataDate={dataStatus?.data_date || status?.market?.session_anchor_date}
          />
          <KiteTokenBanner
            status={status}
            isAdmin={authState.is_admin}
            onOpenCreds={() => setCredsOpen(true)}
          />
        </>
      )}
      <KiteMaintenanceBanner status={status} />
      {authState.is_admin && (
        <AdminUploadAdvisor
          isAdmin
          refreshKey={uploadRefreshKey}
          onOpenUpload={() => setUploadOpen(true)}
        />
      )}
      <OvernightGapBrief
        indices={enabledIndices.length ? enabledIndices : INDICES}
        vix={current?.vix || status?.vix}
        activeIndex={activeIndex}
      />
      <Header
        status={status}
        current={current}
        dataStatus={dataStatus}
        assumedAdmin={!!authState.is_admin}
        publicAccessOpen={!!authState.public_access_open}
        onOpenCreds={() => { if (authState.is_admin) setCredsOpen(true); }}
        onOpenMorningRefresh={() => { if (authState.is_admin) setMorningRefreshOpen(true); }}
        onOpenTelegramPrefs={() => { if (authState.is_admin) setTelegramPrefsOpen(true); }}
        onOpenSettings={() => { if (authState.is_admin) setSettingsOpen(true); }}
        onOpenJournal={() => { if (authState.is_admin) setJournalOpen(true); }}
        onOpenSounds={() => setSoundsOpen(true)}
        onOpenUpload={() => { if (authState.is_admin) setUploadOpen(true); }}
        onDownloadCsv={() => downloadOICsv(current, previous, activeIndex)}
        notifEnabled={notifEnabled}
        onToggleNotif={handleToggleNotif}
        onOpenHolidays={() => setActiveTab("holidays")}
        onOpenEvents={() => setActiveTab("holidays")}
        vixSessionOpen={vixSessionOpen}
        activeIndex={activeIndex}
        onSelectIndex={setActiveIndex}
        lastPulledAt={lastPulledAt}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((v) => !v)}
        compact={compact}
        onToggleCompact={() => setCompact((v) => !v)}
        headerRail={headerRail}
        onToggleHeaderRail={() => setHeaderRail((v) => !v)}
        slimStatusRail={slimStatusRail}
        onToggleSlimStatusRail={() => setSlimStatusRail((v) => !v)}
        positionsPollMs={positionsPollMs}
        positionsPublic={tabOn("positions")}
        showDeskAi={!!authState.is_admin ? deskAiAdmin !== false : !!deskAiPublic}
        deskAiAsk={deskAiAsk}
        deskAiOnGrid={deskAiOnGrid}
        onToggleDeskAiGrid={toggleDeskAiOnGrid}
        onOpenDeskAiPanel={openDeskAiPanel}
        onDeskAiChange={(next) => {
          const patch = {};
          if (typeof next?.show === "boolean") {
            patch.desk_ai_show = next.show;
            if (next.show) patch.desk_ai_radar = true;
          }
          if (typeof next?.ask === "boolean") patch.desk_ai_ask = next.ask;
          if (Object.keys(patch).length) patchDeskAi(patch);
        }}
        spotPrices={liveSpotPrices}
        onFreshPullDone={() => {
          // Clear warm caches then re-hydrate every enabled index after Fresh Pull.
          oiCacheRef.current = {};
          loadOI();
          loadStatus();
        }}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {!compact && (
          <>
            <button
              type="button"
              className="md:hidden fixed inset-0 z-[45] bg-slate-950/50 backdrop-blur-[2px]"
              aria-label="Close sidebar"
              data-testid="sidebar-mobile-backdrop"
              onClick={() => setCompact(true)}
            />
            <div className="fixed md:static z-50 md:z-auto inset-y-0 left-0 w-[min(18rem,88vw)] md:w-auto max-w-[90vw] md:max-w-none shadow-2xl md:shadow-none overflow-y-auto">
              <Sidebar
                indices={enabledIndices.length ? enabledIndices : INDICES}
                activeIndex={activeIndex}
                onChangeIndex={setActiveIndex}
                current={current}
                strikesAround={strikesAround}
                onChangeStrikesAround={applyStrikesAround}
                strikeRange={strikeRange}
                onChangeStrikeRange={handleStrikeRangeChange}
                onReset={handleReset}
                expiries={expiries}
                expiriesMeta={expiriesMeta}
                expiriesNote={expiriesNote}
                selectedExpiry={selectedExpiry}
                onChangeExpiry={handleChangeExpiry}
                showStrikeRange={showStrikeRange}
                lastUpdatedByIndex={lastUpdatedByIndex}
                marketOpen={!(status?.market && status.market.is_market_open === false)}
                onCollapse={() => setCompact(true)}
                layoutNonce={layoutNonce}
              />
            </div>
          </>
        )}
        {compact && (
          <button
            type="button"
            data-testid="btn-show-sidebar"
            onClick={() => setCompact(false)}
            className="hidden md:flex shrink-0 w-8 flex-col items-center justify-start gap-2 border-r border-slate-200 bg-white/90 px-1 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-emerald-50 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-900/90 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200"
            title="Show sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
            <span className="[writing-mode:vertical-rl] rotate-180">Sidebar</span>
          </button>
        )}

        <main
          className={`flex-1 min-h-0 overflow-hidden p-0 sm:px-4 md:px-5 dark:text-slate-200 flex flex-col ${
            infoTilesOpen ? "sm:pt-4 md:pt-5 sm:pb-4 md:pb-5" : "sm:pt-1.5 md:pt-2 sm:pb-4 md:pb-5"
          } max-md:pb-[calc(3.25rem+env(safe-area-inset-bottom,0px))]`}
        >
          <DeskAiBar
            activeIndex={activeIndex}
            visible={deskAiOnGrid && (!!authState.is_admin ? deskAiAdmin !== false : !!deskAiPublic)}
            askAi={deskAiAsk}
            variant="strip"
            onOpenPanel={openDeskAiPanel}
          />
          <div className="md:hidden shrink-0">
            <MobileStickyChrome
              activeIndex={activeIndex}
              indices={enabledIndices.length ? enabledIndices : INDICES}
              onSelectIndex={setActiveIndex}
              spotPrices={liveSpotPrices}
              indexQuotes={mobileIndexQuotes}
              tabs={dashboardTabs}
              activeTab={activeTab}
              onChangeTab={(id) => {
                setActiveTab(id);
                setCompact(true);
              }}
              onReorder={handleReorderTabs}
              onFavorite={handleFavoriteTab}
              onMove={handleMoveTab}
              infoTilesOpen={infoTilesOpen}
              onToggleInfoTiles={setInfoTilesOpen}
              infoTiles={
                <InfoTilesRow
                  order={tileOrder}
                  onReorder={handleReorderTiles}
                  onFavorite={handleFavoriteTile}
                  onMove={handleMoveTile}
                  isAdmin={!!authState.is_admin}
                  showImpact={showImpactTile}
                  activeIndex={activeIndex}
                  onOpenHolidays={openHolidaysTab}
                  onOpenIndexEvents={openIndexEventsTab}
                  compact
                  testId="dashboard-info-tiles-mobile"
                />
              }
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 min-h-0 flex flex-col px-2 pt-0 md:pt-0 sm:px-0">
            {/* Same-row chrome: tabs collapse into More as tiles take space (desk density). */}
            <div
              className={`hidden md:flex items-center gap-2 flex-nowrap shrink-0 min-w-0 w-full ${
                infoTilesOpen ? "mb-2 sm:mb-3" : "mb-0"
              }`}
              data-testid="dashboard-chrome-row"
            >
              <div className="min-w-0 flex-1 flex items-center overflow-visible">
                <OverflowTabBar
                  tabs={dashboardTabs}
                  value={activeTab}
                  onChange={setActiveTab}
                  onReorder={handleReorderTabs}
                  onFavorite={handleFavoriteTab}
                  onMove={handleMoveTab}
                />
              </div>

              {infoTilesOpen ? (
                <>
                  <div
                    className="shrink-0 relative z-30 overflow-x-auto max-w-[58%] lg:max-w-[62%] xl:max-w-none"
                    data-testid="dashboard-info-tiles-wrap"
                  >
                    <InfoTilesRow
                      order={tileOrder}
                      onReorder={handleReorderTiles}
                      onFavorite={handleFavoriteTile}
                      onMove={handleMoveTile}
                      isAdmin={!!authState.is_admin}
                      showImpact={showImpactTile}
                      activeIndex={activeIndex}
                      onOpenHolidays={openHolidaysTab}
                      onOpenIndexEvents={openIndexEventsTab}
                      wide
                      testId="dashboard-info-tiles"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setInfoTilesOpen(false)}
                    title="Hide info tiles — more room for charts & tables"
                    aria-label="Hide info tiles"
                    aria-expanded="true"
                    data-testid="btn-toggle-info-tiles"
                    className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-sm text-slate-400 hover:text-emerald-700 hover:bg-emerald-50/80 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setInfoTilesOpen(true)}
                  title="Show holiday / FII / event tiles"
                  aria-label="Show info tiles"
                  aria-expanded="false"
                  data-testid="btn-toggle-info-tiles"
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-sm text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-emerald-700 hover:bg-emerald-50/80 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Events
                </button>
              )}
            </div>

            <div className="relative w-full flex-1 min-h-0">
            <PanelGroup direction="horizontal" autoSaveId="oi-pulse-split" className="w-full h-full min-h-0">
              <Panel defaultSize={showRightPanel ? 72 : 100} minSize={50} className={`${flash ? "alert-flash" : ""} min-h-0 overflow-hidden`}>
                <div className="h-full min-h-0 overflow-y-auto overscroll-contain space-y-3 sm:space-y-4 px-2 sm:px-0 pr-2">
                {(dayBiasSummary || changeSummary) && (
                  <SentimentBar
                    ceDelta={dayBiasSummary?.ce ?? changeSummary?.ce ?? 0}
                    peDelta={dayBiasSummary?.pe ?? changeSummary?.pe ?? 0}
                    marketOpen={!(status?.market && status.market.is_market_open === false)}
                    wholeDay
                    sessionMinutes={dayBiasSummary?.minutes}
                  />
                )}
                {activeTab === "oi-change" && !historyReady && (() => {
                  // Live countdown: available minutes grows by (now - fetchedAt).
                  const elapsedSinceFetchSec = Math.max(0, (warmingTick - availableFetchedAtRef.current) / 1000);
                  const liveAvailMin = availableHistoryMin + elapsedSinceFetchSec / 60;
                  const targetMin = resolveMinutes(timeframe);
                  const remainingSec = Math.max(0, Math.round((targetMin - liveAvailMin) * 60));
                  const mm = Math.floor(remainingSec / 60);
                  const ss = remainingSec % 60;
                  const clock = `${mm}:${String(ss).padStart(2, "0")}`;
                  return (
                    <div
                      data-testid="history-warming-banner"
                      className="rounded-md border border-slate-200 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] flex items-center gap-2 flex-wrap"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                      {previous ? (
                        <span>
                          Showing last {liveAvailMin.toFixed(1)} min (warming to {timeframeLabel}).
                          <span className="ml-1 opacity-80">Full compare in {clock}</span>
                        </span>
                      ) : (
                        <span>
                          Collecting snapshots for {timeframeLabel} · {liveAvailMin.toFixed(1)} min so far · unlocks in {clock}
                        </span>
                      )}
                      <span className="ml-auto hidden md:flex items-center gap-1.5 text-[11px]" data-testid="change-alert-threshold-wrapper">
                        <span className="opacity-80">Alert on ≥</span>
                        <input
                          data-testid="change-alert-threshold"
                          type="number"
                          step="0.5"
                          min="0.1"
                          value={changeAlertPct}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v) && v > 0) setChangeAlertPct(v);
                          }}
                          className="w-14 px-1 py-0.5 rounded border border-slate-300 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono-data text-right"
                        />
                        <span className="opacity-80">%</span>
                      </span>
                    </div>
                  );
                })()}
                {activeTab === "oi-change" && historyReady && (
                  <div className="hidden md:flex justify-end -mb-1" data-testid="change-alert-threshold-wrapper">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>Alert on ≥</span>
                      <input
                        data-testid="change-alert-threshold"
                        type="number"
                        step="0.5"
                        min="0.1"
                        value={changeAlertPct}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v) && v > 0) setChangeAlertPct(v);
                        }}
                        className="w-14 px-1 py-0.5 rounded border border-slate-200 bg-white dark:bg-slate-900 font-mono-data text-right"
                      />
                      <span>%</span>
                    </label>
                  </div>
                )}
                <div
                  className={`oi-panel oi-rise p-4 transition-all duration-700 ${
                    pulsePull && activeTab === "oi-change" ? "ring-2 ring-emerald-300 border-emerald-300" : ""
                  }`}
                  data-testid="oi-change-card"
                  style={
                    // Bias wash is OI-Change only — Positions / other tabs stay clean & independent.
                    activeTab === "oi-change" && changeSummary
                      ? {
                          backgroundColor: changeSummary.bullish
                            ? `rgba(22,163,74,${(changeSummary.intensity * 0.35).toFixed(3)})`
                            : `rgba(220,38,38,${(changeSummary.intensity * 0.35).toFixed(3)})`,
                          boxShadow: changeSummary.intensity > 0.5
                            ? `0 0 0 2px ${changeSummary.bullish ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)"} inset`
                            : undefined,
                        }
                      : undefined
                  }
                >
                  {(tabOn("oi-change")) && (
                    <TabsContent value="oi-change" className="mt-0">
                      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="text-base font-semibold text-slate-900">
                          OI Change on {formatDayLabel(current?.timestamp)}
                        </div>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              data-testid="btn-how-to-read"
                              className="text-xs text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1"
                            >
                              <HelpCircle className="w-3 h-3" />
                              How to read this?
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-80 text-xs text-slate-700 space-y-2">
                            <div className="font-semibold text-slate-900 text-sm">How to read this chart</div>
                            <p>
                              Each strike shows two grouped bars — <span className="text-emerald-600 font-semibold">Put OI</span> on the left and <span className="text-rose-600 font-semibold">Call OI</span> on the right.
                            </p>
                            <ul className="space-y-1 pl-3 list-disc">
                              <li><span className="font-semibold">Solid</span> segment = OI at the start of the window</li>
                              <li><span className="font-semibold">Diagonal-striped</span> top = <span className="text-emerald-700">Increase</span> in OI (fresh writers)</li>
                              <li><span className="font-semibold">Outlined</span> top = <span className="text-slate-700">Decrease</span> (writers unwound)</li>
                            </ul>
                            <p className="text-slate-500">
                              Hover a strike to see the exact OI at both timestamps and the change.
                            </p>
                          </PopoverContent>
                        </Popover>
                        <button
                          data-testid="btn-replay-change"
                          onClick={() => setReplayOpen((v) => !v)}
                          className={`text-xs flex items-center gap-1 hover:underline ${
                            replayOpen ? "text-sky-700 font-semibold" : "text-sky-600 hover:text-sky-700"
                          }`}
                        >
                          Replay Change
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-100 text-sky-600">
                            <Play className="w-2.5 h-2.5 fill-current" />
                          </span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {lastPulledAt && (
                          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono-data mr-2" data-testid="last-pulled">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Pulled {formatClock(lastPulledAt, true)}
                          </span>
                        )}
                        <Switch
                          data-testid="switch-show-oi"
                          checked={showOI}
                          onCheckedChange={setShowOI}
                          className="data-[state=checked]:bg-sky-500"
                        />
                        <span className="text-sm text-slate-700">Show OI</span>
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-[10px] px-1.5 py-0 rounded-sm">New</Badge>
                      </div>
                    </div>
                    {isMobile && (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <StrikeAroundChips
                          strikesAround={strikesAround}
                          onChange={applyStrikesAround}
                        />
                      </div>
                    )}
                    {current?.atm != null && (
                      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-mono-data text-slate-700" data-testid="oi-change-atm-strip">
                        <span>ATM <b className="text-slate-950">{Number(current.atm).toLocaleString("en-IN")}</b></span>
                        {current?.pcr != null && (
                          <span>PCR <b className={Number(current.pcr) >= 1 ? "text-emerald-800" : "text-rose-800"}>{Number(current.pcr).toFixed(2)}</b></span>
                        )}
                        {typeof strikesAround === "number" && (
                          <span className="text-slate-600">showing ±{strikesAround} strikes</span>
                        )}
                      </div>
                    )}
                    <div
                      className={`transition-opacity duration-300 ${oiLoading && current?.index && current.index !== activeIndex ? "opacity-40" : "opacity-100"}`}
                    >
                    <OIChart
                      key={activeIndex}
                      current={current?.index && current.index !== activeIndex ? null : filteredCurrent}
                      previous={current?.index && current.index !== activeIndex ? null : (replayFrame || previous)}
                      atm={current?.atm}
                      mode={status?.mode}
                      showOI={showOI}
                      currentTime={current?.timestamp}
                      prevTime={(replayFrame || previous)?.timestamp}
                      signalsMap={showChartSignals ? perStrikeSignals : null}
                    />
                    {marketIntel && (
                      <div
                        className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] font-mono-data"
                        data-testid="market-intel"
                      >
                        <div
                          className={`col-span-2 md:col-span-1 flex items-center gap-2 rounded-md px-3 py-2 border ${
                            marketIntel.tone === "emerald"
                              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                              : marketIntel.tone === "rose"
                                ? "bg-rose-50 border-rose-200 text-rose-800"
                                : "bg-slate-50 border-slate-200 text-slate-700"
                          }`}
                          data-testid="market-verdict"
                        >
                          <span className="uppercase tracking-widest text-[9px] opacity-70 flex items-center gap-1">
                            Bias
                            <InfoTip testId="market-verdict-tip">
                              {biasGuide(marketIntel.score)}
                            </InfoTip>
                          </span>
                          <span className="text-sm font-semibold" data-testid="market-verdict-label">{marketIntel.label}</span>
                          <span className={`ml-auto text-[10px] tabular-nums ${marketIntel.score >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {marketIntel.score >= 0 ? "+" : ""}{marketIntel.score}
                          </span>
                        </div>
                        <IntelCell label="PCR" value={marketIntel.pcr.toFixed(2)}
                          hint={marketIntel.pcr >= 1.05 ? "Bullish (≥1.05)" : marketIntel.pcr <= 0.95 ? "Bearish (≤0.95)" : "Neutral"}
                          tone={marketIntel.pcr >= 1.05 ? "emerald" : marketIntel.pcr <= 0.95 ? "rose" : "slate"}
                          tip={pcrGuide(marketIntel.pcr)} />
                        <IntelCell label="Max Pain" value={marketIntel.maxPain?.toLocaleString()}
                          hint={
                            current?.price && marketIntel.maxPain
                              ? current.price > marketIntel.maxPain
                                ? `Spot ${((current.price - marketIntel.maxPain) / marketIntel.maxPain * 100).toFixed(2)}% above`
                                : `Spot ${((marketIntel.maxPain - current.price) / marketIntel.maxPain * 100).toFixed(2)}% below`
                              : ""
                          }
                          tone={current?.price > marketIntel.maxPain ? "emerald" : "rose"}
                          tip={maxPainGuide(current?.price, marketIntel.maxPain)} />
                        <IntelCell label="Support" value={marketIntel.support?.toLocaleString()}
                          hint="Highest Put OI" tone="emerald"
                          tip={supportGuide()} />
                        <IntelCell label="Resistance" value={marketIntel.resistance?.toLocaleString()}
                          hint="Highest Call OI" tone="rose"
                          tip={resistanceGuide()} />
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono-data text-slate-600">
                        <span data-testid="window-start-label">{windowStartLabel}</span>
                        <span className="flex-1 mx-3 h-1.5 rounded-full bg-slate-100 relative">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-sky-500" style={{ width: "100%" }} />
                          <span className="absolute -top-1 left-0 w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-white shadow" />
                          <span className="absolute -top-1 right-0 w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-white shadow" />
                        </span>
                        <span data-testid="window-end-label">{formatClock(current?.timestamp) || formatClock(lastPulledAt) || "—"}</span>
                      </div>
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                      {replayOpen && (
                        <ReplayScrubber
                          index={activeIndex}
                          minutes={180}
                          jumpToTs={replayJumpTs}
                          onJumpConsumed={clearReplayJump}
                          onReplayFrame={setReplayFrame}
                        />
                      )}
                    </div>
                    {(
                      <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-6 items-start text-base" data-testid="change-summary">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="inline-flex items-center px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm font-medium" data-testid="change-summary-title">
                              Change on {formatDayLabel(current?.timestamp)}
                            </div>
                            {typeof current?.pcr === "number" && current.pcr > 0 && (
                              <div
                                data-testid="pcr-pill"
                                title={`Put/Call OI Ratio for ${activeIndex}${selectedExpiry ? " · expiry " + selectedExpiry : ""} · > 1 = bullish (more puts), < 1 = bearish (more calls)`}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-mono-data ${
                                  current.pcr > 1
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                <span className="uppercase tracking-widest text-[9px] opacity-70">
                                  {activeIndex} PCR
                                </span>
                                <span className="text-sm font-semibold">
                                  {current.pcr.toFixed(2)}
                                </span>
                                <span className="text-[10px]">
                                  {current.pcr > 1 ? "▲" : "▼"}
                                </span>
                              </div>
                            )}
                          </div>
                          {lastPullChange && (
                            <div className="text-xs text-slate-500 font-mono-data leading-tight" data-testid="last-pull-change">
                              OI last pulled at{" "}
                              <span className="text-slate-900">{formatClock(lastPullChange.at, true)}</span>
                              <br />
                              in last {lastPullChange.timeframeLabel}:{" "}
                              <span className={lastPullChange.pe >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                PE {formatDelta(lastPullChange.pe)}
                              </span>
                              {" · "}
                              <span className={lastPullChange.ce >= 0 ? "text-rose-600" : "text-emerald-600"}>
                                CE {formatDelta(lastPullChange.ce)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 font-mono-data">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-32 text-sm">Call OI change:</span>
                            <span className={`text-2xl leading-none ${changeSummary && changeSummary.ce >= 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"} ${!historyReady && changeSummary ? "opacity-60" : ""}`} data-testid="summary-ce-change" title={!historyReady ? `Approximate — only ${availableHistoryMin.toFixed(1)} min of history` : undefined}>
                              {changeSummary ? `${!historyReady ? "≈ " : ""}${formatDelta(changeSummary.ce)}` : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-32 text-sm">Put OI change:</span>
                            <span className={`text-2xl leading-none ${changeSummary && changeSummary.pe >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"} ${!historyReady && changeSummary ? "opacity-60" : ""}`} data-testid="summary-pe-change" title={!historyReady ? `Approximate — only ${availableHistoryMin.toFixed(1)} min of history` : undefined}>
                              {changeSummary ? `${!historyReady ? "≈ " : ""}${formatDelta(changeSummary.pe)}` : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-2 font-mono-data">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-44 text-sm">
                              {activeIndex} at {formatClock((replayFrame || previous)?.timestamp) || "—"}:
                            </span>
                            <span className="text-slate-900 text-lg font-semibold" data-testid="summary-price-prev">
                              {(replayFrame || previous)?.price
                                ? (replayFrame || previous).price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-44 text-sm">
                              {activeIndex} at {formatClock(current?.timestamp) || "—"}:
                            </span>
                            <span className="text-slate-900 text-lg font-semibold" data-testid="summary-price-now">
                              {current?.price
                                ? current.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  </TabsContent>
                )}

                  {(tabOn("open-interest")) && (
                    <TabsContent value="open-interest" className="mt-0">
                      <div className="text-sm font-semibold mb-2">{activeIndex} Absolute Open Interest</div>
                    {isMobile && (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2" data-testid="oi-tab-strike-around">
                        <StrikeAroundChips
                          strikesAround={strikesAround}
                          onChange={applyStrikesAround}
                        />
                      </div>
                    )}
                    <OIChart
                      current={filteredCurrent}
                      previous={null}
                      atm={current?.atm}
                      mode={status?.mode}
                    />
                  </TabsContent>
                  )}

                  {(tabOn("strike-table")) && (
                    <TabsContent value="strike-table" className="mt-0">
                    <div className="text-sm font-semibold mb-2">{activeIndex} Strike-wise OI Table</div>
                    <StrikeTable
                      current={filteredCurrent}
                      previous={previous}
                      atm={current?.atm}
                      timeframeMin={resolveMinutes(timeframe)}
                      oiSettings={oiSettings}
                      lotSize={oiSettings.lotSize?.[activeIndex] || 1}
                      expiry={selectedExpiry}
                      vixNow={current?.vix || status?.vix}
                      showSignals={showChartSignals}
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                    </div>
                  </TabsContent>
                  )}

                  {(tabOn("sell-candidates")) && (
                    <TabsContent value="sell-candidates" className="mt-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{activeIndex} Sell Candidates — safest strikes to short</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Timeframe: <b>{timeframeLabel}</b> · auto-recomputes every 60s
                      </div>
                    </div>
                    <SellCandidatesPanel
                      current={filteredCurrent}
                      previous={previous}
                      indexName={activeIndex}
                      vixNow={current?.vix || status?.vix}
                      vixOpen={vixSessionOpen}
                      step={INDEX_STEP[activeIndex] || 50}
                      vrp={vrp}
                      lastComputedAt={scTick}
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                    </div>
                  </TabsContent>
                  )}

                  {(tabOn("buildup")) && (
                    <TabsContent value="buildup" className="mt-0">
                    <div className="text-sm font-semibold mb-2">{activeIndex} Long / Short Build-up</div>
                    <BuildupTable
                      current={filteredCurrent}
                      previous={previous}
                      atm={current?.atm}
                      timeframeLabel={timeframeLabel}
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                    </div>
                  </TabsContent>
                  )}

                  {(tabOn("positions")) && (
                    <TabsContent
                      value="positions"
                      className="mt-0 data-[state=inactive]:hidden"
                      forceMount
                    >
                    <div className="text-sm font-semibold mb-2">My Kite Positions</div>
                    <PositionsPanel
                      isKiteMode={authState.is_admin ? kiteLiveConnected : true}
                      isGuest={!!authState.is_guest}
                      hasKiteCredentials={status ? !!status.has_kite_credentials : null}
                      current={filteredCurrent || current}
                      previous={previous}
                      vix={current?.vix || status?.vix}
                      vixOpen={vixSessionOpen}
                      oiSettings={oiSettings}
                      activeIndex={activeIndex}
                      expiry={selectedExpiry}
                      step={INDEX_STEP[activeIndex] || 50}
                      vrp={vrp}
                      expiriesMeta={expiriesMeta}
                      onPinNearestWeekly={handleChangeExpiry}
                      positionsPollMs={positionsPollMs}
                      onOpenKite={openKiteCreds}
                      deskAiShow={!!authState.is_admin ? deskAiAdmin !== false : !!deskAiPublic}
                      deskAiAsk={deskAiAsk}
                      deskAiPositions={deskAiPositions}
                      deskAiRadar={deskAiRadar}
                      canConfigureDeskAi={!!authState.is_admin}
                      onDeskAiPositions={(on) => patchDeskAi({ desk_ai_positions: !!on })}
                      onDeskAiRadar={(on) => patchDeskAi({ desk_ai_radar: !!on })}
                      onAdjustmentAlert={(payload) => {
                        pushActivity({
                          type: "adjust-watch",
                          index: activeIndex,
                          strike: payload.strike,
                          side: payload.side,
                          at: new Date().toISOString(),
                          message: `⚠️ ${payload.tradingsymbol}: spot ${payload.spot?.toFixed?.(2)} · ${payload.coveredPct}% band covered — consider adjustment`,
                        });
                      }}
                    />
                  </TabsContent>
                  )}

                  {(tabOn("alerts")) && (
                    <TabsContent value="alerts" className="mt-0">
                    <div className="text-sm font-semibold mb-2">All Alerts</div>
                    <AlertsPanel alerts={focusedAlerts} onClear={handleClearAlerts} activeIndex={activeIndex} canClear={authState.is_admin} />
                  </TabsContent>
                  )}

                  {(tabOn("activity")) && (
                    <TabsContent value="activity" className="mt-0">
                    <div className="text-sm font-semibold mb-2">Unusual Activity Feed</div>
                    <ActivityFeed
                      events={activity.filter((e) => e.index === activeIndex)}
                      activeIndex={activeIndex}
                      onClear={() => { setActivity([]); seenActivityRef.current.clear(); }}
                      filter={activityFilter}
                      onSetFilter={setActivityFilter}
                    />
                  </TabsContent>
                  )}

                  {(tabOn("holidays")) && (
                    <TabsContent value="holidays" className="mt-0">
                    <HolidaysTab />
                  </TabsContent>
                  )}

                  {(tabOn("straddle")) && (
                    <TabsContent value="straddle" className="mt-0">
                    <div className="hidden md:block text-sm font-semibold mb-4">{activeIndex} Straddle Premium</div>
                    <StraddleChart
                      key={`tab-${activeIndex}-${selectedExpiry || "auto"}`}
                      index={activeIndex}
                      expiry={selectedExpiry}
                      position="long"
                      qty={1}
                      pollMs={straddlePollMs}
                      maxPoints={7200}
                      useWs={true}
                    />
                  </TabsContent>
                  )}

                  {(tabOn("index-events")) && (
                  <TabsContent value="index-events" className="mt-0">
                      <EventRiskWidget
                        activeIndex={activeIndex}
                        refreshKey={uploadRefreshKey}
                        isAdmin={!!authState.is_admin}
                      />
                    </TabsContent>
                  )}

                  {(tabOn("cas")) && (
                    <TabsContent value="cas" className="mt-0">
                      <CasPanel
                        isAdmin={!!authState.is_admin}
                        isKiteMode={kiteLiveConnected}
                        onOpenKite={openKiteCreds}
                      />
                    </TabsContent>
                  )}
                </div>

                <div className="oi-panel p-3 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
                  <div data-testid="footer-refresh">
                    OI last pulled —{" "}
                    <span className="font-mono-data text-slate-900">
                      {lastPulledAt
                        ? formatClock(lastPulledAt, true)
                        : status?.last_updated_at
                          ? new Date(status.last_updated_at).toLocaleTimeString()
                          : "—"}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    Auto-refresh every {Math.round(pollMs / 1000)}s ·{" "}
                    <span className="font-mono-data">
                      {status?.mode === "kite" ? "Live" : "Offline / Historical data"}
                    </span>
                  </div>
                </div>
                {activeTab === "open-interest" && showWriterDefense && (
                  <WriterDefenseMap
                    current={filteredCurrent}
                    sessionPrevious={changeBundle?.also_windows?.session?.previous}
                    band={3}
                    marketOpen={!(status?.market && status.market.is_market_open === false)}
                  />
                )}
                </div>
              </Panel>
              {showRightPanel && (
                <>
                  <PanelResizeHandle className="w-1 mx-1 bg-slate-200 hover:bg-sky-400 transition-colors cursor-col-resize rounded-full" data-testid="right-panel-handle" />
                  <Panel defaultSize={28} minSize={18} maxSize={55} className="min-h-0 overflow-hidden">
                    <RightPanel
                      view={rightPanelView}
                      onChangeView={setRightPanelView}
                      onClose={() => setRightPanelOpen(false)}
                      isAdmin={!!authState.is_admin}
                      visiblePages={visiblePages}
                      adminPages={adminVisiblePages}
                      alerts={focusedAlerts}
                      onClearAlerts={handleClearAlerts}
                      canClearAlerts={authState.is_admin}
                      activeIndex={activeIndex}
                      filteredCurrent={filteredCurrent}
                      current={current}
                      previous={previous}
                      atm={current?.atm}
                      timeframeMin={resolveMinutes(timeframe)}
                      timeframeLabel={timeframeLabel}
                      oiSettings={oiSettings}
                      lotSize={oiSettings.lotSize?.[activeIndex] || 1}
                      selectedExpiry={selectedExpiry}
                      vixNow={current?.vix || status?.vix}
                      vixOpen={vixSessionOpen}
                      vrp={vrp}
                      indexStep={INDEX_STEP[activeIndex] || 50}
                      expiriesMeta={expiriesMeta}
                      onPinNearestWeekly={handleChangeExpiry}
                      positionsPollMs={positionsPollMs}
                      activity={activity}
                      activityFilter={activityFilter}
                      setActivityFilter={setActivityFilter}
                      clearActivity={() => { setActivity([]); seenActivityRef.current.clear(); }}
                      isKiteMode={kiteLiveConnected}
                      status={status}
                      showOI={showOI}
                      // pass configured straddle poll interval (ms)
                      straddlePollMs={straddlePollMs}
                      uploadRefreshKey={uploadRefreshKey}
                      onOpenKite={openKiteCreds}
                      deskAiShow={!!authState.is_admin ? deskAiAdmin !== false : !!deskAiPublic}
                      deskAiAsk={deskAiAsk}
                      deskAiPositions={deskAiPositions}
                      deskAiRadar={deskAiRadar}
                      canConfigureDeskAi={!!authState.is_admin}
                      onDeskAiPositions={(on) => patchDeskAi({ desk_ai_positions: !!on })}
                      onDeskAiRadar={(on) => patchDeskAi({ desk_ai_radar: !!on })}
                      suggestion={
                        showSuggestion ? (
                          <SuggestionBox
                            indexName={activeIndex}
                            marketIntel={marketIntel}
                            changeSummary={changeSummary}
                            spot={current?.price || current?.atm}
                            vixNow={current?.vix || status?.vix}
                            vixOpen={vixSessionOpen}
                            sessionDate={dataStatus?.data_date || current?.timestamp || lastPulledAt}
                            isLiveSession={!!status?.market?.is_market_open}
                          />
                        ) : null
                      }
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
            {!showRightPanel && !isMobile && (
              <button
                type="button"
                onClick={() => setRightPanelOpen(true)}
                data-testid="btn-open-right-panel"
                className="hidden md:flex absolute right-0 top-1/3 z-40 -translate-y-1/2 flex-col items-center gap-2 rounded-l-md border border-r-0 border-slate-200 bg-white/95 px-1.5 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600 shadow-sm hover:bg-emerald-50 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300"
                title="Show side panel"
              >
                <PanelRightOpen className="w-4 h-4" />
                <span className="[writing-mode:vertical-rl] rotate-180">Panel</span>
              </button>
            )}
            </div>
          </Tabs>
        </main>
      </div>

      {isMobile && (
        <MobileBottomNav
          activeTab={activeTab}
          isAdmin={!!authState.is_admin}
          visiblePages={visiblePages}
          adminPages={adminVisiblePages}
          deskOpen={!compact}
          onOpenDesk={() => setCompact((v) => !v)}
          onOpenAdminTools={() => window.dispatchEvent(new Event("oi-toggle-admin-tools"))}
          onChangeTab={(id) => {
            setCompact(true);
            setActiveTab(id);
          }}
        />
      )}

      {authState.is_admin && (
        <CredentialsModal
          open={credsOpen}
          onOpenChange={setCredsOpen}
          onSaved={loadStatus}
        />
      )}

      {authState.is_admin && (
        <MorningRefreshModal
          open={morningRefreshOpen}
          onOpenChange={setMorningRefreshOpen}
          onRefreshed={loadStatus}
          onNeedFullSetup={() => setCredsOpen(true)}
        />
      )}

      {authState.is_admin && (
        <TelegramPrefsModal
          open={telegramPrefsOpen}
          onOpenChange={setTelegramPrefsOpen}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        isAdmin={authState.is_admin}
        onSaved={(settings) => {
          applyMarketHoursFromStatus(settings);
          loadStatus();
          if (Array.isArray(settings.visible_pages)) {
            setVisiblePages(settings.visible_pages);
          }
          if (Array.isArray(settings.admin_visible_pages)) {
            setAdminVisiblePages(settings.admin_visible_pages);
          }
          if (typeof settings.oi_poll_interval_seconds === "number") {
            setPollMs(settings.oi_poll_interval_seconds * 1000);
          }
          if (typeof settings.straddle_poll_interval_seconds === "number") {
            setStraddlePollMs(settings.straddle_poll_interval_seconds * 1000);
          }
          if (typeof settings.positions_poll_interval_seconds === "number") {
            setPositionsPollMs(settings.positions_poll_interval_seconds * 1000);
          }
          if (Array.isArray(settings.enabled_indices) && settings.enabled_indices.length) {
            setEnabledIndices(settings.enabled_indices);
          }
          if (Array.isArray(settings.alert_enabled_indices) && settings.alert_enabled_indices.length) {
            setAlertEnabledIndices(settings.alert_enabled_indices);
          }
          if (typeof settings.show_strike_range === "boolean") {
            setShowStrikeRange(settings.show_strike_range);
          }
          if (typeof settings.show_writer_defense === "boolean") {
            setShowWriterDefense(settings.show_writer_defense);
          }
          if (typeof settings.show_suggestion === "boolean") {
            setShowSuggestion(settings.show_suggestion);
          }
          if (typeof settings.show_chart_signals === "boolean") {
            setShowChartSignals(settings.show_chart_signals);
          }
          applyDeskAi(settings);
        }}
        onLocalSaved={setOiSettings}
      />

      {authState.is_admin && (
        <TradeJournalModal
          open={journalOpen}
          onOpenChange={setJournalOpen}
        />
      )}

      <HugeShiftModal
        shift={hugeShift}
        onClose={dismissHugeShift}
        onReplayAtMoment={replayHugeShiftMoment}
      />

      <SoundSettingsModal open={soundsOpen} onOpenChange={setSoundsOpen} />
      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => setUploadRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function IntelCell({ label, value, hint, tone = "slate", tip }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "rose"
        ? "text-rose-700 dark:text-rose-300"
        : "text-slate-800 dark:text-slate-100";
  return (
    <div
      className="oi-panel px-3 py-2.5 flex flex-col leading-tight"
      data-testid={`intel-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className="uppercase tracking-widest text-[9px] text-slate-400 flex items-center gap-1 font-semibold">
        {label}
        {tip && (
          <InfoTip testId={`intel-${label.toLowerCase().replace(/\s+/g, "-")}-tip`}>
            {tip}
          </InfoTip>
        )}
      </span>
      <span className={`text-base font-semibold tabular-nums tracking-tight mt-0.5 ${toneClass}`}>{value ?? "—"}</span>
      {hint ? <span className="text-[10px] text-slate-500 truncate mt-0.5">{hint}</span> : null}
    </div>
  );
}