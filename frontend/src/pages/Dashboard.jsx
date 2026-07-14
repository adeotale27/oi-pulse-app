import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import OIChart from "@/components/OIChart";
import TimeframePills from "@/components/TimeframePills";
import AlertsPanel from "@/components/AlertsPanel";
import StrikeTable from "@/components/StrikeTable";
import CredentialsModal from "@/components/CredentialsModal";
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
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PanelRightOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchOIChange, fetchAlerts, clearAlerts, fetchStatus, api } from "@/lib/api";
import { downloadOICsv } from "@/lib/csv";
import { toast } from "sonner";
import { useNotify } from "@/hooks/useNotify";
import { useHugeShiftMonitor } from "@/hooks/useHugeShiftMonitor";
import { loadOISettings } from "@/lib/oiSettings";
import { playForAlert } from "@/lib/sounds";
import { Play, HelpCircle } from "lucide-react";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const POLL_MS = 30000;
// Threshold on aggregate |PE - CE| change relative to base OI that triggers a
// frontend-side alert on each data-pull for the currently viewed timeframe.
const ALERT_INTENSITY = 0.35;
const ALERT_COOLDOWN_MS = 60000;

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

// Minutes elapsed since today's NSE market open (9:15 AM IST). If the current
// wall-clock time is before market open, we fall back to yesterday's open so
// the request always resolves to a valid earlier timestamp.
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
  const openMin = 9 * 60 + 15; // 9:15 AM IST
  const diff = nowMin - openMin;
  if (diff > 0) return Math.ceil(diff);
  // Before market open today: use previous day's open (~24h earlier).
  return Math.ceil(24 * 60 + diff);
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
  const [alerts, setAlerts] = useState([]);
  const [strikesAround, setStrikesAround] = useState(10);
  const [strikeRange, setStrikeRange] = useState({ min: null, max: null });
  const [credsOpen, setCredsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [flash, setFlash] = useState(false);
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [replayFrame, setReplayFrame] = useState(null);
  const [showOI, setShowOI] = useState(true);
  const [replayOpen, setReplayOpen] = useState(false);
  const [lastPulledAt, setLastPulledAt] = useState(null);
  const [lastPullChange, setLastPullChange] = useState(null); // { ce, pe, at }
  const [pulsePull, setPulsePull] = useState(false); // green flash on each fresh pull
  const [oiSettings, setOiSettings] = useState(loadOISettings());
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
  }, []);

  // Poll OI + previous for the active index
  const loadOI = useCallback(async () => {
    try {
      const params = { minutes: resolveMinutes(timeframe) };
      if (selectedExpiry) params.expiry = selectedExpiry;
      const { data } = await api.get(`/oi/${activeIndex}/change`, { params });
      setCurrent(data.current);
      setPrevious(data.previous);
      setLastPulledAt(new Date().toISOString());
      // Visual "just pulled" pulse on the chart card so users can see the
      // bars refresh at each 30-second cycle.
      setPulsePull(true);
      setTimeout(() => setPulsePull(false), 900);
    } catch (e) {
      console.error("loadOI failed", e);
    }
  }, [activeIndex, timeframe, selectedExpiry]);

  // Load expiries for the active index
  useEffect(() => {
    let cancelled = false;
    api.get(`/expiries/${activeIndex}`).then((r) => {
      if (cancelled) return;
      const list = r.data.expiries || [];
      setExpiries(list);
      // reset selected expiry when switching index
      setSelectedExpiry(list[0] || null);
    }).catch((e) => console.error("loadExpiries failed", e));
    return () => { cancelled = true; };
  }, [activeIndex]);

  const handleChangeExpiry = async (exp) => {
    setSelectedExpiry(exp);
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

  useEffect(() => {
    loadStatus();
    loadOI();
    loadAlerts();
    const id1 = setInterval(loadOI, POLL_MS);
    const id2 = setInterval(loadStatus, POLL_MS);
    const id3 = setInterval(loadAlerts, 5000);
    return () => {
      clearInterval(id1); clearInterval(id2); clearInterval(id3);
    };
  }, [loadOI, loadStatus, loadAlerts]);

  // When index changes, immediately clear current/previous & strike range so
  // filters from the previous index don't hide the new index's strikes.
  const prevIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (prevIndexRef.current !== activeIndex) {
      setCurrent(null);
      setPrevious(null);
      setStrikeRange({ min: null, max: null });
      prevIndexRef.current = activeIndex;
    }
  }, [activeIndex]);

  // Once fresh snapshot arrives, initialise strike range to the full span of
  // that snapshot (only if user hasn't already set a range).
  useEffect(() => {
    if (current && current.strikes?.length && (strikeRange.min == null || strikeRange.max == null)) {
      const sorted = [...current.strikes].sort((a, b) => a.strike - b.strike);
      const min = sorted[0].strike;
      const max = sorted[sorted.length - 1].strike;
      setStrikeRange({ min, max });
    }
  }, [current, strikeRange.min, strikeRange.max]);

  // Filter strikes based on user selection
  const filteredCurrent = useMemo(() => {
    if (!current) return null;
    let strikes = [...current.strikes].sort((a, b) => a.strike - b.strike);
    const atm = current.atm;
    if (strikesAround !== "all") {
      const atmIdx = strikes.findIndex((s) => s.strike === atm);
      if (atmIdx >= 0) {
        const lo = Math.max(0, atmIdx - strikesAround);
        const hi = Math.min(strikes.length, atmIdx + strikesAround + 1);
        strikes = strikes.slice(lo, hi);
      }
    }
    if (strikeRange.min != null && strikeRange.max != null) {
      strikes = strikes.filter((s) => s.strike >= strikeRange.min && s.strike <= strikeRange.max);
    }
    return { ...current, strikes };
  }, [current, strikesAround, strikeRange]);

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

  const handleReset = () => {
    if (current?.strikes?.length) {
      setStrikeRange({
        min: current.strikes[0].strike,
        max: current.strikes[current.strikes.length - 1].strike,
      });
      setStrikesAround(10);
    }
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
    return { ce, pe, prevAt: previous?.timestamp, intensity, bullish: pe - ce >= 0 };
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

  useEffect(() => {
    if (!changeSummary || !lastPulledAt) return;
    // Update "last pull change" every time new data arrives so the UI can show
    // both when data was pulled and the OI change seen at that pull.
    setLastPullChange({ ce: changeSummary.ce, pe: changeSummary.pe, at: lastPulledAt, timeframeLabel });
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
  }, [changeSummary, lastPulledAt, activeIndex, timeframeLabel, alarm, push]);

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
    expiry: selectedExpiry,
    windows: oiSettings.hugeShiftWindows,
    thresholdAbs: oiSettings.hugeShiftAbs,
    pollMs: POLL_MS,
    cooldownMs: 120000,
    onShift: handleHugeShift,
    enabled: true,
  });

  // -------- Per-strike activity detector (gamma wall / institution / fast velocity) --------
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
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Header
        status={status}
        current={current}
        onOpenCreds={() => setCredsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSounds={() => setSoundsOpen(true)}
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
      />

      <div className="flex flex-1 overflow-hidden">
        {!compact && (
          <Sidebar
            indices={INDICES}
            activeIndex={activeIndex}
            onChangeIndex={setActiveIndex}
            current={current}
            strikesAround={strikesAround}
            onChangeStrikesAround={setStrikesAround}
            strikeRange={strikeRange}
            onChangeStrikeRange={setStrikeRange}
            onReset={handleReset}
            expiries={expiries}
            selectedExpiry={selectedExpiry}
            onChangeExpiry={handleChangeExpiry}
          />
        )}

        <main className="flex-1 overflow-auto p-5 dark:bg-slate-950 dark:text-slate-200">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <TabsList className="bg-transparent p-0 h-auto gap-1 border-b border-slate-200 dark:border-slate-700 rounded-none justify-start">
                {[
                  { v: "oi-change", l: "OI Change" },
                  { v: "open-interest", l: "Open Interest" },
                  { v: "strike-table", l: "Strike Table" },
                  { v: "buildup", l: "Build-up" },
                  { v: "positions", l: "Positions" },
                  { v: "alerts", l: "Alerts" },
                  { v: "activity", l: "Activity" },
                  { v: "holidays", l: "Events" },
                ].map((t) => (
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
              </div>
            </div>

            <PanelGroup direction="horizontal" autoSaveId="oi-pulse-split" className="w-full">
              <Panel defaultSize={rightPanelOpen ? 72 : 100} minSize={50} className={flash ? "alert-flash" : ""}>
                <div className="h-full space-y-4 pr-2">
                {changeSummary && (
                  <SentimentBar
                    ceDelta={changeSummary.ce}
                    peDelta={changeSummary.pe}
                    timeframeMin={timeframe}
                  />
                )}
                <div
                  className={`bg-white border rounded-md p-4 transition-all duration-700 ${
                    pulsePull ? "ring-2 ring-sky-300 border-sky-300" : "border-slate-200"
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
                    <OIChart
                      key={`${activeIndex}-${current?.timestamp || 'x'}`}
                      current={filteredCurrent}
                      previous={replayFrame || previous}
                      atm={current?.atm}
                      mode={status?.mode}
                      showOI={showOI}
                      currentTime={current?.timestamp}
                      prevTime={(replayFrame || previous)?.timestamp}
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
                          <span className="uppercase tracking-widest text-[9px] opacity-70">Bias</span>
                          <span className="text-sm font-semibold" data-testid="market-verdict-label">{marketIntel.label}</span>
                          <span className={`ml-auto text-[10px] tabular-nums ${marketIntel.score >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {marketIntel.score >= 0 ? "+" : ""}{marketIntel.score}
                          </span>
                        </div>
                        <IntelCell label="PCR" value={marketIntel.pcr.toFixed(2)}
                          hint={marketIntel.pcr >= 1.05 ? "Bullish (≥1.05)" : marketIntel.pcr <= 0.95 ? "Bearish (≤0.95)" : "Neutral"}
                          tone={marketIntel.pcr >= 1.05 ? "emerald" : marketIntel.pcr <= 0.95 ? "rose" : "slate"} />
                        <IntelCell label="Max Pain" value={marketIntel.maxPain?.toLocaleString()}
                          hint={
                            current?.price && marketIntel.maxPain
                              ? current.price > marketIntel.maxPain
                                ? `Spot ${((current.price - marketIntel.maxPain) / marketIntel.maxPain * 100).toFixed(2)}% above`
                                : `Spot ${((marketIntel.maxPain - current.price) / marketIntel.maxPain * 100).toFixed(2)}% below`
                              : ""
                          }
                          tone={current?.price > marketIntel.maxPain ? "emerald" : "rose"} />
                        <IntelCell label="Support" value={marketIntel.support?.toLocaleString()}
                          hint="Highest Put OI" tone="emerald" />
                        <IntelCell label="Resistance" value={marketIntel.resistance?.toLocaleString()}
                          hint="Highest Call OI" tone="rose" />
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
                          <div className="inline-flex items-center px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm font-medium" data-testid="change-summary-title">
                            Change on {formatDayLabel(current?.timestamp)}
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
                            <span className={`text-2xl leading-none ${changeSummary && changeSummary.ce >= 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}`} data-testid="summary-ce-change">
                              {changeSummary ? formatDelta(changeSummary.ce) : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-32 text-sm">Put OI change:</span>
                            <span className={`text-2xl leading-none ${changeSummary && changeSummary.pe >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}`} data-testid="summary-pe-change">
                              {changeSummary ? formatDelta(changeSummary.pe) : "—"}
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
                  </TabsContent>

                  <TabsContent value="open-interest" className="mt-0">
                    <div className="text-sm font-semibold mb-2">{activeIndex} Absolute Open Interest</div>
                    <OIChart
                      current={filteredCurrent}
                      previous={null}
                      atm={current?.atm}
                      mode={status?.mode}
                    />
                  </TabsContent>

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

                  <TabsContent value="alerts" className="mt-0">
                    <div className="text-sm font-semibold mb-2">All Alerts</div>
                    <AlertsPanel alerts={alerts} onClear={handleClearAlerts} activeIndex={activeIndex} />
                  </TabsContent>

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

                  <TabsContent value="holidays" className="mt-0">
                    <HolidaysTab />
                  </TabsContent>
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
                    Auto-refresh every 30s ·{" "}
                    <span className="font-mono-data">
                      {status?.mode === "kite" ? "Live Zerodha feed" : "Demo simulator"}
                    </span>
                  </div>
                </div>
                </div>
              </Panel>
              {rightPanelOpen && (
                <>
                  <PanelResizeHandle className="w-1 mx-1 bg-slate-200 hover:bg-sky-400 transition-colors cursor-col-resize rounded-full" data-testid="right-panel-handle" />
                  <Panel defaultSize={28} minSize={18} maxSize={55}>
                    <RightPanel
                      view={rightPanelView}
                      onChangeView={setRightPanelView}
                      onClose={() => setRightPanelOpen(false)}
                      alerts={alerts}
                      onClearAlerts={handleClearAlerts}
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

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={loadStatus}
        onLocalSaved={setOiSettings}
      />

      <HugeShiftModal shift={hugeShift} onClose={dismissHugeShift} />

      <SoundSettingsModal open={soundsOpen} onOpenChange={setSoundsOpen} />
    </div>
  );
}

function IntelCell({ label, value, hint, tone = "slate" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : "text-slate-700";
  return (
    <div
      className="rounded-md border border-slate-200 bg-white px-3 py-2 flex flex-col leading-tight"
      data-testid={`intel-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className="uppercase tracking-widest text-[9px] text-slate-400">{label}</span>
      <span className={`text-sm font-semibold ${toneClass}`}>{value ?? "—"}</span>
      {hint ? <span className="text-[10px] text-slate-500 truncate">{hint}</span> : null}
    </div>
  );
}
