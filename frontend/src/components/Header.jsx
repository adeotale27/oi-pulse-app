import { useEffect, useState } from "react";
import BigClock from "@/components/BigClock";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { KeyRound, Bell, BellOff, Settings2, Download, Moon, Sun, PanelLeftClose, PanelLeftOpen, Volume2, RefreshCw, Send, Database, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TickerStrip from "@/components/TickerStrip";
import AdminControls from "@/components/AdminControls";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function Header({
  status,
  current,
  onOpenCreds,
  onOpenMorningRefresh,
  onOpenTelegramPrefs,
  onOpenSettings,
  onDownloadCsv,
  onOpenSounds,
  onOpenUpload,
  notifEnabled,
  onToggleNotif,
  onOpenHolidays,
  onOpenEvents,
  vixSessionOpen,
  activeIndex,
  onSelectIndex,
  spotPrices,
  tickerData,
  lastPulledAt,
  darkMode,
  onToggleDark,
  compact,
  onToggleCompact,
}) {
  const price = current?.price ?? 0;
  const atm = current?.atm ?? 0;
  const pcr = current?.pcr ?? 0;
  const vix = current?.vix ?? 0;
  const mode = status?.mode ?? "mock";

  // Auth state — used to hide sensitive buttons from guests.
  const [authState, setAuthState] = useState({ is_admin: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/auth/state");
        if (alive) setAuthState(data);
      } catch (_) { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const isAdmin = !!authState.is_admin;

  // Extras (VIX + GIFT NIFTY) — independent poll cycle every 30s so they keep
  // updating on their own schedules (VIX 09:15–15:30, GIFT 06:30–23:30 IST).
  // These do NOT display an "OI pulled" timestamp; users are expected to know
  // they update automatically per their own windows.
  const [extras, setExtras] = useState({ vix: null, gift_nifty: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/tickers/extras");
        // store full payload so UI can access windows + server_time_ist for GIFT session info
        if (alive) setExtras(data || { vix: null, gift_nifty: null, windows: null, server_time_ist: null });
      } catch (_) { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Normalize GIFT sessions payload so UI always receives an array of sessions
  const giftSessions = (() => {
    try {
      const g = extras?.windows?.gift;
      if (!g) return null;
      // If backend provides sessions array, use it
      if (Array.isArray(g.sessions) && g.sessions.length) return g.sessions;
      // If backend provides a single window (start_ist/end_ist), wrap it
      if (g.start_ist && g.end_ist) return [{ start_ist: g.start_ist, end_ist: g.end_ist }];
      if (g.start && g.end) return [{ start_ist: g.start, end_ist: g.end }];
      return null;
    } catch {
      return null;
    }
  })();

  // Refresh DB action (admin only)
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshDay = async () => {
    if (!isAdmin) return;
    if (!window.confirm(
      "Fresh Pull: clear today's OI snapshots and re-populate from 9:15 AM to now (or 3:30 PM if the market has closed)?\n\n" +
      "In DEMO/mock mode: synthetic data will be back-filled at 1-minute cadence for NIFTY, SENSEX and BANKNIFTY.\n" +
      "In LIVE (Kite) mode: history before 'now' cannot be recovered — live polling will simply restart from now."
    )) return;
    setRefreshing(true);
    try {
      const { data } = await api.post("/admin/refresh-day", {});
      toast.success(
        `Refreshed · deleted ${data.deleted} · back-filled ${data.backfilled_snapshots} snapshots`
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Continuous 1-second clock (independent of the 30s poll).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowLabel = now.toLocaleTimeString();

  // Gift sessions modal control
  const [giftModalOpen, setGiftModalOpen] = useState(false);

  // Pull today's change for the active index from the ticker payload — this is
  // "yesterday-close vs live LTP", i.e. today's real % change.
  const myTicker = (tickerData || []).find((t) => t.index === current?.index);

  return (
    <header
      data-testid="dashboard-header"
      className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 relative"
    >
      <GiftSessionsModal open={giftModalOpen} onOpenChange={setGiftModalOpen} windows={giftSessions} serverIst={extras?.server_time_ist} />
      {/* --- Single row: brand, secondary metrics, tickers, clock, actions --- */}
      <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <OiPulseLogo className="w-9 h-9 drop-shadow-sm" />
          <div>
            <div className="text-sm font-semibold tracking-tight dark:text-slate-100 bg-gradient-to-r from-emerald-600 via-emerald-700 to-sky-600 bg-clip-text text-transparent">
              OI Pulse
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6 pl-3 border-l border-slate-200 dark:border-slate-700 shrink-0">
          <Metric label="ATM" value={atm.toLocaleString()} />
          <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} />
          <ExtraTickerCell label="GIFT NIFTY" data={extras.gift_nifty} windows={giftSessions} serverIst={extras?.server_time_ist} onOpenSessions={() => setGiftModalOpen(true)} />
        </div>

        <div className="w-full md:hidden border-t border-slate-200 dark:border-slate-700 mt-2 pt-2">
          <div className="grid grid-cols-2 gap-2 px-3">
            <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} />
          <ExtraTickerCell label="GIFT NIFTY" data={extras.gift_nifty} windows={giftSessions} serverIst={extras?.server_time_ist} onOpenSessions={() => setGiftModalOpen(true)} />
          </div>
        </div>

        {/* Ticker cards inline beside VIX */}
        <div className="flex items-stretch gap-2 flex-1 min-w-0 pl-3 border-l border-slate-200 dark:border-slate-700 flex-wrap">
          <TickerStrip activeIndex={activeIndex} onSelectIndex={onSelectIndex} spotPrices={spotPrices} />
        </div>

        {/* Compact clock for mobile (visible when header has limited space or sidebar hidden) */}
        <div className="lg:hidden ml-2">
          <BigClock compact />
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {(lastPulledAt || nowLabel) && (
            <div className="hidden lg:flex flex-col items-start gap-0 bg-transparent text-slate-700 px-3 py-1 rounded-sm leading-tight min-w-[120px]" data-testid="oi-and-time">
              {lastPulledAt && <div className="text-[10px] font-mono-data uppercase tracking-widest text-slate-500 dark:text-slate-400">OI pulled</div>}
              {lastPulledAt && <div className="text-sm font-semibold font-mono-data text-slate-900 dark:text-slate-100">{new Date(lastPulledAt).toLocaleTimeString()}</div>}
              <div className="text-[10px] font-mono-data text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${status?.market && status.market.is_market_open ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className={`font-semibold ${status?.market && status.market.is_market_open ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>{nowLabel}</span>
              </div>
            </div>
          )}
          <Badge
            data-testid="mode-badge"
            className={`rounded-sm ${mode === "kite" ? "bg-emerald-600 hover:bg-emerald-600" : "bg-amber-500 hover:bg-amber-500"}`}
          >
            {mode === "kite" ? "LIVE" : "DEMO"}
          </Badge>
          <AdminControls />
          <Button
            data-testid="btn-toggle-compact"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onToggleCompact}
            title={compact ? "Show sidebar (Ctrl+B)" : "Hide sidebar (Ctrl+B)"}
          >
            {compact ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-toggle-dark"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onToggleDark}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-toggle-notifications"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onToggleNotif}
            title={notifEnabled ? "Notifications on" : "Enable notifications"}
          >
            {notifEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-open-sounds"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onOpenSounds}
            title="Alert sound preferences"
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <Button
            data-testid="btn-download-csv"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onDownloadCsv}
            title="Download current OI as CSV"
          >
            <Download className="w-4 h-4" />
          </Button>
          {isAdmin && (
            <Button
              data-testid="btn-open-settings"
              variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
              onClick={onOpenSettings}
              title="Alert settings"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            data-testid="btn-straddle-chart"
            size="sm"
            onClick={onOpenMorningRefresh}
            className={`rounded-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm ${isAdmin ? "" : "hidden"}`}
            title="Morning token refresh (one-tap)"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <Button
            data-testid="btn-refresh-day"
            size="sm"
            onClick={onRefreshDay}
            disabled={refreshing}
            className={`rounded-sm bg-rose-600 hover:bg-rose-700 text-white shadow-sm ${isAdmin ? "" : "hidden"}`}
            title="Wipe today's OI data and repopulate NIFTY / SENSEX / BANKNIFTY from 9:15 AM to now (or 3:30 PM if market closed)"
          >
            <Database className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-pulse" : ""}`} />
            {refreshing ? "Refreshing…" : "Fresh Pull"}
          </Button>
          <Button
            data-testid="btn-open-upload"
            size="sm"
            onClick={onOpenUpload}
            className={`rounded-sm bg-sky-600 hover:bg-sky-700 text-white shadow-sm ${isAdmin ? "" : "hidden"}`}
            title="Upload Nifty50 / Bank Nifty / Sensex constituents or NSE event calendar"
          >
            <UploadCloud className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <Button
            data-testid="btn-open-telegram-prefs"
            variant="outline" size="sm"
            className={`rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 ${isAdmin ? "" : "hidden"}`}
            onClick={onOpenTelegramPrefs}
            title="Telegram alert preferences"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Telegram
          </Button>
          <Button
            data-testid="btn-open-credentials"
            variant="outline" size="sm"
            className={`rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 ${isAdmin ? "" : "hidden"}`}
            onClick={onOpenCreds}
          >
            <KeyRound className="w-4 h-4 mr-1.5" />
            Kite API
          </Button>
        </div>
      </div>
    </header>
  );
}

function VixMetric({ value, sessionOpen, liveVix }) {
  // Compact tile: top-right % change, big price below — like the ticker tiles.
  const v = liveVix?.last != null && liveVix.last > 0 ? liveVix.last : (value ?? 0);
  const pct = liveVix && liveVix.change_pct != null ? Number(liveVix.change_pct) : (sessionOpen && v ? ((v - sessionOpen) / sessionOpen) * 100 : 0);
  const tone = pct > 0.05 ? "rose" : pct < -0.05 ? "emerald" : "slate";
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400";
  const hasData = v != null && v > 0;
  return (
    <div className="flex flex-col" data-testid="vix-metric">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-slate-600 font-semibold">
        <div className="flex items-center gap-1.5">INDIA VIX</div>
        <div className={`text-[10px] font-mono-data ${toneCls}`}>{hasData ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}</div>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <div className={`text-sm font-semibold font-mono-data ${hasData ? "text-slate-900 dark:text-slate-100" : "text-slate-400"}`} data-testid="vix-value">{hasData ? Number(v).toFixed(2) : "—"}</div>
        {/* show absolute change next to price if available */}
        {liveVix && (liveVix.change != null) && (
          <div className={`text-[11px] font-mono-data ${toneCls}`}>{liveVix.change >= 0 ? "+" : ""}{Number(liveVix.change).toFixed(2)}</div>
        )}
      </div>
    </div>
  );
}

function ExtraTickerCell({ label, data, windows, serverIst, onOpenSessions }) {
  const [hover, setHover] = useState(false);
  const hasData = data && data.last != null && data.last > 0;
  const chgPct = hasData ? Number(data.change_pct || 0) : 0;
  const chg = hasData ? Number(data.change || 0) : 0;
  const tone = chgPct > 0.05 ? "emerald" : chgPct < -0.05 ? "rose" : "slate";
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400";
  const arrow = chgPct > 0.05 ? "▲" : chgPct < -0.05 ? "▼" : "▬";

  // determine GIFT session status using server-provided IST timestamp when available,
  // otherwise fallback to client-side conversion to Asia/Kolkata
  function parseHM(hm) {
    const [hh, mm] = String(hm).split(":").map(Number);
    return (hh || 0) * 60 + (mm || 0);
  }
  function getIstNow() {
    if (serverIst) {
      // serverIst is expected to be an ISO timestamp in IST with offset (e.g. 2026-07-29T00:16:...+05:30)
      const d = new Date(serverIst);
      if (!Number.isNaN(d.getTime())) return d;
    }
    // fallback: construct a Date representing current time in Asia/Kolkata
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  }

  function minutesToHuman(mins) {
    if (mins == null) return "";
    mins = Math.max(0, Math.floor(mins));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function getSessionInfo() {
    if (!windows || !Array.isArray(windows) || windows.length === 0) return { activeIndex: -1, nextIndex: null, minsUntilNext: null };
    const now = getIstNow();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    let activeIndex = -1;
    for (let i = 0; i < windows.length; i++) {
      const s = windows[i];
      const startM = parseHM(s.start_ist || s.start || '00:00');
      const endM = parseHM(s.end_ist || s.end || '00:00');
      if (startM <= endM) {
        if (nowMinutes >= startM && nowMinutes <= endM) { activeIndex = i; break; }
      } else {
        // wrap-around (overnight)
        if (nowMinutes >= startM || nowMinutes <= endM) { activeIndex = i; break; }
      }
    }

    let nextIndex = null;
    let minsUntilNext = null;
    if (activeIndex === -1) {
      let minDelta = 24 * 60 + 1;
      for (let i = 0; i < windows.length; i++) {
        const s = windows[i];
        const startM = parseHM(s.start_ist || s.start || '00:00');
        let delta = startM - nowMinutes;
        if (delta <= 0) delta += 24 * 60;
        if (delta < minDelta) { minDelta = delta; nextIndex = i; }
      }
      minsUntilNext = minDelta;
    } else {
      const s = windows[activeIndex];
      const endM = parseHM(s.end_ist || s.end || '00:00');
      let remaining = 0;
      const nowM = nowMinutes;
      const startM = parseHM(s.start_ist || s.start || '00:00');
      if (startM <= endM) {
        remaining = endM - nowM;
      } else {
        // wrap-around
        if (nowM >= startM) remaining = (24 * 60 - nowM) + endM;
        else remaining = endM - nowM;
      }
      minsUntilNext = remaining;
    }

    return { activeIndex, nextIndex, minsUntilNext };
  }

  const sess = getSessionInfo();
  const isGift = String(label || '').toLowerCase().includes('gift');

  // Tooltip content for GIFT NIFTY
  const giftTooltip = (() => {
    if (!isGift) return null;
    if (!windows || !windows.length) return 'GIFT sessions unknown';
    if (!sess) return 'GIFT sessions unknown';
    if (sess.activeIndex >= 0) {
      const s = windows[sess.activeIndex];
      return `Open · ${s.start_ist || s.start} – ${s.end_ist || s.end} IST · ${minutesToHuman(sess.minsUntilNext)} left`;
    }
    if (sess.nextIndex != null) {
      const s = windows[sess.nextIndex];
      return `Closed · Next: ${s.start_ist || s.start} IST · in ${minutesToHuman(sess.minsUntilNext)}`;
    }
    return 'Closed';
  })();

  const isActive = sess && sess.activeIndex >= 0;

  return (
    <div className="flex flex-col relative" data-testid={`ticker-${label.toLowerCase().replace(/\s+/g, "-")}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-slate-600 font-semibold">
        <div className="flex items-center gap-1.5">
          {/* persistent status dot */}
          {isGift && <span title={giftTooltip} onClick={() => onOpenSessions && onOpenSessions()} role="button" tabIndex={0} className={`inline-block w-2 h-2 rounded-full cursor-pointer ${isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'} mr-1.5`} />}
          {label}
        </div>
        <div className={`text-[10px] font-mono-data ${toneCls}`}>{hasData ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "—"}</div>
      </div>
      <div className="flex items-center justify-between mt-0.5">
        <div className={`text-sm font-mono-data font-semibold text-slate-900`}>{hasData ? Number(data.last).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</div>
        <div className={`text-[11px] font-mono-data ${toneCls}`}>
          {arrow}{chg > 0 ? "+" : ""}{chg.toFixed(2)}
        </div>
      </div>

      {/* Hover tooltip showing GIFT session status */}
      {isGift && hover && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded shadow-lg p-2 text-xs z-50">
          <div className="font-semibold mb-1">GIFT NIFTY Sessions</div>
          <div className="mb-1">{giftTooltip}</div>
          <div className="text-[11px] text-slate-500">
            { (windows || []).map((s, i) => (
              <div key={i}>{i === 0 ? 'Morning' : i === 1 ? 'Evening' : `Session ${i+1}`}:{' '}{s.start_ist || s.start} – {s.end_ist || s.end} IST { (sess && sess.activeIndex === i) ? '· active' : '' }</div>
            )) }
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone, accent }) {
  const toneCls = {
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
  }[tone] || (accent ? "text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-200");
  return (
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold font-mono-data ${toneCls}`}>{value}</div>
    </div>
  );
}