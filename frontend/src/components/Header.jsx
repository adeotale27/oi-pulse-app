import { useEffect, useState } from "react";
import { KeyRound, Bell, BellOff, Settings2, Download, Moon, Sun, PanelLeftClose, PanelLeftOpen, Volume2, RefreshCw, Send, Database } from "lucide-react";
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
  notifEnabled,
  onToggleNotif,
  onOpenHolidays,
  onOpenEvents,
  vixSessionOpen,
  activeIndex,
  onSelectIndex,
  tickerData,
  lastPulledAt,
  darkMode,
  onToggleDark,
  compact,
  onToggleCompact,
  pollMs,
  onChangePollMs,
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
        if (alive) setExtras({ vix: data?.vix || null, gift_nifty: data?.gift_nifty || null });
      } catch (_) { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

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

  // Pull today's change for the active index from the ticker payload — this is
  // "yesterday-close vs live LTP", i.e. today's real % change.
  const myTicker = (tickerData || []).find((t) => t.index === current?.index);

  return (
    <header
      data-testid="dashboard-header"
      className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 relative"
    >
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

        <div className="hidden md:flex items-center gap-4 pl-3 border-l border-slate-200 dark:border-slate-700 shrink-0">
          <Metric label="ATM" value={atm.toLocaleString()} />
          <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} />
          <ExtraTickerCell label="GIFT NIFTY" data={extras.gift_nifty} />
        </div>

        {/* Ticker cards inline beside VIX */}
        <div className="flex items-stretch gap-1.5 flex-1 min-w-0 pl-3 border-l border-slate-200 dark:border-slate-700 flex-wrap">
          <TickerStrip activeIndex={activeIndex} onSelectIndex={onSelectIndex} />
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {lastPulledAt && (
            <div className="hidden lg:flex items-center gap-1 text-[10px] font-mono-data text-slate-500 dark:text-slate-400 leading-tight" data-testid="oi-last-pulled-top">
              <span className="uppercase tracking-widest text-slate-400 dark:text-slate-500">OI pulled</span>
              <span className="text-slate-700 dark:text-slate-200">{new Date(lastPulledAt).toLocaleTimeString()}</span>
            </div>
          )}
          {onChangePollMs && (
            <div className="hidden lg:flex items-center gap-1 text-[10px]" title="How often OI data is refreshed">
              <span className="uppercase tracking-widest text-slate-400 dark:text-slate-500">Every</span>
              <select
                data-testid="poll-interval-select"
                value={pollMs || 30000}
                onChange={(e) => onChangePollMs(parseInt(e.target.value, 10))}
                className="text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-1.5 py-0.5"
              >
                <option value={15000}>15s</option>
                <option value={30000}>30s</option>
                <option value={60000}>60s</option>
              </select>
            </div>
          )}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-data" data-testid="last-updated">
            <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 live-dot" : "bg-slate-300"}`} />
            <span data-testid="live-clock">{nowLabel}</span>
          </div>
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
          <Button
            data-testid="btn-open-settings"
            variant="outline" size="sm" className="rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
            onClick={onOpenSettings}
            title="Alert settings"
          >
            <Settings2 className="w-4 h-4" />
          </Button>
          <Button
            data-testid="btn-morning-refresh"
            size="sm"
            onClick={onOpenMorningRefresh}
            className={`rounded-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm ${isAdmin ? "" : "hidden"}`}
            title="Morning Kite token refresh (one-tap)"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh Kite
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
  // VIX is a market-wide (single) index — always prefer the yfinance-fed
  // ExtraTickers value so it stays consistent across NIFTY / SENSEX / BANKNIFTY
  // and remains visible outside the polling window (persisted last-known value
  // is served by the backend on restart).
  const v = liveVix?.last != null && liveVix.last > 0 ? liveVix.last : (value ?? 0);
  let arrow = null, tone = "amber", chgLabel = "";
  if (liveVix && liveVix.change != null && liveVix.prev_close) {
    const chg = Number(liveVix.change);
    const pct = Number(liveVix.change_pct || 0);
    if (pct > 0.05) { arrow = "▲"; tone = "rose"; }
    else if (pct < -0.05) { arrow = "▼"; tone = "emerald"; }
    else { arrow = "▬"; tone = "slate"; }
    chgLabel = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  } else if (sessionOpen && sessionOpen > 0 && v > 0) {
    const chg = v - sessionOpen;
    const pct = (chg / sessionOpen) * 100;
    if (pct > 0.05) { arrow = "▲"; tone = "rose"; }
    else if (pct < -0.05) { arrow = "▼"; tone = "emerald"; }
    else { arrow = "▬"; tone = "slate"; }
    chgLabel = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  }
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : tone === "slate" ? "text-slate-500 dark:text-slate-400" : "text-amber-600";
  return (
    <div className="flex flex-col" data-testid="vix-metric">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">INDIA VIX</div>
      <div className="flex items-baseline gap-1.5">
        <div className={`text-sm font-semibold font-mono-data ${toneCls}`} data-testid="vix-value">{Number(v).toFixed(2)}</div>
        {arrow && (
          <div className={`text-[10px] font-mono-data ${toneCls}`} data-testid="vix-change">
            <span className="mr-0.5">{arrow}</span>{chgLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function ExtraTickerCell({ label, data }) {
  const hasData = data && data.last != null && data.last > 0;
  const chgPct = hasData ? Number(data.change_pct || 0) : 0;
  const chg = hasData ? Number(data.change || 0) : 0;
  const tone = chgPct > 0.05 ? "emerald" : chgPct < -0.05 ? "rose" : "slate";
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400";
  const arrow = chgPct > 0.05 ? "▲" : chgPct < -0.05 ? "▼" : "▬";
  return (
    <div className="flex flex-col" data-testid={`ticker-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <div className={`text-sm font-semibold font-mono-data ${hasData ? toneCls : "text-slate-400"}`} data-testid={`ticker-${label.toLowerCase().replace(/\s+/g, "-")}-value`}>
          {hasData ? Number(data.last).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
        </div>
        {hasData && (
          <div className={`text-[10px] font-mono-data ${toneCls}`}>
            <span className="mr-0.5">{arrow}</span>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%)
          </div>
        )}
      </div>
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
