import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import InfoTip from "@/components/InfoTip";
import PageBrandTitle from "@/components/PageBrandTitle";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FlaskConical,
  Play,
  Square,
  RefreshCw,
  Shield,
  ClipboardCheck,
  X,
} from "lucide-react";

const ALL_INDEXES = ["NIFTY", "SENSEX"];

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  const s = String(iso);
  // Prefer HH:MM:SS.mmm from ISO
  const m = s.match(/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (m) return m[1].replace(/(\.\d{3})\d+$/, "$1");
  return s.slice(11, 23) || s;
}

function fmtMs(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return String(Math.round(Number(v)));
}

const GUIDE = (
  <div className="space-y-2 text-[12px] leading-relaxed">
    <p>
      Near market close there are <b>two separate tools</b> on this page (not one mix):
      <b>15:20 Auto Trade</b> buys one ATM NIFTY CE or PE from the first indicative.
      <b>15:28 Expiry</b> sells Call + Put when the CAS print appears.
    </p>
    <p>
      <b>Paper</b> — live Kite NIFTY + live NSE prints, but the MARKET is a dry-run
      (no fill on your account). Use Auto Trade Paper in the cash session to
      check 15:20 before switching Live.
      <b> Live</b> — real Zerodha MARKET orders (admin only). Do not run both Live.
    </p>
    <p>
      <b>Debug</b> — classic Activate anytime (even after hours). With Paper, windows
      widen so you can see ticks, last close, and dry-run timing.
    </p>
    <p>
      Classic 15:28 expiry does not fire until you click <b>Activate</b> (window ≈ 15:27–15:35 IST).
      15:20 Auto Trade runs from the Auto mode toggle (Paper or Live); classic Activate is not required.
      Tue = NIFTY · Thu = SENSEX.
    </p>
  </div>
);

function toggleIndex(list, name) {
  const set = new Set(list);
  if (set.has(name)) {
    if (set.size <= 1) return list; // keep at least one
    set.delete(name);
  } else {
    set.add(name);
  }
  return ALL_INDEXES.filter((x) => set.has(x));
}

/** Parse "HH:MM:SS" or "HH:MM" against today's IST clock → ms until / since. */
function istWindowPhase(nowMs, startStr, endStr) {
  const parts = (s, fallback) => {
    const m = String(s || fallback).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return { h: 15, mi: 27, se: 0 };
    return { h: Number(m[1]), mi: Number(m[2]), se: Number(m[3] || 0) };
  };
  const start = parts(startStr, "15:27:00");
  const end = parts(endStr, "15:35:00");
  // Convert epoch → IST wall clock via Intl (no extra deps).
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bits = Object.fromEntries(fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const h = Number(bits.hour);
  const mi = Number(bits.minute);
  const se = Number(bits.second);
  const nowSec = h * 3600 + mi * 60 + se;
  const startSec = start.h * 3600 + start.mi * 60 + start.se;
  const endSec = end.h * 3600 + end.mi * 60 + end.se;
  if (nowSec < startSec) {
    return { phase: "before", secs: startSec - nowSec, label: "to watch" };
  }
  if (nowSec <= endSec) {
    return { phase: "inside", secs: endSec - nowSec, label: "left in window" };
  }
  return { phase: "after", secs: nowSec - endSec, label: "past window" };
}

function fmtCountdown(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function CasPanel({ isAdmin = false, isKiteMode = false, onOpenKite }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lots, setLots] = useState(1);
  const [watchIndexes, setWatchIndexes] = useState(["NIFTY", "SENSEX"]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("live"); // live | backtest
  const [casArm, setCasArm] = useState(() => {
    try {
      return localStorage.getItem("casDeskArm") === "auto" ? "auto" : "expiry";
    } catch {
      return "expiry";
    }
  });
  const [autoLots, setAutoLots] = useState(1);
  const [btStart, setBtStart] = useState("");
  const [btEnd, setBtEnd] = useState("");
  const [btLots, setBtLots] = useState(1);
  const [btIndexes, setBtIndexes] = useState(["NIFTY", "SENSEX"]);
  const [btResult, setBtResult] = useState(null);
  const [btBusy, setBtBusy] = useState(false);
  const [injectValue, setInjectValue] = useState("24007.50");
  const injectTouched = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [readinessOpen, setReadinessOpen] = useState(() => {
    try {
      return localStorage.getItem("casLiveReadinessOpen") === "1";
    } catch {
      return false;
    }
  });
  const statusGen = useRef(0);
  const busyRef = useRef(false);
  const lotsDirty = useRef(false);
  const autoLotsDirty = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const applyStatus = useCallback((data, gen) => {
    if (gen != null && gen !== statusGen.current) return; // stale
    setStatus(data);
    if (!autoLotsDirty.current && data?.settings?.auto_trade_lots != null) {
      setAutoLots(Number(data.settings.auto_trade_lots) || 1);
    }
    if (!lotsDirty.current) {
      const cfgLots = data?.config?.lots ?? data?.settings?.lots;
      if (cfgLots != null) setLots(Number(cfgLots) || 1);
    }
    const wi =
      data?.config?.watch_indexes ||
      data?.settings?.watch_indexes ||
      null;
    if (Array.isArray(wi) && wi.length) {
      setWatchIndexes(wi.map((x) => String(x).toUpperCase()));
    }
    const liveInd = data?.auto_trade?.nse_last_value;
    if (!injectTouched.current && liveInd != null && Number(liveInd) > 0) {
      setInjectValue(String(liveInd));
    }
  }, []);

  const load = useCallback(async ({ quiet } = {}) => {
    if (busyRef.current) return; // don't overwrite mid-toggle
    const gen = ++statusGen.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const { data } = await api.get("/cas/status", { timeout: 25000 });
      applyStatus(data, gen);
      if (gen === statusGen.current) setError(null);
    } catch (e) {
      if (gen === statusGen.current) {
        const msg = e?.response?.data?.detail || e.message || "Failed to load CAS";
        const isTimeout = /timeout/i.test(String(msg));
        if (!quiet || !isTimeout) setError(msg);
      }
    } finally {
      if (!quiet && gen === statusGen.current) setLoading(false);
    }
  }, [applyStatus]);

  const casQuiet = isMarketQuiescent(new Date(nowMs));

  useEffect(() => {
    load();
    // After hours a 3s CAS poll is what floods the Network tab (2k+ calls overnight).
    const id = setInterval(() => load({ quiet: true }), casQuiet ? 60_000 : 3000);
    return () => clearInterval(id);
  }, [load, casQuiet]);

  const plain = status?.plain || {};
  const cfg = status?.config || {};
  const state = status?.state || {};
  const day = status?.day || {};
  const activated = !!plain.activated || !!state.activated;
  const live = !!(
    plain.live ??
    cfg.live_trading ??
    status?.settings?.live_trading
  );
  const debug = !!(
    plain.debug ??
    cfg.debug_mode ??
    status?.settings?.debug_mode
  );
  const auto = status?.auto_trade || {};
  const autoMode = String(status?.settings?.auto_trade_mode || auto.mode || "off").toLowerCase();
  const autoEnabled = !!(status?.settings?.auto_trade_enabled || auto.enabled);
  const autoLive = autoMode === "live";
  const autoPaper = autoMode === "paper";
  const fills = state.fills || [];
  const timings = state.timings || [];
  const watching = day.indexes || plain.watching || watchIndexes;
  const ticks =
    plain.ticks ??
    state.ticks_seen ??
    status?.ws?.ticks_received ??
    0;
  const marketClosed = !!status?.market_closed && !debug;
  const readiness = status?.live_readiness || {};

  const modeTone = useMemo(() => {
    if (activated && live) return "rose";
    if (activated && debug) return "amber";
    if (activated) return "emerald";
    if (debug) return "amber";
    return "slate";
  }, [activated, live, debug]);

  const patchSettings = async (patch) => {
    if (!isAdmin) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const gen = ++statusGen.current;
    try {
      const { data } = await api.post("/cas/settings", patch);
      applyStatus(data, gen);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const persistArm = (arm) => {
    setCasArm(arm);
    try {
      localStorage.setItem("casDeskArm", arm);
    } catch {
      /* noop */
    }
  };

  const saveLots = async (nextLots) => {
    const n = Math.max(1, Math.min(50, Number(nextLots) || 1));
    setLots(n);
    lotsDirty.current = false;
    await patchSettings({ lots: n });
  };

  const saveAutoLots = async (nextLots) => {
    const n = Math.max(1, Math.min(50, Number(nextLots) || 1));
    setAutoLots(n);
    autoLotsDirty.current = false;
    await patchSettings({ auto_trade_lots: n });
  };

  const setAutoTradeMode = async (mode) => {
    if (!isAdmin) return;
    if (mode === "live") {
      const ok = window.confirm(
        "AUTO-TRADE LIVE?\n\nAt ~15:20 IST this will place ONE real MARKET BUY of ATM NIFTY CE or PE.\nYou exit yourself in Positions. Do not also Activate classic CAS Live."
      );
      if (!ok) return;
    }
    if (mode === "off") {
      await patchSettings({ auto_trade_mode: "off", auto_trade_enabled: false });
      return;
    }
    await patchSettings({ auto_trade_mode: mode, auto_trade_enabled: true });
  };

  const injectAutoTrade = async () => {
    if (!isAdmin) return;
    const n = Number(injectValue);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a NIFTY indicative print to inject");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const gen = ++statusGen.current;
    try {
      const { data } = await api.post("/cas/auto-trade/inject", { indicative: n });
      applyStatus(data, gen);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const setLiveTrading = async (on) => {
    if (!isAdmin) return;
    if (on) {
      const ok = window.confirm(
        "Switch to LIVE?\n\nActivate will place real MARKET sells on Zerodha.\nUse Paper to practise safely."
      );
      if (!ok) return;
    }
    await patchSettings({ live_trading: !!on });
  };

  const setDebugMode = async (on) => {
    if (!isAdmin) return;
    await patchSettings({ debug_mode: !!on });
  };

  const toggleReadiness = (open) => {
    setReadinessOpen(open);
    try {
      localStorage.setItem("casLiveReadinessOpen", open ? "1" : "0");
    } catch {
      /* noop */
    }
  };

  const setWatch = async (next) => {
    setWatchIndexes(next);
    await patchSettings({ watch_indexes: next });
  };

  const activate = async () => {
    if (!isAdmin) return;
    if (live) {
      const ok = window.confirm(
        "ACTIVATE LIVE CAS?\n\nReal MARKET sells will fire when CAS print arrives for selected indexes.\nOnly continue if you mean it."
      );
      if (!ok) return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const gen = ++statusGen.current;
    try {
      const { data } = await api.post("/cas/activate", { confirm_live: !!live });
      applyStatus(data, gen);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (!isAdmin) return;
    busyRef.current = true;
    setBusy(true);
    const gen = ++statusGen.current;
    try {
      const { data } = await api.post("/cas/deactivate");
      applyStatus(data, gen);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runBacktest = async () => {
    setBtBusy(true);
    setBtResult(null);
    setError(null);
    try {
      const { data } = await api.post("/cas/backtest", {
        start: btStart || undefined,
        end: btEnd || undefined,
        lots: btLots,
        indexes: btIndexes,
      });
      setBtResult(data.result || null);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBtBusy(false);
    }
  };

  const toneBox = {
    rose: "border-rose-300 bg-rose-50 text-rose-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  }[modeTone];

  const watchStart = (cfg.watch_start || "15:27:00").slice(0, 8);
  const watchEnd = (cfg.watch_end || "15:35:00").slice(0, 8);
  const moveStart = (cfg.move_window_start || "15:28:00").slice(0, 5);
  const moveEnd = (cfg.move_window_end || "15:30:00").slice(0, 5);
  const windowPhase = useMemo(
    () => istWindowPhase(nowMs, watchStart, watchEnd),
    [nowMs, watchStart, watchEnd],
  );

  return (
    <div className="space-y-4" data-testid="cas-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PageBrandTitle title="CAS" testId="cas-page-title" />
          <InfoTip title="Two CAS tools" testId="cas-guide-tip">
            {GUIDE}
          </InfoTip>
          {day.weekday && (
            <span className="text-[10px] font-mono-data bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm">
              {day.weekday} {day.date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={tab === "live" ? "default" : "outline"}
            className="h-7 rounded-sm text-xs"
            onClick={() => setTab("live")}
            data-testid="cas-tab-live"
          >
            Today
          </Button>
          <Button
            size="sm"
            variant={tab === "backtest" ? "default" : "outline"}
            className="h-7 rounded-sm text-xs"
            onClick={() => setTab("backtest")}
            data-testid="cas-tab-backtest"
          >
            <FlaskConical className="w-3.5 h-3.5 mr-1" />
            Backtest
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-sm"
            onClick={load}
            disabled={loading}
            data-testid="cas-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex flex-wrap items-center gap-2"
          data-testid="cas-error"
        >
          <span className="flex-1 min-w-0">{error}</span>
          {typeof onOpenKite === "function" && /kite|token|auth|credential|session/i.test(String(error)) && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-sm border-rose-300 bg-white text-rose-800"
              onClick={onOpenKite}
              data-testid="cas-error-reconnect"
            >
              Reconnect Kite
            </Button>
          )}
        </div>
      )}

      {!isKiteMode && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div className="flex-1 min-w-0">
            <b>Kite not connected.</b> Paper and Live both need credentials.
          </div>
          {typeof onOpenKite === "function" && (
            <Button
              size="sm"
              className="h-7 rounded-sm bg-amber-700 hover:bg-amber-800 text-white"
              onClick={onOpenKite}
              data-testid="cas-reconnect-kite"
            >
              Reconnect Kite
            </Button>
          )}
        </div>
      )}

      {tab === "live" && (
        <>
          <div
            className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-1"
            data-testid="cas-arm-toggle"
          >
            <button
              type="button"
              onClick={() => persistArm("auto")}
              className={`px-3 h-8 text-[11px] font-semibold rounded-sm ${
                casArm === "auto"
                  ? "bg-sky-700 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
              data-testid="cas-arm-auto"
            >
              15:20 Auto Trade · BUY one
            </button>
            <button
              type="button"
              onClick={() => persistArm("expiry")}
              className={`px-3 h-8 text-[11px] font-semibold rounded-sm ${
                casArm === "expiry"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
              data-testid="cas-arm-expiry"
            >
              15:28 Expiry · SELL both
            </button>
          </div>

          {casArm === "expiry" && (
          <>
          <div
            className={`sticky top-0 z-20 rounded-md border px-3 py-2 shadow-sm backdrop-blur-sm ${toneBox}`}
            data-testid="cas-panic-strip"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 font-bold uppercase tracking-wide ${
                  activated ? (live ? "text-rose-800" : "text-emerald-800") : "text-slate-600"
                }`}
                data-testid="cas-panic-armed"
              >
                {activated ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Armed
                  </>
                ) : (
                  <>
                    <Clock3 className="w-3.5 h-3.5" />
                    Idle
                  </>
                )}
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${
                  live
                    ? "border-rose-400 bg-rose-100 text-rose-900"
                    : "border-emerald-400 bg-emerald-100 text-emerald-900"
                }`}
                data-testid="cas-panic-mode"
              >
                {live ? "LIVE" : "PAPER"}
                {debug ? " · DEBUG" : ""}
              </span>
              <span className="font-mono-data text-slate-800" data-testid="cas-panic-countdown">
                {windowPhase.phase === "before" && (
                  <>⏱ {fmtCountdown(windowPhase.secs)} <span className="text-slate-500">{windowPhase.label}</span></>
                )}
                {windowPhase.phase === "inside" && (
                  <>
                    <span className="text-amber-900 font-semibold">IN WINDOW</span>
                    {" · "}
                    {fmtCountdown(windowPhase.secs)} {windowPhase.label}
                  </>
                )}
                {windowPhase.phase === "after" && (
                  <span className="text-slate-500">Window closed</span>
                )}
                <span className="text-slate-400"> · {String(watchStart).slice(0, 5)}–{String(watchEnd).slice(0, 5)} IST</span>
              </span>
              <span className="ml-auto font-mono-data text-slate-600" data-testid="cas-panic-ticks">
                {state.ws_connected ? "Feed ·" : activated ? "Waiting feed ·" : "Feed off ·"}
                {" "}ticks {ticks}
                {plain.last_error ? (
                  <span className="text-rose-700"> · err</span>
                ) : null}
              </span>
            </div>
          </div>

          <div className={`rounded-md border px-4 py-3 ${toneBox}`} data-testid="cas-status-banner">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {activated ? <CheckCircle2 className="w-4 h-4" /> : <Clock3 className="w-4 h-4" />}
              {plain.mode_label || "Loading…"}
            </div>
            <div className="mt-1 text-[11px] opacity-90">
              Will trade: {watching.length ? watching.join(", ") : "—"}
              {plain.fired?.length ? ` · Fired: ${plain.fired.join(", ")}` : ""}
              {state.ws_connected ? " · Feed connected" : activated ? " · Waiting for feed…" : ""}
              {debug ? " · Debug on" : ""}
            </div>
          </div>

          {/* Controls: mode + debug + lots + indexes + arm */}
          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Trade mode
                </div>
                <div
                  className="inline-flex rounded-sm border border-slate-200 overflow-hidden"
                  data-testid="cas-mode-toggle"
                >
                  <button
                    type="button"
                    disabled={!isAdmin || busy}
                    onClick={() => live && setLiveTrading(false)}
                    className={`px-3 h-8 text-xs font-semibold ${
                      !live
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid="cas-mode-paper"
                  >
                    Paper
                  </button>
                  <button
                    type="button"
                    disabled={!isAdmin || busy}
                    onClick={() => !live && setLiveTrading(true)}
                    className={`px-3 h-8 text-xs font-semibold border-l border-slate-200 ${
                      live
                        ? "bg-rose-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid="cas-mode-live"
                  >
                    Live
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {live ? "Real MARKET sells" : "Dry-run only — no broker orders"}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                  <Bug className="w-3 h-3" /> Debug
                </div>
                <div className="flex items-center gap-2 h-8">
                  <Switch
                    checked={debug}
                    disabled={!isAdmin || busy}
                    onCheckedChange={setDebugMode}
                    data-testid="cas-debug-toggle"
                  />
                  <span className="text-[11px] text-slate-700">
                    {debug ? "On — Activate anytime" : "Off — market hours only"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Expiry lots</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={lots}
                  disabled={!isAdmin || busy}
                  onChange={(e) => {
                    lotsDirty.current = true;
                    setLots(Number(e.target.value) || 1);
                  }}
                  onBlur={() => saveLots(lots)}
                  className="mt-0.5 w-16 h-8 px-2 text-sm border border-slate-200 rounded-sm font-mono-data"
                  data-testid="cas-lots"
                />
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Indexes
                </div>
                <div className="flex items-center gap-2 h-8" data-testid="cas-index-select">
                  {ALL_INDEXES.map((idx) => {
                    const on = watchIndexes.includes(idx);
                    return (
                      <label
                        key={idx}
                        className={`inline-flex items-center gap-1.5 px-2 h-8 text-xs border rounded-sm cursor-pointer ${
                          on
                            ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                            : "border-slate-200 bg-white text-slate-500"
                        } ${!isAdmin ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="accent-emerald-600"
                          checked={on}
                          disabled={!isAdmin || busy}
                          onChange={() => setWatch(toggleIndex(watchIndexes, idx))}
                          data-testid={`cas-index-${idx.toLowerCase()}`}
                        />
                        {idx}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="ml-auto">
                {isAdmin ? (
                  !activated ? (
                    <Button
                      size="sm"
                      className={`h-9 rounded-sm ${
                        live
                          ? "bg-rose-600 hover:bg-rose-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                      onClick={activate}
                      disabled={busy || !isKiteMode || marketClosed}
                      data-testid="cas-activate"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Activate {live ? "Live" : "Paper"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-sm border-slate-300"
                      onClick={deactivate}
                      disabled={busy}
                      data-testid="cas-deactivate"
                    >
                      <Square className="w-3.5 h-3.5 mr-1" />
                      Deactivate
                    </Button>
                  )
                ) : (
                  <div className="text-[11px] text-slate-500">
                    View only — ask admin to Activate / change mode.
                  </div>
                )}
              </div>
            </div>

            {live && (
              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-sm px-2 py-1.5 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                Live is selected. Activate only if you intend to sell options for real.
              </div>
            )}
            {debug && !live && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-sm px-2 py-1.5">
                Debug + Paper: CAS can arm outside market hours. Watch/move windows widen so you
                can see ticks, last close, and dry-run timing.
              </div>
            )}
            {marketClosed && !debug && (
              <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-sm px-2 py-1.5">
                Market closed for CAS (after 15:41 IST). Turn on Debug to rehearse, or try tomorrow.
              </div>
            )}
            {plain.last_error && (
              <div
                className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-sm px-2 py-1.5"
                data-testid="cas-last-error"
              >
                Last order/engine error: {plain.last_error}
              </div>
            )}
          </div>
          </>
          )}

          {casArm === "auto" && (
          <section
            className="rounded-md border border-sky-200 bg-sky-50/40 p-3 space-y-3"
            data-testid="cas-auto-trade"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-sky-800">
                  15:20 Auto Trade — BUY one ATM
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-prose">
                  Separate from 15:28 expiry sells. NIFTY only: freeze live Kite NIFTY ~15:19:30, lock that
                  ATM, then one MARKET <b>BUY</b> of CE or PE if the first 15:20 NSE indicative is ±15 pts.
                  <b>Paper</b> uses that same live tape and prints a <b>DRY-BUY</b> id (no Zerodha fill) so you
                  can watch a real session before Live. You exit in Positions. Lots below are{" "}
                  <b>this arm only</b> (not expiry lots).
                </p>
              </div>
              <InfoTip title="Auto Trade" testId="cas-auto-trade-tip">
                <div className="space-y-2 text-[12px] leading-relaxed">
                  <p>
                    Website JSON is seconds-late, not exchange multicast. Leave Auto mode on{" "}
                    <b>Paper</b> during cash hours: real NIFTY freeze, real NSE first print, dry-run
                    BUY. Switch Live only after that looks right. Do not run Auto-Trade Live together
                    with classic CAS Live.
                  </p>
                  <p>
                    ATM is never taken from the indicative print. Overnight CLOSE leftovers are
                    ignored.
                  </p>
                </div>
              </InfoTip>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Auto mode
                </div>
                <div
                  className="inline-flex rounded-sm border border-slate-200 overflow-hidden"
                  data-testid="cas-auto-mode-toggle"
                >
                  {[
                    ["off", "Off"],
                    ["paper", "Paper"],
                    ["live", "Live"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!isAdmin || busy}
                      onClick={() => setAutoTradeMode(mode)}
                      className={`px-3 h-8 text-xs font-semibold border-l first:border-l-0 border-slate-200 ${
                        autoMode === mode
                          ? mode === "live"
                            ? "bg-rose-600 text-white"
                            : mode === "paper"
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-700 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                      data-testid={`cas-auto-mode-${mode}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Auto lots</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={autoLots}
                  disabled={!isAdmin || busy}
                  onChange={(e) => {
                    autoLotsDirty.current = true;
                    setAutoLots(Number(e.target.value) || 1);
                  }}
                  onBlur={() => saveAutoLots(autoLots)}
                  className="mt-0.5 w-16 h-8 px-2 text-sm border border-slate-200 rounded-sm font-mono-data bg-white"
                  data-testid="cas-auto-lots"
                  title="Contracts to BUY on the 15:20 arm. Independent of 15:28 expiry lots."
                />
                <div className="text-[10px] text-slate-500 mt-0.5">qty = lots × NIFTY lot</div>
              </div>
              <div className="text-[11px] text-slate-600 pb-1">
                Status{" "}
                <b className="font-mono-data" data-testid="cas-auto-status">
                  {auto.status || "IDLE"}
                </b>
                {autoEnabled ? ` · ${autoMode}` : " · off"}
              </div>
            </div>

            {autoPaper && (
              <ol className="text-[11px] text-emerald-950 bg-emerald-50 border border-emerald-100 rounded-sm px-3 py-2 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  <b>Leave Paper on</b> through the cash session (09:15–15:30 IST). The engine uses live
                  Kite NIFTY and live NSE JSON. At ~15:19:30 it freezes ATM; at 15:20 it may DRY-BUY
                  one CE or PE. Nothing hits your Zerodha account.
                </li>
                <li>
                  Watch <b>NSE live</b> below — first pull and every change show there. Errors stay in
                  the strip. Classic Activate is not needed.
                </li>
                <li>
                  <b>Inject</b> is optional: type a fake 15:20 print (e.g. freeze+20). Before 15:20 it
                  is only a rehearsal (does not spend today’s fire). From 15:20, inject <i>is</i> today’s
                  paper fire — don’t inject if you want NSE to fire.
                </li>
              </ol>
            )}
            {autoLive && (
              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-sm px-2 py-1.5 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                Auto-Trade Live will BUY one ATM option around 15:20. Keep classic CAS on Paper. To
                only check NSE scrape, switch this toggle to Paper.
              </div>
            )}

            <AutoTapeStrip auto={auto} autoLots={autoLots} />

            {isAdmin && autoPaper && !autoLive && (
              <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-slate-100">
                <label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Inject print (paper)
                  <input
                    type="number"
                    step="0.05"
                    value={injectValue}
                    disabled={busy}
                    onChange={(e) => {
                      injectTouched.current = true;
                      setInjectValue(e.target.value);
                    }}
                    className="mt-0.5 block w-28 h-8 px-2 text-sm border border-slate-200 rounded-sm font-mono-data"
                    data-testid="cas-auto-inject-value"
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-sm"
                  onClick={injectAutoTrade}
                  disabled={busy || !isKiteMode}
                  data-testid="cas-auto-inject"
                >
                  Inject first print
                </Button>
                <p className="text-[10px] text-slate-500 max-w-md leading-snug">
                  Number = fake NSE indicative. Example: if frozen NIFTY is 23980, enter 24007 to
                  rehearse a +27 CE. Needs Kite connected. Before 15:20 = rehearsal only.
                </p>
              </div>
            )}
          </section>
          )}

          {casArm === "expiry" && (
          <>
          {/* Live readiness — collapsed by default; open on demand */}
          <div className="rounded-md border border-slate-200 bg-white" data-testid="cas-live-readiness">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50/80"
              onClick={() => toggleReadiness(!readinessOpen)}
              data-testid="cas-live-readiness-toggle"
            >
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                <ClipboardCheck className="w-3.5 h-3.5" />
                Live order readiness
                {readiness.ready_for_code ? (
                  <span className="normal-case font-semibold text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-sm">
                    code OK
                  </span>
                ) : (
                  <span className="normal-case font-semibold text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-sm">
                    check
                  </span>
                )}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                {readinessOpen ? "Hide" : "Show"}
                {readinessOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </button>
            {readinessOpen && (
              <div className="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {readiness.summary ||
                      "CAS places regular MARKET SELLs (CE+PE) with market_protection=-1."}
                  </p>
                  <button
                    type="button"
                    className="shrink-0 p-1 rounded-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    onClick={() => toggleReadiness(false)}
                    title="Hide readiness"
                    data-testid="cas-live-readiness-close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {readiness.egress_ip && (
                  <p
                    className="text-[12px] font-mono-data text-slate-800 bg-slate-50 border border-slate-100 rounded-sm px-2 py-1.5"
                    data-testid="cas-egress-ip"
                  >
                    Backend egress IP to whitelist: <b>{readiness.egress_ip}</b>
                    <span className="block text-[10px] text-slate-500 font-sans mt-0.5">
                      This is the server that calls Zerodha (Emergent host if API is there) — not your
                      computer&apos;s IP unless you run the backend locally.
                    </span>
                  </p>
                )}
                <ul className="space-y-1.5">
                  {(readiness.checks || []).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start gap-2 text-[11px] text-slate-700"
                      data-testid={`cas-ready-${c.id}`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {c.ok === true ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : c.ok === false ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        )}
                      </span>
                      <span>
                        <b>{c.label}</b>
                        <span className="text-slate-500"> — {c.fix}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* TODAY's RUN */}
          <section className="rounded-md border border-slate-200 bg-white p-3 space-y-2" data-testid="cas-today-run">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Today&apos;s run
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Watch <b>{watchStart}–{watchEnd}</b> · fire on move{" "}
                <b>{moveStart}–{moveEnd} IST</b>
                {debug && !live ? " (debug: any-time)" : " (never at watch open alone)"}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <MiniCard label="Today" value={`${day.date || "—"} · ${day.weekday || ""}`} />
              <MiniCard
                label="Will trade"
                value={watching.length ? watching.join(", ") : "—"}
              />
              <MiniCard label="Watch window" value={`${watchStart}–${watchEnd} IST`} />
              <MiniCard label="Move window" value={`${moveStart}–${moveEnd} IST`} />
              <MiniCard label="Feed ticks" value={String(ticks)} mono />
            </div>
          </section>

          {/* PRICES */}
          <section className="rounded-md border border-slate-200 bg-white p-3 space-y-2" data-testid="cas-prices">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Prices</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                <b>Last close</b> = previous session (history, once). <b>LTP</b> streams while CAS
                is armed. <b>Last move</b> = last LTP change in the watch window (trigger point for
                sells between {moveStart}–{moveEnd}).
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_INDEXES.map((idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2">
                  <MiniCard
                    label={`${idx} LTP`}
                    value={fmt(state.last_ltp?.[idx], 2)}
                    mono
                  />
                  <MiniCard
                    label={`Last close ${idx}`}
                    value={fmt(state.baseline_close?.[idx], 2)}
                    mono
                  />
                  <MiniCard
                    label={`Last move ${idx}`}
                    value={fmtTime(state.last_index_move_at?.[idx])}
                    mono
                    highlight={!!state.last_index_move_at?.[idx]}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* CAS → SELL TIMING */}
          <section className="rounded-md border border-slate-200 bg-white overflow-hidden" data-testid="cas-timing">
            <div className="px-3 py-2 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                CAS → Sell timing
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Detects a WebSocket tick of a CAS LTP move / close flip, then parallel MARKET SELL
                for CE + PE. PAPER rows are dry-run latency only.
              </p>
            </div>
            {timings.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                No CAS detect yet. After Activate, timing rows appear here when an index moves /
                closes.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-[11px] font-mono-data">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1.5">Index</th>
                      <th className="text-right px-2 py-1.5">Close</th>
                      <th className="text-left px-2 py-1.5">CAS detected</th>
                      <th className="text-left px-2 py-1.5">CE sold</th>
                      <th className="text-left px-2 py-1.5">PE sold</th>
                      <th className="text-right px-2 py-1.5">→CE ms</th>
                      <th className="text-right px-2 py-1.5">→PE ms</th>
                      <th className="text-right px-2 py-1.5">Total ms</th>
                      <th className="text-left px-2 py-1.5">Mode</th>
                      <th className="text-left px-2 py-1.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timings.map((t, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid="cas-timing-row">
                        <td className="px-2 py-1.5 font-semibold">{t.index}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(t.close_price, 2)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.cas_detected_at)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.ce_sold_at)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.pe_sold_at)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_ce_ms)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_pe_ms)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_done_ms)}</td>
                        <td className="px-2 py-1.5">
                          {t.dry_run !== false ? (
                            <span className="text-emerald-700 font-semibold">PAPER</span>
                          ) : (
                            <span className="text-rose-700 font-semibold">LIVE</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">
                          {t.source || "—"}
                          {t.trigger ? ` · ${t.trigger}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Fills */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
              Today&apos;s fills ({fills.length})
            </div>
            {fills.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                No sells yet. After Activate, fills appear here when CAS fires.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs font-mono-data">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1.5">Time</th>
                      <th className="text-left px-2 py-1.5">Index</th>
                      <th className="text-left px-2 py-1.5">Leg</th>
                      <th className="text-left px-2 py-1.5">Symbol</th>
                      <th className="text-right px-2 py-1.5">Qty</th>
                      <th className="text-left px-2 py-1.5">Order</th>
                      <th className="text-left px-2 py-1.5">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((f, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid="cas-fill-row">
                        <td className="px-2 py-1.5">{String(f.ts || "").slice(11, 19) || "—"}</td>
                        <td className="px-2 py-1.5">{f.index}</td>
                        <td className="px-2 py-1.5">
                          {f.opt_type} {f.strike}
                        </td>
                        <td className="px-2 py-1.5">{f.tradingsymbol}</td>
                        <td className="px-2 py-1.5 text-right">{f.quantity}</td>
                        <td className="px-2 py-1.5">{String(f.order_id || "—")}</td>
                        <td className="px-2 py-1.5">
                          {f.dry_run ? (
                            <span className="text-emerald-700">Paper</span>
                          ) : (
                            <span className="text-rose-700 font-semibold">Live</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
          )}
        </>
      )}

      {tab === "backtest" && (
        <div className="rounded-md border border-slate-200 bg-white p-4 space-y-3" data-testid="cas-backtest">
          <div className="text-xs text-slate-600 leading-relaxed">
            Replays past expiry days with the <b>same strike + sell logic</b>. No live orders.
            Uses Kite history when connected; otherwise estimates premiums.
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[10px] uppercase text-slate-500">From</div>
              <input
                type="date"
                value={btStart}
                onChange={(e) => setBtStart(e.target.value)}
                className="h-8 px-2 text-xs border border-slate-200 rounded-sm"
                data-testid="cas-bt-start"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">To</div>
              <input
                type="date"
                value={btEnd}
                onChange={(e) => setBtEnd(e.target.value)}
                className="h-8 px-2 text-xs border border-slate-200 rounded-sm"
                data-testid="cas-bt-end"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Lots</div>
              <input
                type="number"
                min={1}
                max={50}
                value={btLots}
                onChange={(e) => setBtLots(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-16 px-2 text-xs border border-slate-200 rounded-sm font-mono-data"
                data-testid="cas-bt-lots"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500 mb-1">Indexes</div>
              <div className="flex items-center gap-2" data-testid="cas-bt-indexes">
                {ALL_INDEXES.map((idx) => {
                  const on = btIndexes.includes(idx);
                  return (
                    <label
                      key={idx}
                      className={`inline-flex items-center gap-1.5 px-2 h-8 text-xs border rounded-sm cursor-pointer ${
                        on
                          ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                          : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600"
                        checked={on}
                        onChange={() => setBtIndexes(toggleIndex(btIndexes, idx))}
                        data-testid={`cas-bt-index-${idx.toLowerCase()}`}
                      />
                      {idx}
                    </label>
                  );
                })}
              </div>
            </div>
            <Button
              size="sm"
              className="h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700"
              onClick={runBacktest}
              disabled={btBusy || !btIndexes.length}
              data-testid="cas-bt-run"
            >
              {btBusy ? "Running…" : "Run backtest"}
            </Button>
          </div>

          {btResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat label="Trades" value={btResult.num_trades} />
                <Stat label="Win rate" value={`${fmt(btResult.win_rate_pct, 1)}%`} />
                <Stat
                  label="Total P&L"
                  value={`₹ ${fmt(btResult.total_pnl, 0)}`}
                  tone={btResult.total_pnl >= 0 ? "emerald" : "rose"}
                />
                <Stat label="Max DD" value={`${fmt(btResult.max_drawdown_pct, 2)}%`} />
              </div>
              <div className="overflow-auto max-h-80 border border-slate-100 rounded-sm">
                <table className="w-full text-[11px] font-mono-data">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Date</th>
                      <th className="text-left px-2 py-1">Index</th>
                      <th className="text-right px-2 py-1">Close</th>
                      <th className="text-left px-2 py-1">CAS detected</th>
                      <th className="text-right px-2 py-1">CE / PE</th>
                      <th className="text-right px-2 py-1">Entry prem</th>
                      <th className="text-right px-2 py-1">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(btResult.trades || []).map((t, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1">{t.entry_date}</td>
                        <td className="px-2 py-1">{t.index}</td>
                        <td className="px-2 py-1 text-right">{fmt(t.close_price, 2)}</td>
                        <td className="px-2 py-1">{fmtTime(t.cas_detected_at)}</td>
                        <td className="px-2 py-1 text-right">
                          {t.ce_strike}/{t.pe_strike}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmt(t.ce_premium, 1)}/{fmt(t.pe_premium, 1)}
                        </td>
                        <td
                          className={`px-2 py-1 text-right font-semibold ${
                            t.pnl >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {fmt(t.pnl, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(btResult.notes || []).slice(0, 4).map((n, i) => (
                <div key={i} className="text-[10px] text-slate-500">
                  {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function skipWhyLabel(why) {
  const map = {
    empty: "NSE JSON had no NIFTY print yet",
    same_as_freeze: "widget still showing live NIFTY (not the 15:20 print)",
    stamp_before_signal: "print clock is still before 15:20",
    before_cas_window: "before 15:20 IST — scrape can still be checked",
    stale_close: "overnight CLOSE leftover — ignored",
    closing_without_stamp: "closingValue has no clock (yesterday)",
    wrong_day: "print date is not today",
    out_of_range: "print looks like garbage",
    non_positive: "print is missing",
    wrong_index: "not NIFTY 50",
  };
  return map[why] || why;
}

function AutoTapeStrip({ auto, autoLots }) {
  const lat = auto.latency || {};
  const executed = auto.status === "EXECUTED" || auto.status === "NO_TRADE" || auto.status === "FAILED";
  const err = auto.nse_error || (auto.status === "FAILED" ? auto.reason : null);
  const liveNse = auto.nse_last_value != null ? fmt(auto.nse_last_value, 2) : "—";
  const firePrint = auto.indicative_nifty != null ? fmt(auto.indicative_nifty, 2) : "—";
  const clock = auto.clock_ist ? fmtTime(auto.clock_ist) : "—";
  const closed = auto.in_probe_window === false;
  return (
    <div className="space-y-2" data-testid="cas-auto-tape">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <MiniCard label="Auto lots" value={String(autoLots)} mono />
        <MiniCard label="Frozen NIFTY" value={fmt(auto.pre_signal_nifty, 2)} mono />
        <MiniCard label="Locked ATM" value={auto.locked_atm != null ? String(auto.locked_atm) : "—"} mono />
        <MiniCard
          label="NSE live"
          value={liveNse}
          mono
          highlight={auto.nse_first_at && !auto.indicative_nifty}
          testId="cas-auto-nse-live"
        />
        <MiniCard
          label="Fire print"
          value={firePrint}
          mono
          highlight={!!auto.indicative_nifty}
          testId="cas-auto-fire-print"
        />
        <MiniCard
          label="Delta"
          value={auto.cas_delta != null ? `${auto.cas_delta > 0 ? "+" : ""}${fmt(auto.cas_delta, 2)}` : "—"}
          mono
        />
        <MiniCard label="Signal" value={auto.signal || "—"} />
        <MiniCard
          label="Order"
          value={
            auto.tradingsymbol
              ? `${auto.opt_type || ""} ${auto.order_status || ""}`.trim()
              : auto.order_status || "—"
          }
        />
      </div>

      <div
        className={`rounded-sm border px-2.5 py-2 text-[11px] leading-relaxed space-y-1 ${
          err
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : executed
              ? "border-emerald-200 bg-emerald-50/80 text-slate-800"
              : "border-slate-200 bg-white text-slate-700"
        }`}
        data-testid="cas-auto-detail"
      >
        {err && (
          <p className="font-semibold break-all" data-testid="cas-auto-error">
            Error: {auto.nse_error ? `NSE ${auto.nse_error}` : auto.reason}
          </p>
        )}
        {!err && auto.nse_fetched_at && (
          <p data-testid="cas-auto-nse-line">
            NSE scrape ok · IST {clock}
            {auto.nse_first_at ? ` · first pull ${fmtTime(auto.nse_first_at)}` : ""}
            {auto.nse_changed_at ? ` · last change ${fmtTime(auto.nse_changed_at)}` : ""}
            {auto.nse_fetched_at ? ` · fetched ${fmtTime(auto.nse_fetched_at)}` : ""}
            {auto.nse_last_field ? ` · ${auto.nse_last_field}` : ""}
            {auto.nse_last_value != null ? ` ${fmt(auto.nse_last_value, 2)}` : ""}
            {auto.nse_last_stamp ? ` · widget ${auto.nse_last_stamp}` : ""}
            {auto.nse_last_status ? ` · ${auto.nse_last_status}` : ""}
          </p>
        )}
        {!err && auto.nse_skip_why && auto.nse_skip_why !== "ok" && (
          <p>Waiting: {skipWhyLabel(auto.nse_skip_why)}</p>
        )}
        {!auto.nse_fetched_at && !err && !executed && (
          <p className="text-slate-500">
            {closed
              ? `IST ${clock} — cash NSE scrape is quiet overnight (retries every 30s). Leave Paper on; the live print appears here from 09:15 IST. Inject still works if Kite is connected.`
              : "Waiting for the first NSE JSON pull. Leave Paper on. First indicative and later changes show in NSE live."}
          </p>
        )}
        {(auto.prepared_ce || auto.prepared_pe) && (
          <p className="font-mono-data break-all text-[10px] text-slate-600">
            {auto.prepared_ce ? `CE ${auto.prepared_ce}` : ""}
            {auto.prepared_pe ? ` · PE ${auto.prepared_pe}` : ""}
          </p>
        )}
        {auto.how && (
          <p className="font-semibold" data-testid="cas-auto-how">
            {auto.how}
          </p>
        )}
        {auto.order_id && (
          <p className="font-mono-data break-all">
            Order {auto.order_id}
            {auto.tradingsymbol ? ` · ${auto.tradingsymbol}` : ""}
            {auto.quantity != null ? ` ×${auto.quantity}` : ""}
          </p>
        )}
        {auto.fired_at && <p>When: {fmtTime(auto.fired_at)} IST</p>}
        {lat.total_signal_to_order_ms != null && (
          <p data-testid="cas-auto-latency">
            Latency: decide {fmtMs(lat.data_to_decision_ms)} ms · send {fmtMs(lat.decision_to_order_ms)}{" "}
            ms · total {fmtMs(lat.total_signal_to_order_ms)} ms
            {lat.received_at ? ` · print ${fmtTime(lat.received_at)}` : ""}
            {lat.order_ack_at ? ` · ack ${fmtTime(lat.order_ack_at)}` : ""}
          </p>
        )}
        {auto.reason && auto.status !== "FAILED" && !auto.how && (
          <p className="text-slate-600">{auto.reason}</p>
        )}
      </div>

      {auto.last_rehearsal?.status && (
        <p className="text-[11px] text-sky-800" data-testid="cas-auto-rehearsal">
          Last rehearsal (did not spend today&apos;s 15:20 fire): {auto.last_rehearsal.status}
          {auto.last_rehearsal.opt_type ? ` · ${auto.last_rehearsal.opt_type}` : ""}
          {auto.last_rehearsal.tradingsymbol ? ` · ${auto.last_rehearsal.tradingsymbol}` : ""}
          {auto.last_rehearsal.order_id ? ` · ${auto.last_rehearsal.order_id}` : ""}
          {auto.last_rehearsal.pre_signal_nifty != null
            ? ` · freeze ${fmt(auto.last_rehearsal.pre_signal_nifty, 2)}`
            : ""}
          {auto.last_rehearsal.locked_atm != null ? ` · ATM ${auto.last_rehearsal.locked_atm}` : ""}
          {auto.last_rehearsal.indicative_nifty != null
            ? ` · print ${fmt(auto.last_rehearsal.indicative_nifty, 2)}`
            : ""}
        </p>
      )}
    </div>
  );
}

function MiniCard({ label, value, mono, highlight, testId }) {
  return (
    <div
      className={`rounded-sm border px-2.5 py-2 ${
        highlight
          ? "border-emerald-200 bg-emerald-50/80"
          : "border-slate-200 bg-slate-50/60"
      }`}
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={`text-[12px] font-semibold text-slate-800 mt-0.5 truncate ${
          mono ? "font-mono-data" : ""
        }`}
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-sm font-semibold font-mono-data ${color}`}>{value}</div>
    </div>
  );
}
