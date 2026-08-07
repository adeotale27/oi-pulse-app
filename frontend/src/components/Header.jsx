import { useEffect, useState } from "react";
import BigClock from "@/components/BigClock";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { KeyRound, Bell, BellOff, Settings2, Download, Moon, Sun, PanelLeftClose, PanelLeftOpen, Volume2, Send, Database, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TickerStrip from "@/components/TickerStrip";
import AdminControls from "@/components/AdminControls";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api, fetchExtras, subscribeExtras, unsubscribeExtras, clearGuestAuth } from "@/lib/api";
import { toast } from "sonner";

import { WEEKEND_START_MINUTE, GIFT_SESSION_WINDOWS } from '@/lib/marketTimes';
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";

export default function Header({
  status,
  current,
  dataStatus,
  onOpenCreds,
  onOpenMorningRefresh: _onOpenMorningRefresh, // kept for API compat; token refresh via Kite API
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
  onFreshPullDone,
}) {
  const price = current?.price ?? 0;
  const atm = current?.atm ?? 0;
  const pcr = current?.pcr ?? 0;
  const vix = current?.vix ?? 0;
  const mode = status?.mode ?? "offline";

  // Auth state — used to hide sensitive buttons from guests.
  // Must keep refreshing after EOD (Tools / Public toggle still needed).
  const [authState, setAuthState] = useState({ is_admin: false });
  {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/auth/state");
        if (alive) {
          setAuthState(data);
        }
      } catch (err) { console.error('[Header] auth_state fetch failed', err); }
    };
    useQuiescentAwarePolling(load, 60_000, [], { immediate: true, allowDuringQuiescent: true, dedupeKey: "header-auth" });
    useEffect(() => () => { alive = false; }, []);
  }
  // Dev override: allow forcing admin UI without X-Admin-Token for local debugging.
  // Guard behind NODE_ENV !== 'production' so production builds are not affected.
  const devForce = (typeof window !== 'undefined') && (process.env.NODE_ENV !== 'production') && (
    localStorage.getItem('oi_dev_force_admin') === '1' || sessionStorage.getItem('oi_dev_force_admin') === '1'
  );
  const isAdmin = devForce || !!authState.is_admin;
  if (devForce) {
    try { console.warn('[Header] devForce admin UI enabled via oi_dev_force_admin'); } catch(_) {}
  }

  // Extras (VIX + GIFT NIFTY) — use the centralized extras poller/subscription
  // to avoid duplicate network requests across components.
  const [extras, setExtras] = useState({ vix: null, gift_nifty: null });
  useEffect(() => {
    let alive = true;
    const onExtras = (data, meta) => {
      if (!alive || !data) return;
      if (process.env.NODE_ENV !== 'production') {
        try { console.debug('[Header] subscribeExtras notified', { source: meta?.source, vix_ts: data?.vix?.ts || data?.vix?.last, gift_ts: data?.gift_nifty?.ts || data?.gift_nifty?.last, server_time_ist: data?.server_time_ist }); } catch (_) {}
      }
      setExtras((prev) => {
        const next = {
          vix: data.vix ?? prev.vix,
          gift_nifty: data.gift_nifty ?? prev.gift_nifty,
          windows: data.windows ?? prev.windows,
          server_time_ist: data.server_time_ist ?? prev.server_time_ist,
        };
        const sameVix = ((prev.vix?.ts || null) === (next.vix?.ts || null)) && ((prev.vix?.last || null) === (next.vix?.last || null));
        const sameGift = ((prev.gift_nifty?.ts || null) === (next.gift_nifty?.ts || null)) && ((prev.gift_nifty?.last || null) === (next.gift_nifty?.last || null));
        const sameServer = (prev.server_time_ist || null) === (next.server_time_ist || null);
        const sameOpen = (prev.windows?.gift?.open_now) === (next.windows?.gift?.open_now);
        if (sameVix && sameGift && sameServer && sameOpen) return prev;
        return next;
      });
    };
    const unsub = subscribeExtras(onExtras, { immediate: true, pollMs: 30_000 });
    return () => { alive = false; unsub(); };
  }, []);

  // Normalize GIFT sessions payload so UI always receives an array of sessions.
  // Fall back to the known static GIFT schedule if the server payload is missing.
  const giftSessions = (() => {
    try {
      const g = extras?.windows?.gift;
      if (!g) return GIFT_SESSION_WINDOWS;
      if (Array.isArray(g.sessions) && g.sessions.length) return g.sessions;
      if (g.sessions && typeof g.sessions === "object" && !Array.isArray(g.sessions) && g.sessions.start_ist && g.sessions.end_ist) {
        return [{ start_ist: g.sessions.start_ist, end_ist: g.sessions.end_ist }];
      }
      if (g.start_ist && g.end_ist) return [{ start_ist: g.start_ist, end_ist: g.end_ist }];
      if (g.start && g.end) return [{ start_ist: g.start, end_ist: g.end }];
      return GIFT_SESSION_WINDOWS;
    } catch {
      return GIFT_SESSION_WINDOWS;
    }
  })();

  // Refresh DB action (admin only)
  const [refreshing, setRefreshing] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const onRefreshDay = async () => {
    if (!isAdmin) return;
    if (!window.confirm(
      "Fresh Pull: clear ALL OI snapshots and pull a live tick for every ENABLED index in one click?\n\n" +
      "• Live (Kite): one parallel pull per enabled index — history before now cannot be recovered.\n" +
      "• Offline: wipe only (no synthetic/demo backfill).\n" +
      "Disabled indices in Settings are skipped."
    )) return;
    setRefreshing(true);
    try {
      const { data } = await api.post("/admin/refresh-day", {});
      const enabled = (data.enabled_indices || []).join(", ") || "none";
      const pulled = (data.live_indices_pulled || data.indices_backfilled || []).join(", ") || "none";
      toast.success(
        data.message ||
          `Fresh Pull · cleared ${data.deleted} · pulled ${pulled} · enabled ${enabled}`
      );
      onFreshPullDone?.(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Fresh Pull failed");
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

  const toolBtn =
    "rounded-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3";

  return (
    <header
      data-testid="dashboard-header"
      className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 relative"
    >
      <GiftSessionsModal open={giftModalOpen} onOpenChange={setGiftModalOpen} windows={giftSessions} serverIst={extras?.server_time_ist} />

      {/* Row 1: brand + status + essential actions */}
      <div className="px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <OiPulseLogo className="w-8 h-8 sm:w-9 sm:h-9 drop-shadow-sm" />
          <div className="text-sm font-semibold tracking-tight dark:text-slate-100 bg-gradient-to-r from-emerald-600 via-emerald-700 to-sky-600 bg-clip-text text-transparent">
            OI Pulse
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6 pl-3 border-l border-slate-200 dark:border-slate-700 shrink-0">
          <Metric label="ATM" value={atm.toLocaleString()} />
          <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} />
          <ExtraTickerCell
            label="GIFT NIFTY"
            data={extras.gift_nifty}
            windows={giftSessions}
            openNow={extras?.windows?.gift?.open_now}
            kiteSymbol={extras?.windows?.gift?.kite_symbol || "NSEIX:GIFT NIFTY"}
            serverIst={extras?.server_time_ist}
            onOpenSessions={() => setGiftModalOpen(true)}
          />
        </div>

        {/* Desktop tickers sit in the top row */}
        <div className="hidden md:flex items-stretch gap-2 flex-1 min-w-0 pl-3 border-l border-slate-200 dark:border-slate-700">
          <TickerStrip activeIndex={activeIndex} onSelectIndex={onSelectIndex} spotPrices={spotPrices} />
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
          <div className="md:hidden">
            <BigClock compact />
          </div>
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
          <div className="flex flex-col items-stretch gap-0.5 shrink-0" data-testid="kite-status-stack">
            <Badge
              data-testid="mode-badge"
              className={`rounded-sm ${mode === "kite" ? "bg-emerald-600 hover:bg-emerald-600" : "bg-red-600 hover:bg-red-600"}`}
              title={
                mode !== "kite"
                  ? "OFFLINE — no Kite credentials. Connect via Kite API to pull live OI."
                  : status?.market?.is_market_open
                    ? "KITE · OPEN — credentials connected and NSE cash/F&O session is open. OI polls while the market is open; the data-truth strip shows LIVE vs lag."
                    : "KITE · CLOSED — credentials are connected, but the NSE session is closed (post-close / weekend / holiday). Board shows the last session snapshot; OI polling is paused until next open. GIFT/VIX may still update."
              }
            >
              {mode === "kite" ? (status?.market?.is_market_open ? "KITE · OPEN" : "KITE · CLOSED") : "OFFLINE"}
            </Badge>
            {mode === "kite" && dataStatus?.data_date && status?.market && status.market.is_market_open === false && (
              <span
                data-testid="session-date-chip"
                className="text-[10px] font-mono-data text-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5"
                title={`Last session date on the board: ${dataStatus.data_date}. Not live ticks.`}
              >
                {dataStatus.data_date}
              </span>
            )}
            {mode !== "kite" && (
              <span
                data-testid="offline-hint-chip"
                className="hidden sm:inline-flex text-[10px] font-mono-data text-center text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5"
                title="Kite API key required for live updates. Connect via Kite API."
              >
                Needs API key
              </span>
            )}
          </div>

          {authState?.is_guest && !isAdmin && (
            (() => {
              const guestName = authState.guest_name || (typeof window !== 'undefined' ? sessionStorage.getItem('oi_guest_name') : null) || 'Guest';
              const expiresAt = typeof window !== 'undefined' ? Number(sessionStorage.getItem('oi_guest_expires_at') || 0) : 0;
              const remainingMs = expiresAt ? Math.max(0, expiresAt - Date.now()) : null;
              function fmt(ms) {
                if (!ms && ms !== 0) return '';
                const s = Math.floor(ms / 1000);
                if (s >= 3600) {
                  const h = Math.floor(s / 3600);
                  const m = Math.floor((s % 3600) / 60);
                  return `${h}h ${m}m`;
                }
                if (s >= 60) return `${Math.floor(s/60)}m ${s%60}s`;
                return `${s}s`;
              }
              const remainingLabel = remainingMs != null ? fmt(remainingMs) : '';
              const exitGuest = () => {
                clearGuestAuth();
                window.location.reload();
              };
              return (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-sm text-slate-800 dark:text-slate-100">
                  <div className="font-medium">{guestName}</div>
                  {remainingLabel && <div className="text-xs text-slate-500">· expires in {remainingLabel}</div>}
                  <button onClick={exitGuest} className="text-xs text-rose-600 hover:underline ml-2">Exit</button>
                </div>
              );
            })()
          )}

          <div className="hidden sm:block">
            <AdminControls
              assumedAdmin={isAdmin}
              publicAccessOpen={!!authState.public_access_open}
            />
          </div>

          {/* Always-visible quick tools */}
          <Button
            data-testid="btn-toggle-compact"
            variant="outline" size="sm" className={toolBtn}
            onClick={onToggleCompact}
            title={compact ? "Show sidebar (Ctrl+B)" : "Hide sidebar (Ctrl+B)"}
          >
            {compact ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-toggle-dark"
            variant="outline" size="sm" className={toolBtn}
            onClick={onToggleDark}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-toggle-notifications"
            variant="outline" size="sm" className={`hidden sm:inline-flex ${toolBtn}`}
            onClick={onToggleNotif}
            title={notifEnabled ? "Notifications on" : "Enable notifications"}
          >
            {notifEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </Button>
          <Button
            data-testid="btn-open-sounds"
            variant="outline" size="sm" className={`hidden md:inline-flex ${toolBtn}`}
            onClick={onOpenSounds}
            title="Alert sound preferences"
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <Button
            data-testid="btn-download-csv"
            variant="outline" size="sm" className={`hidden md:inline-flex ${toolBtn}`}
            onClick={onDownloadCsv}
            title="Download current OI as CSV"
          >
            <Download className="w-4 h-4" />
          </Button>
          {isAdmin && (
            <Button
              data-testid="btn-open-settings"
              variant="outline" size="sm" className={`hidden md:inline-flex ${toolBtn}`}
              onClick={onOpenSettings}
              title="Alert settings"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          )}

          {/* Desktop admin action cluster */}
          <div className="hidden lg:flex items-center gap-2">
            <Button
              data-testid="btn-refresh-day"
              size="sm"
              onClick={onRefreshDay}
              disabled={refreshing}
              className={`rounded-sm bg-rose-600 hover:bg-rose-700 text-white shadow-sm ${isAdmin ? "" : "hidden"}`}
              title="Wipe snapshots and live-pull every enabled index in one click"
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

          {/* Mobile / tablet: collapse admin tools */}
          {isAdmin && (
            <Button
              data-testid="btn-mobile-tools"
              variant="outline"
              size="sm"
              className="lg:hidden rounded-sm h-8 px-2 text-xs"
              onClick={() => setMobileToolsOpen((v) => !v)}
              title="Admin tools"
            >
              Tools
            </Button>
          )}
        </div>
      </div>

      {/* Mobile: VIX / GIFT + index tickers on their own rows */}
      <div className="md:hidden px-3 pb-2 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} />
          <ExtraTickerCell
            label="GIFT NIFTY"
            data={extras.gift_nifty}
            windows={giftSessions}
            openNow={extras?.windows?.gift?.open_now}
            kiteSymbol={extras?.windows?.gift?.kite_symbol || "NSEIX:GIFT NIFTY"}
            serverIst={extras?.server_time_ist}
            onOpenSessions={() => setGiftModalOpen(true)}
          />
        </div>
        <TickerStrip activeIndex={activeIndex} onSelectIndex={onSelectIndex} spotPrices={spotPrices} />
      </div>

      {isAdmin && mobileToolsOpen && (
        <div
          data-testid="mobile-admin-tools"
          className="lg:hidden px-3 pb-3 flex flex-wrap gap-2 border-t border-slate-100 dark:border-slate-800 pt-2"
        >
          <div className="w-full basis-full">
            <AdminControls
              variant="panel"
              assumedAdmin={isAdmin}
              publicAccessOpen={!!authState.public_access_open}
            />
          </div>
          <Button
            size="sm"
            onClick={onRefreshDay}
            disabled={refreshing}
            className="rounded-sm bg-rose-600 hover:bg-rose-700 text-white"
          >
            <Database className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-pulse" : ""}`} />
            {refreshing ? "Refreshing…" : "Fresh Pull"}
          </Button>
          <Button size="sm" onClick={onOpenUpload} className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white">
            <UploadCloud className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onOpenTelegramPrefs}>
            <Send className="w-4 h-4 mr-1.5" />
            Telegram
          </Button>
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onOpenCreds}>
            <KeyRound className="w-4 h-4 mr-1.5" />
            Kite API
          </Button>
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onOpenSettings}>
            <Settings2 className="w-4 h-4 mr-1.5" />
            Settings
          </Button>
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onOpenSounds}>
            <Volume2 className="w-4 h-4 mr-1.5" />
            Sounds
          </Button>
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onDownloadCsv}>
            <Download className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
        </div>
      )}
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

function ExtraTickerCell({ label, data, windows, serverIst, onOpenSessions, openNow, kiteSymbol }) {
  const [hover, setHover] = useState(false);
  const hasData = data && data.last != null && data.last > 0;
  const chgPct = hasData ? Number(data.change_pct || 0) : 0;
  const chg = hasData ? Number(data.change || 0) : 0;
  const tone = chgPct > 0.05 ? "emerald" : chgPct < -0.05 ? "rose" : "slate";
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400";
  const arrow = chgPct > 0.05 ? "▲" : chgPct < -0.05 ? "▼" : "▬";
  const isProxy = Boolean(data?.is_proxy);
  const source = data?.source || null;

  // determine GIFT session status using server-provided IST timestamp when available,
  // otherwise fallback to client-side conversion to Asia/Kolkata
  function parseHM(hm) {
    const [hh, mm] = String(hm).split(":").map(Number);
    return (hh || 0) * 60 + (mm || 0);
  }

  function getIstDate(input = new Date()) {
    const dt = input instanceof Date ? input : new Date(input);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(dt);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
  }

  function getIstNow() {
    if (serverIst) {
      const d = new Date(serverIst);
      if (!Number.isNaN(d.getTime())) return getIstDate(d);
    }
    return getIstDate(new Date());
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
    if (!windows || !Array.isArray(windows) || windows.length === 0) {
      return { activeIndex: -1, nextIndex: null, minsUntilNext: null, openNow: false };
    }
    // Prefer server flag when present (handles Fri evening → Sat 02:45 correctly).
    if (openNow === true) {
      const now = getIstNow();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      let activeIndex = -1;
      for (let i = 0; i < windows.length; i++) {
        const s = windows[i];
        const startM = parseHM(s.start_ist || s.start || "00:00");
        const endM = parseHM(s.end_ist || s.end || "00:00");
        if (startM <= endM) {
          if (nowMinutes >= startM && nowMinutes <= endM) { activeIndex = i; break; }
        } else if (nowMinutes >= startM || nowMinutes <= endM) {
          activeIndex = i;
          break;
        }
      }
      return { activeIndex: activeIndex >= 0 ? activeIndex : 0, nextIndex: null, minsUntilNext: null, openNow: true };
    }

    const now = getIstNow();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const nowDay = now.getUTCDay();
    // GIFT evening continues Fri→Sat 02:45 — do NOT treat Fri after 15:31 as closed for GIFT.
    const isSatAfterGift = nowDay === 6 && nowMinutes > parseHM("02:45");
    const isSun = nowDay === 0;
    const isWeekend = isSun || isSatAfterGift;

    let activeIndex = -1;
    if (!isWeekend) {
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
    }

    let nextIndex = null;
    let minsUntilNext = null;
    if (activeIndex === -1) {
      if (isWeekend) {
        nextIndex = 0;
        let daysUntilMonday;
        if (nowDay === 5) daysUntilMonday = 3;
        else if (nowDay === 6) daysUntilMonday = 2;
        else daysUntilMonday = 1;
        const nextMondayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 30));
        const nextMonday = new Date(nextMondayStart.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
        minsUntilNext = Math.max(0, Math.round((nextMonday.getTime() - now.getTime()) / 60000));
      } else {
        let minDelta = 24 * 60 + 1;
        for (let i = 0; i < windows.length; i++) {
          const s = windows[i];
          const startM = parseHM(s.start_ist || s.start || '00:00');
          let delta = startM - nowMinutes;
          if (delta <= 0) delta += 24 * 60;
          if (delta < minDelta) { minDelta = delta; nextIndex = i; }
        }
        minsUntilNext = minDelta;
      }
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
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className={`text-sm font-mono-data font-semibold text-slate-900 tabular-nums leading-none`}>{hasData ? Number(data.last).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</div>
        <div className={`flex items-center gap-1 text-[11px] font-mono-data tabular-nums leading-none shrink-0 ${toneCls}`}>
          <span aria-hidden>{arrow}</span>
          <span>{chg > 0 ? "+" : ""}{chg.toFixed(2)}</span>
        </div>
      </div>

      {/* Hover tooltip showing GIFT session status */}
      {isGift && hover && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded shadow-lg p-2 text-xs z-50">
          <div className="font-semibold mb-1">GIFT NIFTY Sessions</div>
          <div className="mb-1">{giftTooltip}</div>
          <div className="text-[11px] text-slate-500 mb-1">
            Kite symbol: <span className="font-mono">{kiteSymbol || "NSEIX:GIFT NIFTY"}</span>
            {source ? ` · via ${source}` : ""}
            {isProxy ? " · proxy (not live GIFT)" : ""}
          </div>
          {data?.note && <div className="text-[10px] text-amber-700 mb-1">{data.note}</div>}
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