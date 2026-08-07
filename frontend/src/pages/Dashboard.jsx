import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import OIChart from "@/components/OIChart";
import TimeframePills from "@/components/TimeframePills";
import AlertsPanel from "@/components/AlertsPanel";
import GuestBanner from "@/components/GuestBanner";
import MarketStatusBanner from "@/components/MarketStatusBanner";
import KiteTokenBanner from "@/components/KiteTokenBanner";
import StrikeTable from "@/components/StrikeTable";
import CredentialsModal from "@/components/CredentialsModal";
import MorningRefreshModal from "@/components/MorningRefreshModal";
import TelegramPrefsModal from "@/components/TelegramPrefsModal";
import SettingsModal from "@/components/SettingsModal";
import ReplayScrubber from "@/components/ReplayScrubber";
import SentimentBar from "@/components/SentimentBar";
import HugeShiftModal from "@/components/HugeShiftModal";
import ActivityFeed from "@/components/ActivityFeed";
import HolidaysTab from "@/components/HolidaysTab";
import BuildupTable from "@/components/BuildupTable";
import PositionsPanel from "@/components/PositionsPanel";
import RightPanel from "@/components/RightPanel";
import HolidayBadge from "@/components/HolidayBadge";
import MarketEventsBadge from "@/components/MarketEventsBadge";
import SoundSettingsModal from "@/components/SoundSettingsModal";
import UploadModal from "@/components/UploadModal";
import EventRiskWidget from "@/components/EventRiskWidget";
import StraddleChart from "@/components/StraddleChart";
import MarketImpactBadge from "@/components/MarketImpactBadge";
import SellCandidatesPanel from "@/components/SellCandidatesPanel";
import SuggestionBox from "@/components/SuggestionBox";
import InfoTip from "@/components/InfoTip";
import { biasGuide, pcrGuide, maxPainGuide, supportGuide, resistanceGuide } from "@/lib/metricGuides";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PanelRightOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchOIChange, fetchAlerts, clearAlerts, fetchStatus, fetchVRP, api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
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
const POLL_OPTIONS = [15000, 30000, 60000];
const DEFAULT_POLL_MS = 15000;
const DASHBOARD_PAGES = [
  { v: "oi-change", l: "OI Change" },
  { v: "open-interest", l: "Open Interest" },
  { v: "strike-table", l: "Strike Table" },
  { v: "sell-candidates", l: "Sell Candidates", adminOnly: true },
  { v: "buildup", l: "Build-up" },
  { v: "positions", l: "Positions", adminOnly: true },
  { v: "alerts", l: "Alerts" },
  { v: "activity", l: "Activity" },
  { v: "holidays", l: "Events" },
  { v: "straddle", l: "Straddle" },
  { v: "index-events", l: "Index Risk" },
];
const PUBLIC_DEFAULT_PAGES = DASHBOARD_PAGES.filter((page) => !page.adminOnly).map((page) => page.v);
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

// Minutes elapsed since today's NSE market open (9:15 AM IST), CLAMPED at Index
// F&O / configured close (15:40 IST). During market hours this returns the live
// "9:15 → now" window; after close it caps at a full session so "Full Day"
// stays 9:15 – 15:40. Before open (or on weekends/holidays), return the full
// prior session length — NEVER ~24h, which previously pulled yesterday's OI.
const MARKET_OPEN_MIN = 9 * 60 + 15;   // 9:15 AM IST
const MARKET_CLOSE_MIN = 15 * 60 + 40; // 15:40 IST (Index F&O / CAS default)
function minutesSinceMarketOpenIST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const s = parseInt(parts.find((p) => p.type === "second").value, 10);
  const nowMin = h * 60 + m + s / 60;
  const sessionLen = MARKET_CLOSE_MIN - MARKET_OPEN_MIN; // 385

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
  const [strikesAround, setStrikesAround] = useState(10);
  const [strikeRange, setStrikeRange] = useState({ min: null, max: null });
  const [credsOpen, setCredsOpen] = useState(false);
  const [morningRefreshOpen, setMorningRefreshOpen] = useState(false);
  const [telegramPrefsOpen, setTelegramPrefsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [hugeShift, setHugeShift] = useState(null);   // currently shown modal
  const hugeShiftQueueRef = useRef([]);                // queued shifts if multiple fire back-to-back
  const [activity, setActivity] = useState([]);       // unusual activity feed events
  const [activityFilter, setActivityFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("oi-change");
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("darkMode") === "1"; } catch { return false; }
  });
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem("compact") === "1"; } catch { return false; }
  });
  const [soundsOpen, setSoundsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(() => {
    try { return localStorage.getItem("rightPanelOpen") !== "0"; } catch { return true; }
  });
  const [rightPanelView, setRightPanelView] = useState(() => {
    try { return localStorage.getItem("rightPanelView") || "alerts"; } catch { return "alerts"; }
  });
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
    try { localStorage.setItem("rightPanelView", rightPanelView); } catch (_) { /* noop */ }
  }, [rightPanelView]);

  useEffect(() => {
    // Connect WebSocket (spot). The WS wrapper will itself defer connects
    // during quiescent periods and auto-reconnect on reopen.
    const conn = connectSpotWS((message) => {
      if (message?.type !== "spot" || !Array.isArray(message.tickers)) return;
      const nextPrices = {};
      message.tickers.forEach((ticker) => {
        if (ticker?.index) nextPrices[ticker.index] = ticker.price;
      });
      setLiveSpotPrices(nextPrices);
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

  useEffect(() => {
    if (authState.is_admin) return;
    const allowedTabs = DASHBOARD_PAGES.filter((page) => !page.adminOnly && visiblePages.includes(page.v)).map((page) => page.v);
    if (allowedTabs.length === 0) return;
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [authState.is_admin, activeTab, visiblePages]);

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
  const [oiLoading, setOiLoading] = useState(false);
  const [showStrikeRange, setShowStrikeRange] = useState(false);
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

  const ensureExpiryForIndex = useCallback(async (idx) => {
    const cached = expiryByIndexRef.current[idx];
    if (cached?.selected || cached?.fetched) return cached;
    try {
      const r = await api.get(`/expiries/${idx}`);
      const list = r.data.expiries || [];
      const meta = r.data.expiries_meta || [];
      const note = r.data.note || null;
      const selected = r.data.selected && list.includes(r.data.selected) ? r.data.selected : (list[0] || null);
      const entry = { list, meta, note, selected, fetched: true };
      expiryByIndexRef.current[idx] = entry;
      return entry;
    } catch (e) {
      console.error(`loadExpiries(${idx}) failed`, e);
      const entry = { list: [], meta: [], note: null, selected: null, fetched: true };
      expiryByIndexRef.current[idx] = entry;
      return entry;
    }
  }, []);

  // Poll OI for ALL enabled indices in the background; UI updates only for the active tab.
  const loadOI = useCallback(async () => {
    const indices = enabledIndicesRef.current?.length ? enabledIndicesRef.current : INDICES;
    const active = activeIndexRef.current;
    // Active tab still waits for its expiry picker to settle (avoids cross-index expiry).
    if (active && !expiryReady && !expiryByIndexRef.current[active]?.selected) return;

    const gen = ++oiReqGenRef.current;
    setOiLoading(true);
    const also = (oiSettings.hugeShiftWindows || [1, 3, 5]).join(",");
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
    api.get(`/expiries/${activeIndex}`).then((r) => {
      if (cancelled) return;
      const list = r.data.expiries || [];
      const meta = r.data.expiries_meta || [];
      const note = r.data.note || null;
      setExpiries(list);
      setExpiriesMeta(meta);
      setExpiriesNote(note);
      const selected = r.data.selected && list.includes(r.data.selected) ? r.data.selected : (list[0] || null);
      setSelectedExpiry(selected);
      expiryByIndexRef.current[activeIndex] = { list, meta, note, selected, fetched: true };
      setExpiryReady(true);
    }).catch((e) => {
      console.error("loadExpiries failed", e);
      if (!cancelled) setExpiryReady(true); // allow unscoped fetch as fallback
    });
    return () => { cancelled = true; };
  }, [activeIndex]);

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

  // Poll alerts
  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts();
      const list = data.alerts || [];
      setAlerts(list);
      // detect new alert
      if (list.length && lastAlertIdRef.current !== list[0].created_at) {
        const isFirstLoad = lastAlertIdRef.current === null;
        lastAlertIdRef.current = list[0].created_at;
        if (!isFirstLoad) {
          const a = list[0];
          // Only surface a toast / sound if the alert is for the currently
          // active index — user asked to suppress cross-index noise.
          if (a.index === activeIndex) {
            const isBullish = a.direction?.toLowerCase().includes("bullish") || a.severity === "info";
            const toastFn = isBullish ? toast.success : toast.error;
            toastFn(a.message, {
              description: `Price ${a.price?.toFixed?.(2)} · ATM ${a.atm}`,
              duration: 8000,
            });
            playForAlert("reversal");
            push(`OI Reversal · ${a.index}`, a.direction);
            setFlash(true);
            setTimeout(() => setFlash(false), 1800);
          }
        }
      }
    } catch (e) {
      console.error("loadAlerts failed", e);
    }
  }, [alarm, push, activeIndex]);

  // ---- Straddle poll interval (from API settings) ----
  const [straddlePollMs, setStraddlePollMs] = useState(60000); // default 1 minute

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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get("/settings");
      if (res.data) {
        if (typeof res.data.oi_poll_interval_seconds === "number") {
          const next = res.data.oi_poll_interval_seconds * 1000;
          setPollMs((prev) => (prev === next ? prev : next));
        }
        if (res.data.straddle_poll_interval_seconds) {
          const next = res.data.straddle_poll_interval_seconds * 1000;
          setStraddlePollMs((prev) => (prev === next ? prev : next));
        }
        if (Array.isArray(res.data.visible_pages)) {
          setVisiblePages(res.data.visible_pages);
        }
        if (Array.isArray(res.data.enabled_indices) && res.data.enabled_indices.length) {
          setEnabledIndices(res.data.enabled_indices);
        }
        if (typeof res.data.show_strike_range === "boolean") {
          setShowStrikeRange(res.data.show_strike_range);
        }
      }
    } catch (e) {
      console.error("Failed to fetch settings", e);
    }
  }, []);

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
      if (Array.isArray(d.enabled_indices) && d.enabled_indices.length) {
        setEnabledIndices(d.enabled_indices);
      }
      if (Array.isArray(d.visible_pages)) {
        setVisiblePages(d.visible_pages);
      }
      if (typeof d.show_strike_range === "boolean") {
        setShowStrikeRange(d.show_strike_range);
      }
    }).catch(() => { /* ignore — settings poll will retry */ });
  }, []);

  // Auth state — once on mount + every 60s (not every OI poll).
  useEffect(() => {
    let cancelled = false;
    const refreshAuth = async () => {
      try {
        const { data } = await api.get("/auth/state");
        if (!cancelled) setAuthState(data);
      } catch (_) { /* ignore */ }
    };
    refreshAuth();
    const id = setInterval(refreshAuth, 60_000);
    return () => { cancelled = true; clearInterval(id); };
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
  useQuiescentAwarePolling(
    async () => {
      // Only poll alerts when the alerts tab (or right-panel alerts) is relevant.
      if (authState.is_admin || activeTab === "alerts" || rightPanelView === "alerts") {
        await loadAlerts();
      }
    },
    5000,
    [loadAlerts, authState.is_admin, activeTab, rightPanelView, status?.market?.is_market_open],
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
    lastAlertIdRef.current = null;
    toast.success("Alerts cleared");
  };

  const applyStrikesAround = useCallback((n) => {
    setStrikesAround(n);
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

  useEffect(() => {
    if (!changeSummary || !lastPulledAt) return;
    // Update "last pull change" every time new data arrives so the UI can show
    // both when data was pulled and the OI change seen at that pull.
    setLastPullChange({ ce: changeSummary.ce, pe: changeSummary.pe, at: lastPulledAt, timeframeLabel });
    // Fire local alert ONLY when the market is currently open — no more stale
    // bullish / bearish toasts after 3:30 PM IST.
    if (status?.market && status.market.is_market_open === false) return;
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
      try { alarm(); } catch (_) { /* noop */ }
      try { push(`OI Change · ${activeIndex}`, msg); } catch (_) { /* noop */ }
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
      historyReady // don't fire during the warming-up window; the % is unreliable then
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
      try { push(`OI Change Alert · ${activeIndex}`, title); } catch (_) { /* noop */ }
    }
  }, [changeSummary, lastPulledAt, activeIndex, timeframeLabel, alarm, push, changeAlertPct, historyReady, status?.market]);

  // -------- Huge OI shift monitor (ATM ± 1 across 1/3/5 min windows) --------
  const pushActivity = useCallback((ev) => {
    // Dedupe: same (type,index,strike,side,window,bucket-of-minute) inside a run.
    const bucket = Math.floor(Date.now() / (60 * 1000)); // 1-minute bucket
    const key = `${ev.type}|${ev.index}|${ev.strike || ""}|${ev.side || ""}|${ev.window || ""}|${bucket}`;
    if (seenActivityRef.current.has(key)) return;
    seenActivityRef.current.add(key);
    setActivity((prev) => [{ ...ev, id: `${key}:${Date.now()}` }, ...prev].slice(0, 200));
  }, []);

  const handleHugeShift = useCallback((shift) => {
    // Silence shifts for indices other than the currently viewed one.
    if (shift.index !== activeIndex) return;
    // Also log to activity feed
    pushActivity({
      type: "huge-shift",
      index: shift.index,
      side: shift.side,
      window: shift.window,
      value: shift.value,
      at: shift.at,
      message: `${shift.side} OI ${shift.value > 0 ? "build" : "unwind"} across ATM ± 1 in ${shift.window} min`,
    });
    // If a modal is already showing, queue this one; user must acknowledge
    // each in turn so nothing gets missed.
    if (hugeShift) {
      hugeShiftQueueRef.current.push(shift);
      return;
    }
    setHugeShift(shift);
    try { playForAlert("huge_shift"); } catch (_) { /* noop */ }
    try {
      push(
        `HUGE OI SHIFT · ${shift.index}`,
        `${shift.side} ${shift.value > 0 ? "build" : "unwind"} in last ${shift.window} min`,
      );
    } catch (_) { /* noop */ }
    // Forward to Telegram (fire-and-forget; backend no-ops if not configured).
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
  }, [activeIndex, hugeShift, siren, push, pushActivity]);

  const dismissHugeShift = useCallback(() => {
    setHugeShift(null);
    // Small delay so the dialog exit animation completes before the next one.
    setTimeout(() => {
      const next = hugeShiftQueueRef.current.shift();
      if (next) {
        setHugeShift(next);
        try { playForAlert("huge_shift"); } catch (_) { /* noop */ }
      }
    }, 250);
  }, []);

  useHugeShiftMonitor({
    index: activeIndex,
    windows: oiSettings.hugeShiftWindows,
    thresholdAbs: oiSettings.hugeShiftAbs,
    cooldownMs: 120000,
    onShift: handleHugeShift,
    // Only evaluate while market is open — outside the window data is frozen.
    enabled: !(status?.market && status.market.is_market_open === false),
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

  // Also log backend reversal alerts for the active index into the activity feed.
  useEffect(() => {
    if (!alerts.length) return;
    const a = alerts[0];
    if (a.index !== activeIndex) return;
    const bullish = a.direction?.toLowerCase().includes("bullish");
    pushActivity({
      type: bullish ? "reversal-bullish" : "reversal-bearish",
      index: a.index, at: a.created_at,
      message: a.direction || a.message || "OI reversal",
    });
  }, [alerts, activeIndex, pushActivity]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {authState.is_guest && (
        <GuestBanner
          guestName={authState.guest_name}
          adminName={authState.admin_display_name}
        />
      )}
      <MarketStatusBanner market={status?.market} lastPulledAt={lastPulledAt} />
      <KiteTokenBanner
        status={status}
        isAdmin={authState.is_admin}
        onOpenCreds={() => setCredsOpen(true)}
      />
      <Header
        status={status}
        current={current}
        dataStatus={dataStatus}
        onOpenCreds={() => setCredsOpen(true)}
        onOpenMorningRefresh={() => setMorningRefreshOpen(true)}
        onOpenTelegramPrefs={() => setTelegramPrefsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSounds={() => setSoundsOpen(true)}
        onOpenUpload={() => setUploadOpen(true)}
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
        spotPrices={liveSpotPrices}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {!compact && (
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
          />
        )}

        <main className="flex-1 min-h-0 overflow-auto p-5 dark:bg-slate-950 dark:text-slate-200">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <TabsList className="bg-transparent p-0 h-auto gap-1 border-b border-slate-200 dark:border-slate-700 rounded-none justify-start">
                {DASHBOARD_PAGES.filter((t) => authState.is_admin || (!t.adminOnly && visiblePages.includes(t.v))).map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    data-testid={`tab-${t.v}`}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 dark:data-[state=active]:border-slate-100 data-[state=active]:text-slate-900 dark:data-[state=active]:text-slate-100 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-slate-500 dark:text-slate-400 px-3 py-2 text-sm font-medium"
                  >
                    {t.l}
                  </TabsTrigger>
                ))}
              </TabsList>
              {/* Holiday & Events badges docked to the right of the tab-selector row */}
              <div className="hidden md:flex items-stretch gap-2 ml-auto">
                <div className="w-52">
                  <HolidayBadge onClick={() => setActiveTab("holidays")} />
                </div>
                <div className="w-60">
                  <MarketEventsBadge onClick={() => setActiveTab("holidays")} />
                </div>
                {(authState.is_admin || visiblePages.includes("index-events")) && (
                  <div className="w-64">
                    <MarketImpactBadge
                      activeIndex={activeIndex}
                      onOpenIndexEvents={() => setActiveTab("index-events")}
                    />
                  </div>
                )}
              </div>
            </div>

            <PanelGroup direction="horizontal" autoSaveId="oi-pulse-split" className="w-full h-full min-h-0">
              <Panel defaultSize={rightPanelOpen ? 72 : 100} minSize={50} className={`${flash ? "alert-flash" : ""} min-h-0 overflow-hidden`}>
                <div className="h-full space-y-4 pr-2">
                {changeSummary && (
                  <SentimentBar
                    ceDelta={changeSummary.ce}
                    peDelta={changeSummary.pe}
                    timeframeMin={timeframe}
                  />
                )}
                {!historyReady && (() => {
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
                      className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700 px-3 py-2 text-xs flex items-center gap-2 flex-wrap"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      {previous ? (
                        <span>
                          History warming up — we only have {liveAvailMin.toFixed(1)} min of snapshots so the {timeframeLabel} bars are approximate.
                          <span className="ml-1">
                            True {timeframeLabel} compare unlocks in{" "}
                            <span
                              data-testid="warming-countdown"
                              className="inline-block font-mono-data font-semibold text-amber-900 dark:text-amber-100 tabular-nums"
                            >
                              {clock}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span>
                          Not enough stored history yet for a {timeframeLabel} comparison ({liveAvailMin.toFixed(1)} min available).
                          <span className="ml-1">
                            Unlocks in{" "}
                            <span
                              data-testid="warming-countdown"
                              className="inline-block font-mono-data font-semibold text-amber-900 dark:text-amber-100 tabular-nums"
                            >
                              {clock}
                            </span>
                            . Try a shorter timeframe to see bars sooner.
                          </span>
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1.5 text-[11px]" data-testid="change-alert-threshold-wrapper">
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
                          className="w-14 px-1 py-0.5 rounded border border-amber-300 bg-white/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 font-mono-data text-right"
                        />
                        <span className="opacity-80">%</span>
                      </span>
                    </div>
                  );
                })()}
                <div
                  className={`bg-white dark:bg-slate-900 border rounded-md p-4 transition-all duration-700 ${
                    pulsePull ? "ring-2 ring-sky-300 border-sky-300" : "border-slate-200 dark:border-slate-700"
                  }`}
                  data-testid="oi-change-card"
                  style={
                    changeSummary
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
                  {(authState.is_admin || visiblePages.includes("oi-change")) && (
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
                      signalsMap={perStrikeSignals}
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

                  {(authState.is_admin || visiblePages.includes("open-interest")) && (
                    <TabsContent value="open-interest" className="mt-0">
                      <div className="text-sm font-semibold mb-2">{activeIndex} Absolute Open Interest</div>
                    <OIChart
                      current={filteredCurrent}
                      previous={null}
                      atm={current?.atm}
                      mode={status?.mode}
                    />
                  </TabsContent>
                  )}

                  {(authState.is_admin || visiblePages.includes("strike-table")) && (
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
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                    </div>
                  </TabsContent>
                  )}

                  {(authState.is_admin || visiblePages.includes("sell-candidates")) && (
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

                  {(authState.is_admin || visiblePages.includes("buildup")) && (
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

                  {(authState.is_admin || visiblePages.includes("positions")) && (
                    <TabsContent value="positions" className="mt-0">
                    <div className="text-sm font-semibold mb-2">My Kite Positions</div>
                    <PositionsPanel
                      isKiteMode={status?.mode === "kite"}
                      current={current}
                      vix={current?.vix || status?.vix}
                      oiSettings={oiSettings}
                      activeIndex={activeIndex}
                      expiry={selectedExpiry}
                      onAdjustmentAlert={(payload) => {
                        pushActivity({
                          type: "huge-shift",
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

                  {(authState.is_admin || visiblePages.includes("alerts")) && (
                    <TabsContent value="alerts" className="mt-0">
                    <div className="text-sm font-semibold mb-2">All Alerts</div>
                    <AlertsPanel alerts={alerts} onClear={handleClearAlerts} activeIndex={activeIndex} canClear={authState.is_admin} />
                  </TabsContent>
                  )}

                  {(authState.is_admin || visiblePages.includes("activity")) && (
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

                  {(authState.is_admin || visiblePages.includes("holidays")) && (
                    <TabsContent value="holidays" className="mt-0">
                    <HolidaysTab />
                  </TabsContent>
                  )}

                  {(authState.is_admin || visiblePages.includes("straddle")) && (
                    <TabsContent value="straddle" className="mt-0">
                    <div className="text-sm font-semibold mb-4">{activeIndex} Straddle Premium</div>
                    <StraddleChart
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

                  {(authState.is_admin || visiblePages.includes("index-events")) && (
                    <TabsContent value="index-events" className="mt-0">
                      <EventRiskWidget activeIndex={activeIndex} />
                    </TabsContent>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-md p-3 text-xs text-slate-600 flex items-center justify-between">
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
                </div>
              </Panel>
              {rightPanelOpen && (
                <>
                  <PanelResizeHandle className="w-1 mx-1 bg-slate-200 hover:bg-sky-400 transition-colors cursor-col-resize rounded-full" data-testid="right-panel-handle" />
                  <Panel defaultSize={28} minSize={18} maxSize={55} className="min-h-0 overflow-hidden">
                    <RightPanel
                      view={rightPanelView}
                      onChangeView={setRightPanelView}
                      onClose={() => setRightPanelOpen(false)}
                      visiblePages={visiblePages}
                      isAdmin={authState.is_admin}
                      alerts={alerts}
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
                      activity={activity}
                      activityFilter={activityFilter}
                      setActivityFilter={setActivityFilter}
                      clearActivity={() => { setActivity([]); seenActivityRef.current.clear(); }}
                      isKiteMode={status?.mode === "kite"}
                      status={status}
                      showOI={showOI}
                      // pass configured straddle poll interval (ms)
                      straddlePollMs={straddlePollMs}
                      suggestion={
                        <SuggestionBox
                          indexName={activeIndex}
                          marketIntel={marketIntel}
                          changeSummary={changeSummary}
                          spot={current?.price || current?.atm}
                          vixNow={current?.vix || status?.vix}
                          vixOpen={vixSessionOpen}
                        />
                      }
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
            {!rightPanelOpen && (
              <button
                type="button"
                onClick={() => setRightPanelOpen(true)}
                data-testid="btn-open-right-panel"
                className="fixed right-4 bottom-4 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800 px-3 py-2 text-xs font-semibold flex items-center gap-1.5 z-50"
                title="Reopen side panel"
              >
                <PanelRightOpen className="w-4 h-4" />
                Side Panel
              </button>
            )}
          </Tabs>
        </main>
      </div>

      <CredentialsModal
        open={credsOpen}
        onOpenChange={setCredsOpen}
        onSaved={loadStatus}
      />

      <MorningRefreshModal
        open={morningRefreshOpen}
        onOpenChange={setMorningRefreshOpen}
        onRefreshed={loadStatus}
        onNeedFullSetup={() => setCredsOpen(true)}
      />

      <TelegramPrefsModal
        open={telegramPrefsOpen}
        onOpenChange={setTelegramPrefsOpen}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        isAdmin={authState.is_admin}
        onSaved={(settings) => {
          loadStatus();
          if (Array.isArray(settings.visible_pages)) {
            setVisiblePages(settings.visible_pages);
          }
          if (typeof settings.oi_poll_interval_seconds === "number") {
            setPollMs(settings.oi_poll_interval_seconds * 1000);
          }
          if (typeof settings.straddle_poll_interval_seconds === "number") {
            setStraddlePollMs(settings.straddle_poll_interval_seconds * 1000);
          }
          if (Array.isArray(settings.enabled_indices) && settings.enabled_indices.length) {
            setEnabledIndices(settings.enabled_indices);
          }
          if (typeof settings.show_strike_range === "boolean") {
            setShowStrikeRange(settings.show_strike_range);
          }
        }}
        onLocalSaved={setOiSettings}
      />

      <HugeShiftModal shift={hugeShift} onClose={dismissHugeShift} />

      <SoundSettingsModal open={soundsOpen} onOpenChange={setSoundsOpen} />
      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />
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
      className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/60 px-3 py-2.5 flex flex-col leading-tight shadow-sm"
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