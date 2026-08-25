import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BigClock from "@/components/BigClock";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { KeyRound, Bell, BellOff, Settings2, Download, Moon, Sun, PanelLeftClose, PanelLeftOpen, Volume2, Send, Database, UploadCloud, SlidersHorizontal, Shield, UserCheck, LogOut, X, BookOpen, Sparkles, Layers, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DeskAiConfigMenu from "@/components/DeskAiConfigMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import TickerStrip from "@/components/TickerStrip";
import AdminControls from "@/components/AdminControls";
import BrandMark from "@/components/BrandMark";
import BrandLiveClock from "@/components/BrandLiveClock";
import { api, fetchExtras, subscribeExtras, unsubscribeExtras, logoutGuest, clearAdminAuth } from "@/lib/api";
import { toast } from "sonner";

import { WEEKEND_START_MINUTE, GIFT_SESSION_WINDOWS } from '@/lib/marketTimes';
import { isTradingDayIST, todayIST } from "@/lib/holidays";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { kiteModeBadge, kiteModeBadgeClass } from "@/lib/kiteModeLabel";
import { readTodayPnlCache, TODAY_PNL_EVENT } from "@/lib/todayPnl";
import {
  startPositionsBookPolling,
  stopPositionsBookPolling,
  subscribePositionsBook,
  openLiveCount,
} from "@/lib/positionsBook";

const PRIVACY_LS_KEY = "oi_positions_privacy";
const PRIVACY_EVENT = "oi-positions-privacy";
const PRIVACY_MASK = "••••";

/** Admin/guest Today P&L chip for the header (beside the clock). */
function HeaderTodayPnl({ enabled, status: _status, pollMs: _pollMs = 30_000, className, compact = false }) {
  const cached = readTodayPnlCache();
  const [pnl, setPnl] = useState(() => cached?.total ?? null);
  const [openCount, setOpenCount] = useState(() => cached?.open ?? 0);
  const [privacy, setPrivacy] = useState(() => {
    try { return localStorage.getItem(PRIVACY_LS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    const syncPrivacy = () => {
      try { setPrivacy(localStorage.getItem(PRIVACY_LS_KEY) === "1"); } catch { /* noop */ }
    };
    // Same-tab toggle fires a custom event; other tabs use `storage`.
    window.addEventListener(PRIVACY_EVENT, syncPrivacy);
    window.addEventListener("storage", syncPrivacy);
    const id = setInterval(syncPrivacy, 5000);
    return () => {
      clearInterval(id);
      window.removeEventListener(PRIVACY_EVENT, syncPrivacy);
      window.removeEventListener("storage", syncPrivacy);
    };
  }, []);

  useEffect(() => {
    const apply = (detail) => {
      if (!detail || !Number.isFinite(Number(detail.total))) return;
      setPnl(Number(detail.total));
      if (detail.open != null) setOpenCount(Number(detail.open) || 0);
    };
    const onPnl = (e) => apply(e.detail);
    window.addEventListener(TODAY_PNL_EVENT, onPnl);
    apply(readTodayPnlCache());
    return () => window.removeEventListener(TODAY_PNL_EVENT, onPnl);
  }, []);

  useEffect(() => {
    return subscribePositionsBook((payload) => {
      const total = payload?.pnl_today?.total;
      if (total == null || !Number.isFinite(Number(total))) return;
      setPnl(Number(total));
      setOpenCount(openLiveCount(payload));
    });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    startPositionsBookPolling();
    return () => stopPositionsBookPolling();
  }, [enabled]);

  if (!enabled) return null;

  const waiting = pnl == null;
  const positive = (pnl || 0) >= 0;
  const label = privacy
    ? PRIVACY_MASK
    : waiting
      ? "—"
      : `${positive ? "+" : ""}${pnl.toLocaleString(undefined, {
            minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  return (
    <div
      className={
        className ||
        "flex flex-col items-end leading-tight px-1.5 shrink-0"
      }
      data-testid="header-today-pnl"
      title={openCount > 0 ? `Today P&L · ${openCount} open` : "Today P&L (includes exited today)"}
    >
      <span className={`${compact ? "text-[8px]" : "text-[9px]"} uppercase tracking-wider text-slate-500 font-semibold`}>
        {compact ? "P&L" : "Today P&L"}
      </span>
      <span
        className={`font-mono-data font-bold tabular-nums ${
          compact ? "text-xs" : "text-sm"
        } ${
          privacy || waiting ? "text-slate-500" : positive ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        {privacy || waiting ? label : `₹${label}`}
      </span>
    </div>
  );
}

export { HeaderTodayPnl };

export default function Header({
  status,
  current,
  dataStatus,
  onOpenCreds,
  onOpenMorningRefresh: _onOpenMorningRefresh, // kept for API compat; token refresh via Kite API
  onOpenTelegramPrefs,
  onOpenSettings,
  onOpenIndexManager,
  onOpenJournal,
  onOpenErrorLog,
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
  enabledIndices = null,
  darkMode,
  onToggleDark,
  compact,
  onToggleCompact,
  onFreshPullDone,
  /** Parent (Dashboard) already resolved admin — don't wait on a second /auth/state. */
  assumedAdmin = false,
  publicAccessOpen = null,
  /** Slim one-line index + VIX/GIFT rail instead of tall ticker tiles. */
  headerRail = false,
  onToggleHeaderRail,
  /** Merge DataTruth / market / Kite banners into one slim bar. */
  slimStatusRail = false,
  /** Positions book poll interval (ms) — keeps header Today P&L fresh in background. */
  positionsPollMs = 30_000,
  /** Guests only see header P&L when Positions is a public page. */
  positionsPublic = true,
  showDeskAi = false,
  onDeskAiChange,
  onOpenDeskAiPanel,
  onOpenDeskAiMobile,
  onToggleSlimStatusRail,
}) {
  const price = current?.price ?? 0;
  const pcr = current?.pcr ?? 0;
  const vix = current?.vix ?? 0;
  const mode = status?.mode ?? "offline";

  // Auth state — hide Admin / Kite / Public controls from guests.
  // Trust server `is_admin` / Dashboard assumedAdmin only — never remember-me tokens.
  const [authState, setAuthState] = useState({
    is_admin: !!assumedAdmin,
    is_guest: false,
    public_access_open: !!publicAccessOpen,
  });
  // Auth state — Dashboard owns /auth/state. When assumedAdmin, only listen
  // for shared broadcasts (no duplicate poll).
  {
    let alive = true;
    const apply = (data) => {
      if (alive && data) setAuthState(data);
    };
    const load = async () => {
      if (assumedAdmin) return;
      try {
        const { data } = await api.get("/auth/state");
        apply(data);
      } catch (err) {
        console.error("[Header] auth_state fetch failed", err);
      }
    };
    useQuiescentAwarePolling(load, 60_000, [assumedAdmin], {
      immediate: false,
      allowDuringQuiescent: true,
      dedupeKey: "header-auth",
      delayMs: 10000,
    });
    useEffect(() => {
      const onState = (e) => apply(e?.detail);
      window.addEventListener("oi-admin-auth-state", onState);
      return () => {
        alive = false;
        window.removeEventListener("oi-admin-auth-state", onState);
      };
    }, []);
  }

  useEffect(() => {
    setAuthState((prev) => ({
      ...prev,
      ...(assumedAdmin ? { is_admin: true, is_guest: false } : {}),
      public_access_open:
        publicAccessOpen != null ? !!publicAccessOpen : prev.public_access_open,
    }));
  }, [assumedAdmin, publicAccessOpen]);

  // Dev override: allow forcing admin UI without X-Admin-Token for local debugging.
  const devForce = (typeof window !== "undefined") && (process.env.NODE_ENV !== "production") && (
    localStorage.getItem("oi_dev_force_admin") === "1" || sessionStorage.getItem("oi_dev_force_admin") === "1"
  );
  // Guests never see Admin/Kite. Prefer Dashboard's assumedAdmin; never promote guests.
  const isGuestUser = !!authState.is_guest && !assumedAdmin;
  const isAdmin = !isGuestUser && (devForce || !!assumedAdmin || (!!authState.is_admin && !authState.is_guest));
  const showHeaderPnl = isAdmin || (isGuestUser && positionsPublic);

  useEffect(() => {
    if (!(isAdmin || isGuestUser)) return undefined;
    startPositionsBookPolling();
    return () => stopPositionsBookPolling();
  }, [isAdmin, isGuestUser]);
  if (devForce) {
    try { console.warn("[Header] devForce admin UI enabled via oi_dev_force_admin"); } catch (_) {}
  }
  // Admin-only: when Kite is live, show the connected Zerodha user id on the button.
  const kiteUserId = isAdmin && status?.kite_user_id ? String(status.kite_user_id) : null;
  const kiteBtnLabel = kiteUserId || "Kite API";
  const kiteBtnTitle = kiteUserId
    ? `Kite live as ${kiteUserId} — open credentials`
    : "Connect / refresh Kite API credentials";
  // Match Admin button / desk emerald green when showing the logged-in user id.
  const kiteBtnCls = kiteUserId
    ? "rounded-sm h-8 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400 font-semibold"
    : "rounded-sm h-8 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";

  const deskAiChipClass = (on) =>
    `inline-flex items-center justify-center gap-1 h-8 w-8 md:w-auto md:px-2 rounded-md border-2 text-[11px] font-bold tracking-wide shrink-0 ${
      on
        ? "border-violet-400 bg-violet-600 text-white hover:bg-violet-700"
        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
    }`;
  const deskAiChipMobile = (
    <button
      type="button"
      data-testid="header-ai-chip"
      onClick={() => onOpenDeskAiMobile?.()}
      className={deskAiChipClass(showDeskAi)}
      title="Desk AI"
    >
      <Sparkles className="w-3.5 h-3.5" />
    </button>
  );
  const deskAiChipDesktop = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="header-ai-chip"
          className={deskAiChipClass(showDeskAi)}
          title="Desk AI"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2" data-testid="header-ai-menu">
        <DeskAiConfigMenu
          showDeskAi={showDeskAi}
          onDeskAiChange={onDeskAiChange}
          onOpenPanel={onOpenDeskAiPanel}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
    const unsub = subscribeExtras(onExtras, { immediate: true, pollMs: 30_000, delayMs: 5000 });
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
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  useEffect(() => {
    if (!mobileToolsOpen) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-testid='mobile-admin-tools'], [data-testid='tablet-admin-tools'], [data-testid='btn-mobile-tools'], [data-testid='btn-tablet-tools']")) return;
      setMobileToolsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [mobileToolsOpen]);
  useEffect(() => {
    const open = () => setMobileToolsOpen(true);
    const toggle = () => setMobileToolsOpen((v) => !v);
    const close = () => setMobileToolsOpen(false);
    window.addEventListener("oi-open-admin-tools", open);
    window.addEventListener("oi-toggle-admin-tools", toggle);
    window.addEventListener("oi-close-admin-tools", close);
    return () => {
      window.removeEventListener("oi-open-admin-tools", open);
      window.removeEventListener("oi-toggle-admin-tools", toggle);
      window.removeEventListener("oi-close-admin-tools", close);
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("oi-admin-tools-changed", { detail: { open: mobileToolsOpen } }));
  }, [mobileToolsOpen]);
  const onRefreshDay = async () => {
    if (!isAdmin) return;
    if (!window.confirm(
      "Fresh Pull resets today's OI board for every ENABLED index.\n\n" +
      "What it does:\n" +
      "• Deletes ALL stored OI snapshots (cannot undo)\n" +
      "• Pulls one live Kite tick now for each enabled index\n" +
      "• Normal polling continues from there\n\n" +
      "• Live (Kite): real ticks only — history before now cannot be recovered\n" +
      "• Offline: wipe only (no fake backfill)\n" +
      "• Disabled indices in Settings are skipped"
    )) return;
    const closedDay = !isTradingDayIST(todayIST());
    let force = false;
    if (closedDay) {
      if (!window.confirm(
        "Markets are closed (weekend or holiday).\n\n" +
        "Fresh Pull will wipe the last trading session from the board.\n\n" +
        "Are you sure you want to continue?"
      )) return;
      force = true;
    }
    setRefreshing(true);
    try {
      const { data } = await api.post("/admin/refresh-day", { force });
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

  const modeBadge = kiteModeBadge(mode, !!status?.market?.is_market_open);
  const modeBadgeCls = kiteModeBadgeClass(modeBadge.tone);

  const toolBtn =
    "rounded-sm border-slate-200/80 bg-white/80 hover:bg-emerald-50 hover:border-emerald-200 dark:bg-slate-800/80 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-emerald-950/40 dark:hover:border-emerald-800 h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3 transition-colors duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500/80";

  return (
    <header
      data-testid="dashboard-header"
      className={`oi-header w-full relative z-50 ${headerRail ? "oi-header-slim" : "oi-header-desk"}`}
      data-density={headerRail ? "slim" : "desk"}
    >
      {(adminMenuOpen || mobileToolsOpen) && typeof document !== "undefined" && createPortal(
        <button
          type="button"
          aria-label="Close admin tools"
          data-testid="admin-tools-scrim"
          className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-[2px]"
          onClick={() => {
            setAdminMenuOpen(false);
            setMobileToolsOpen(false);
          }}
        />,
        document.body,
      )}
      <GiftSessionsModal open={giftModalOpen} onOpenChange={setGiftModalOpen} windows={giftSessions} serverIst={extras?.server_time_ist} />

      {/* Mobile: slim tools row only — brand/index/tabs live in MobileStickyChrome */}
      <div
        className="md:hidden px-2 py-1.5 flex items-center gap-1 border-b border-slate-100 dark:border-slate-800 overflow-hidden"
        data-testid="mobile-header-tools"
      >
        <div className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden">
          <BrandLiveClock compact />
          {isGuestUser && (() => {
            const guestName = authState.guest_name || (typeof window !== "undefined" ? sessionStorage.getItem("oi_guest_name") : null) || "Guest";
            const exitGuest = async () => {
              await logoutGuest();
              window.location.reload();
            };
            return (
              <div
                className="flex flex-col items-start leading-tight min-w-0"
                data-testid="guest-session-chip-mobile"
              >
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[5.5rem]">
                  {guestName}
                </span>
                <button
                  type="button"
                  onClick={exitGuest}
                  className="text-[9px] font-medium text-rose-600 hover:text-rose-700 hover:underline"
                  data-testid="guest-session-exit-mobile"
                >
                  Exit
                </button>
              </div>
            );
          })()}
        </div>
        {showHeaderPnl && (
          <HeaderTodayPnl
            enabled
            compact
            status={status}
            pollMs={positionsPollMs}
            className="flex flex-col items-end leading-none px-1.5 shrink-0 border-l border-slate-200 dark:border-slate-700"
          />
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {deskAiChipMobile}
          <Button
            data-testid="btn-toggle-compact-mobile"
            variant="outline" size="sm" className={toolBtn}
            onClick={onToggleCompact}
            title={compact ? "Show sidebar" : "Hide sidebar"}
            aria-label={compact ? "Show sidebar" : "Hide sidebar"}
          >
            {compact ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="btn-mobile-view"
                variant="outline"
                size="sm"
                className={toolBtn}
                title="View & tools"
                aria-label="View and tools"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" data-testid="mobile-view-menu">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                View
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="mobile-menu-toggle-dark"
                onSelect={(e) => { e.preventDefault(); onToggleDark?.(); }}
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {darkMode ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="mobile-menu-notifications"
                onSelect={(e) => { e.preventDefault(); onToggleNotif?.(); }}
              >
                {notifEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {notifEnabled ? "Turn notifications off" : "Turn notifications on"}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="mobile-menu-sounds"
                onSelect={(e) => { e.preventDefault(); onOpenSounds?.(); }}
              >
                <Volume2 className="w-4 h-4" />
                Alert sounds
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="mobile-menu-csv"
                onSelect={(e) => { e.preventDefault(); onDownloadCsv?.(); }}
              >
                <Download className="w-4 h-4" />
                Download CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin && (
            <Button
              data-testid="btn-mobile-tools"
              size="sm"
              aria-pressed={mobileToolsOpen}
              onClick={() => setMobileToolsOpen((v) => !v)}
              className={`rounded-sm h-8 w-8 p-0 ${
                mobileToolsOpen
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
              title={mobileToolsOpen ? "Settings open — tap again to close" : "Settings"}
            >
              <Settings2 className="w-4 h-4" />
              <span className="sr-only">Settings</span>
            </Button>
          )}
        </div>
      </div>

      {isAdmin && mobileToolsOpen && (
        <div
          data-testid="mobile-admin-tools"
          className="relative z-[100] md:hidden px-3 pb-3 flex flex-wrap gap-2 border-b border-emerald-200 dark:border-emerald-800 pt-2 bg-white shadow-lg ring-1 ring-emerald-700/15 dark:bg-slate-900"
        >
          <div className="w-full flex items-center justify-between gap-2 px-0.5">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              Admin tools
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              onClick={() => setMobileToolsOpen(false)}
              data-testid="btn-mobile-tools-close"
              title="Close tools"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <Button data-testid="btn-mobile-settings" variant="outline" size="sm" className="rounded-sm" onClick={onOpenSettings}>
            <Settings2 className="w-4 h-4 mr-1.5" />
            Admin configuration
          </Button>
          <Button
            data-testid="btn-mobile-index-manager"
            variant="outline"
            size="sm"
            className="rounded-sm"
            onClick={() => { setMobileToolsOpen(false); onOpenIndexManager?.(); }}
          >
            <Layers className="w-4 h-4 mr-1.5" />
            Index management
          </Button>
          <Button data-testid="btn-mobile-kite" variant="outline" size="sm" className={kiteBtnCls} onClick={onOpenCreds} title={kiteBtnTitle}>
            <KeyRound className={`w-4 h-4 mr-1.5 ${kiteUserId ? "text-emerald-600" : ""}`} />
            <span className={kiteUserId ? "text-emerald-700 dark:text-emerald-400 font-semibold" : undefined}>
              {kiteBtnLabel}
            </span>
          </Button>
          <Button
            data-testid="btn-mobile-fresh-pull"
            size="sm"
            onClick={onRefreshDay}
            disabled={refreshing}
            className="rounded-sm bg-rose-600 hover:bg-rose-700 text-white"
          >
            <Database className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-pulse" : ""}`} />
            {refreshing ? "Refreshing…" : "Fresh Pull"}
          </Button>
          <Button data-testid="btn-mobile-upload" size="sm" onClick={onOpenUpload} className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white">
            <UploadCloud className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <Button data-testid="btn-mobile-telegram" variant="outline" size="sm" className="rounded-sm" onClick={onOpenTelegramPrefs}>
            <Send className="w-4 h-4 mr-1.5" />
            Telegram
          </Button>
          <Button
            data-testid="btn-mobile-error-log"
            variant="outline"
            size="sm"
            className="rounded-sm"
            onClick={() => { setMobileToolsOpen(false); onOpenErrorLog?.(); }}
          >
            <ScrollText className="w-4 h-4 mr-1.5" />
            Error log
          </Button>
          <Button data-testid="btn-mobile-sounds" variant="outline" size="sm" className="rounded-sm" onClick={onOpenSounds}>
            <Volume2 className="w-4 h-4 mr-1.5" />
            Sounds
          </Button>
          <Button data-testid="btn-mobile-csv" variant="outline" size="sm" className="rounded-sm" onClick={onDownloadCsv}>
            <Download className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
          <div className="w-full basis-full">
            <AdminControls
              variant="panel"
              assumedAdmin={isAdmin}
              publicAccessOpen={
                publicAccessOpen != null
                  ? !!publicAccessOpen
                  : !!authState.public_access_open
              }
            />
          </div>
        </div>
      )}

      {/* Desktop header — compact single row for laptop/zoom; tools in a dropdown */}
      <div className="hidden md:block">
      {/* Row 1: brand + status + essential actions */}
      <div className={`px-3 sm:px-4 flex items-center gap-1.5 lg:gap-2 flex-nowrap min-w-0 ${headerRail ? "py-1" : "py-2 gap-2 lg:gap-3"}`}>
        <BrandMark compact={headerRail} className="shrink-0" />
        {deskAiChipDesktop}

        {/* VIX / GIFT — always visible; slim = chips, normal = stacked metrics */}
        <div className={`flex items-center ${headerRail ? "gap-1.5" : "gap-3"} pl-2 border-l border-slate-200 dark:border-slate-700 shrink-0`}>
          <VixMetric value={vix} sessionOpen={vixSessionOpen} liveVix={extras.vix} inline={headerRail} />
          <ExtraTickerCell
            label="GIFT NIFTY"
            data={extras.gift_nifty}
            windows={giftSessions}
            openNow={extras?.windows?.gift?.open_now}
            kiteSymbol={extras?.windows?.gift?.kite_symbol || "NSEIX:GIFT NIFTY"}
            serverIst={extras?.server_time_ist}
            onOpenSessions={() => setGiftModalOpen(true)}
            inline={headerRail}
          />
        </div>

        {/* Index tiles — always allow horizontal scroll so BANKNIFTY is not clipped */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 pl-2 border-l border-slate-200 dark:border-slate-700 justify-start overflow-hidden items-stretch">
          <TickerStrip
            layout={headerRail ? "rail" : "header"}
            activeIndex={activeIndex}
            onSelectIndex={onSelectIndex}
            spotPrices={spotPrices}
            tickers={Array.isArray(tickerData) ? tickerData : null}
            enabledIndices={enabledIndices}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <div className="origin-right">
            <BigClock compact />
          </div>
          {showHeaderPnl && (
            <HeaderTodayPnl
              enabled
              status={status}
              pollMs={positionsPollMs}
              className="hidden md:flex flex-col items-end leading-tight px-2 shrink-0 border-l border-slate-200 dark:border-slate-700"
            />
          )}
          {lastPulledAt && (
            <div
              className="hidden"
              data-testid="oi-and-time"
              title={nowLabel ? `Now ${nowLabel}` : undefined}
            >
              {headerRail ? (
                <>
                  <span className="uppercase tracking-wider text-slate-500 text-[10px]">Live as of</span>
                  <span className="font-semibold text-slate-950 dark:text-slate-100">
                    {new Date(lastPulledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </span>
                </>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">Live data as of</div>
                  <div className="text-base font-semibold text-slate-950 dark:text-slate-100">{new Date(lastPulledAt).toLocaleTimeString()}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${status?.market && status.market.is_market_open ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className={`font-semibold ${status?.market && status.market.is_market_open ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>{nowLabel}</span>
                  </div>
                </>
              )}
            </div>
          )}
          {(!slimStatusRail) && (
          <div className={`flex items-stretch gap-0.5 shrink-0 ${headerRail ? "flex-row items-center" : "flex-col"}`} data-testid="kite-status-stack">
            <Badge
              data-testid="mode-badge"
              className={`rounded-sm ${modeBadgeCls} ${headerRail ? "text-[10px] px-1.5 py-0 h-6" : ""}`}
              title={[
                modeBadge.title,
                mode === "kite" && dataStatus?.data_date && status?.market?.is_market_open === false
                  ? `Session ${dataStatus.data_date}`
                  : null,
              ].filter(Boolean).join(" · ")}
            >
              {modeBadge.label}
            </Badge>
            {!headerRail && mode === "kite" && dataStatus?.data_date && status?.market && status.market.is_market_open === false && (
              <span
                data-testid="session-date-chip"
                className="text-[10px] font-mono-data text-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5"
                title={`Last session date on the board: ${dataStatus.data_date}. Not live ticks.`}
              >
                {dataStatus.data_date}
              </span>
            )}
            {!headerRail && mode !== "kite" && (
              <span
                data-testid="offline-hint-chip"
                className="hidden sm:inline-flex text-[10px] font-mono-data text-center text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5"
                title="Kite API key required for live updates. Connect via Kite API."
              >
                Needs API key
              </span>
            )}
          </div>
          )}

          {isGuestUser && (
            (() => {
              const guestName = authState.guest_name || (typeof window !== "undefined" ? sessionStorage.getItem("oi_guest_name") : null) || "Guest";
              const exitGuest = async () => {
                await logoutGuest();
                window.location.reload();
              };
              return (
                <div
                  className="hidden sm:flex flex-col items-end justify-center px-2.5 py-1 rounded-md border border-slate-200/80 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/80 leading-tight"
                  data-testid="guest-session-chip"
                >
                  <span className="group relative inline-flex">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 cursor-default">
                      {guestName}
                    </span>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-0 bottom-full z-50 mb-1.5 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-md group-hover:block dark:bg-slate-700"
                    >
                      User auto exits at 6:00 AM
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={exitGuest}
                    className="text-[10px] font-medium text-rose-600 hover:text-rose-700 hover:underline"
                    data-testid="guest-session-exit"
                  >
                    Exit
                  </button>
                </div>
              );
            })()
          )}

          {isAdmin && (
            <div className="hidden sm:block">
              <AdminControls
                assumedAdmin={isAdmin}
                publicAccessOpen={!!authState.public_access_open}
              />
            </div>
          )}

          {/* View / tools dropdown — theme → download (and sidebar / settings) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="btn-view-tools"
                variant="outline"
                size="sm"
                className={toolBtn}
                title="View & tools"
                aria-label="View and tools"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden xl:inline ml-1.5 text-xs">View</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" data-testid="view-tools-menu">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                Display &amp; tools
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="menu-toggle-dark"
                onSelect={(e) => { e.preventDefault(); onToggleDark?.(); }}
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {darkMode ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              {typeof onToggleHeaderRail === "function" && (
                <DropdownMenuItem
                  data-testid="menu-toggle-header-density"
                  onSelect={(e) => { e.preventDefault(); onToggleHeaderRail(); }}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  {headerRail ? "Normal header (tiles)" : "Slim header"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                data-testid="menu-toggle-notifications"
                onSelect={(e) => { e.preventDefault(); onToggleNotif?.(); }}
              >
                {notifEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {notifEnabled ? "Turn notifications off" : "Turn notifications on"}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-open-sounds"
                onSelect={(e) => { e.preventDefault(); onOpenSounds?.(); }}
              >
                <Volume2 className="w-4 h-4" />
                Alert sounds
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-download-csv"
                onSelect={(e) => { e.preventDefault(); onDownloadCsv?.(); }}
              >
                <Download className="w-4 h-4" />
                Download CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Desktop admin only — MUST use conditional render; lg:flex overrides Tailwind `hidden` */}
          {isAdmin && (
          <div className="hidden lg:flex items-center gap-2">
            <DropdownMenu open={adminMenuOpen} onOpenChange={setAdminMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="btn-admin-menu"
                  size="sm"
                  className="rounded-sm bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm h-8"
                  title="Admin tools"
                >
                  <Shield className="w-4 h-4 mr-1.5" />
                  Admin
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 z-[100] border-emerald-200 bg-white shadow-2xl ring-1 ring-emerald-700/15" data-testid="admin-tools-menu">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                  Desk tools
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="menu-refresh-day"
                  disabled={refreshing}
                  onSelect={(e) => { e.preventDefault(); onRefreshDay(); }}
                >
                  <Database className={`w-4 h-4 ${refreshing ? "animate-pulse" : ""}`} />
                  {refreshing ? "Refreshing…" : "Fresh Pull"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-upload"
                  onSelect={(e) => { e.preventDefault(); onOpenUpload?.(); }}
                >
                  <UploadCloud className="w-4 h-4" />
                  Upload
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-telegram"
                  onSelect={(e) => { e.preventDefault(); onOpenTelegramPrefs?.(); }}
                >
                  <Send className="w-4 h-4" />
                  Telegram
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-journal"
                  onSelect={(e) => { e.preventDefault(); onOpenJournal?.(); }}
                >
                  <BookOpen className="w-4 h-4" />
                  Trade journal
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-error-log"
                  onSelect={(e) => { e.preventDefault(); onOpenErrorLog?.(); }}
                >
                  <ScrollText className="w-4 h-4" />
                  Error log
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-settings"
                  onSelect={(e) => { e.preventDefault(); onOpenSettings?.(); }}
                >
                  <Settings2 className="w-4 h-4" />
                  Admin configuration
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-index-manager"
                  onSelect={(e) => { e.preventDefault(); onOpenIndexManager?.(); }}
                >
                  <Layers className="w-4 h-4" />
                  Index management
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                  Account
                </DropdownMenuLabel>
                <DropdownMenuItem
                  data-testid="menu-open-access-control"
                  onSelect={(e) => {
                    e.preventDefault();
                    try {
                      window.__oi_access_open_pending = true;
                      window.dispatchEvent(new CustomEvent("oi-admin-open-access"));
                    } catch (_) {
                      window.dispatchEvent(new Event("oi-admin-open-access"));
                    }
                  }}
                >
                  <UserCheck className="w-4 h-4" />
                  Access Control
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-change-password"
                  onSelect={(e) => {
                    e.preventDefault();
                    try {
                      window.__oi_password_open_pending = true;
                      window.dispatchEvent(new CustomEvent("oi-admin-open-password"));
                    } catch (_) {
                      window.dispatchEvent(new Event("oi-admin-open-password"));
                    }
                  }}
                >
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-admin-sign-out"
                  className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                  onSelect={async (e) => {
                    e.preventDefault();
                    try { await api.post("/auth/logout"); } catch (_) {}
                    clearAdminAuth({ clearRemember: true });
                    toast.success("Signed out.");
                    window.location.reload();
                  }}
                >
                  <LogOut className="w-4 h-4 text-rose-600" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              data-testid="btn-open-credentials"
              variant="outline" size="sm"
              className={kiteBtnCls}
              onClick={onOpenCreds}
              title={kiteBtnTitle}
            >
              <KeyRound className={`w-4 h-4 mr-1.5 ${kiteUserId ? "text-emerald-600" : ""}`} />
              <span className={kiteUserId ? "text-emerald-700 dark:text-emerald-400 font-semibold" : undefined}>
                {kiteBtnLabel}
              </span>
            </Button>
          </div>
          )}
        </div>
      </div>

      {/* Laptop extras row: clock + ATM/VIX/GIFT when they do not fit the top row (skip in rail mode — already inline) */}
      {!headerRail && (
      <div
        className="2xl:hidden px-3 sm:px-4 pb-2 flex items-center gap-3 flex-wrap border-t border-slate-100/80 dark:border-slate-800/80 pt-1.5"
        data-testid="header-secondary-row"
      >
        <div className="xl:hidden flex items-center gap-2">
          <BigClock compact />
        </div>
        <div className="flex items-center gap-4 min-w-0 overflow-hidden flex-wrap">
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
        {lastPulledAt && (
          <div className="hidden ml-auto text-[11px] font-mono-data text-slate-500 dark:text-slate-400 shrink-0" data-testid="oi-pulled-secondary">
            Live data as of {new Date(lastPulledAt).toLocaleTimeString()}
          </div>
        )}
      </div>
      )}

      {/* Tablet (md–lg): admin Tools row — phone uses the slim mobile header above */}
      {isAdmin && (
        <div className="hidden md:flex lg:hidden px-3 pb-2 items-center gap-2 justify-end" data-testid="tablet-tools-bar">
          <Button
            data-testid="btn-tablet-tools"
            size="sm"
            aria-pressed={mobileToolsOpen}
            onClick={() => setMobileToolsOpen((v) => !v)}
            className={`rounded-sm h-9 w-9 p-0 ${
              mobileToolsOpen
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
            title={mobileToolsOpen ? "Settings open — tap again to close" : "Settings: Public access, Admin configuration, Kite API, Fresh Pull"}
          >
            <Settings2 className="w-4 h-4" />
            <span className="sr-only">Settings</span>
          </Button>
        </div>
      )}

      {isAdmin && mobileToolsOpen && (
        <div
          data-testid="tablet-admin-tools"
          className="relative z-[100] hidden md:flex lg:hidden px-3 pb-3 flex-wrap gap-2 border-t border-emerald-200 dark:border-emerald-800 pt-2 bg-white shadow-lg ring-1 ring-emerald-700/15 dark:bg-slate-900"
        >
          <div className="w-full text-[10px] uppercase tracking-widest text-slate-500 font-semibold px-0.5">
            Admin tools
          </div>
          <Button data-testid="btn-tablet-settings" variant="outline" size="sm" className="rounded-sm" onClick={onOpenSettings}>
            <Settings2 className="w-4 h-4 mr-1.5" />
            Admin configuration
          </Button>
          <Button
            data-testid="btn-tablet-index-manager"
            variant="outline"
            size="sm"
            className="rounded-sm"
            onClick={() => { setMobileToolsOpen(false); onOpenIndexManager?.(); }}
          >
            <Layers className="w-4 h-4 mr-1.5" />
            Index management
          </Button>
          <Button data-testid="btn-tablet-kite" variant="outline" size="sm" className={kiteBtnCls} onClick={onOpenCreds} title={kiteBtnTitle}>
            <KeyRound className={`w-4 h-4 mr-1.5 ${kiteUserId ? "text-emerald-600" : ""}`} />
            <span className={kiteUserId ? "text-emerald-700 dark:text-emerald-400 font-semibold" : undefined}>
              {kiteBtnLabel}
            </span>
          </Button>
          <Button
            data-testid="btn-tablet-fresh-pull"
            size="sm"
            onClick={onRefreshDay}
            disabled={refreshing}
            className="rounded-sm bg-rose-600 hover:bg-rose-700 text-white"
          >
            <Database className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-pulse" : ""}`} />
            {refreshing ? "Refreshing…" : "Fresh Pull"}
          </Button>
          <Button data-testid="btn-tablet-upload" size="sm" onClick={onOpenUpload} className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white">
            <UploadCloud className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <Button data-testid="btn-tablet-telegram" variant="outline" size="sm" className="rounded-sm" onClick={onOpenTelegramPrefs}>
            <Send className="w-4 h-4 mr-1.5" />
            Telegram
          </Button>
          <Button
            data-testid="btn-tablet-error-log"
            variant="outline"
            size="sm"
            className="rounded-sm"
            onClick={() => { setMobileToolsOpen(false); onOpenErrorLog?.(); }}
          >
            <ScrollText className="w-4 h-4 mr-1.5" />
            Error log
          </Button>
          <Button data-testid="btn-tablet-sounds" variant="outline" size="sm" className="rounded-sm" onClick={onOpenSounds}>
            <Volume2 className="w-4 h-4 mr-1.5" />
            Sounds
          </Button>
          <Button data-testid="btn-tablet-csv" variant="outline" size="sm" className="rounded-sm" onClick={onDownloadCsv}>
            <Download className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
          <div className="w-full basis-full">
            <AdminControls
              variant="panel"
              assumedAdmin={isAdmin}
              publicAccessOpen={
                publicAccessOpen != null
                  ? !!publicAccessOpen
                  : !!authState.public_access_open
              }
            />
          </div>
        </div>
      )}
      </div>
    </header>
  );
}

function VixMetric({ value, sessionOpen, liveVix, inline = false }) {
  // Compact tile: top-right % change, big price below — like the ticker tiles.
  const v = liveVix?.last != null && liveVix.last > 0 ? liveVix.last : (value ?? 0);
  const pct = liveVix && liveVix.change_pct != null ? Number(liveVix.change_pct) : (sessionOpen && v ? ((v - sessionOpen) / sessionOpen) * 100 : 0);
  const pts = liveVix && liveVix.change != null
    ? Number(liveVix.change)
    : (sessionOpen && v ? v - sessionOpen : null);
  const tone = pct > 0.05 ? "rose" : pct < -0.05 ? "emerald" : "slate";
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400";
  const hasData = v != null && v > 0;
  if (inline) {
    return (
      <div
        className="inline-flex items-center gap-1 h-6 px-1.5 rounded-sm text-[11px] tabular-nums"
        data-testid="vix-metric"
        title="India VIX"
      >
        <span className="uppercase tracking-wider text-slate-400 font-semibold">VIX</span>
        <span className={`font-semibold ${hasData ? "text-slate-900 dark:text-slate-100" : "text-slate-400"}`} data-testid="vix-value">
          {hasData ? Number(v).toFixed(2) : "—"}
        </span>
        {hasData && pts != null && Number.isFinite(pts) && (
          <span className={toneCls} data-testid="vix-change">
            {pts >= 0 ? "+" : ""}{pts.toFixed(2)}
          </span>
        )}
        <span className={toneCls}>{hasData ? `(${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : ""}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col min-w-[5.5rem]" data-testid="vix-metric">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-800 dark:text-slate-200 font-bold">
        <div className="flex items-center gap-1.5">INDIA VIX</div>
        <div className={`text-[11px] font-mono-data ${toneCls}`}>{hasData ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}</div>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <div className={`text-base font-bold font-mono-data ${hasData ? "text-slate-950 dark:text-slate-50" : "text-slate-400"}`} data-testid="vix-value">{hasData ? Number(v).toFixed(2) : "—"}</div>
        {pts != null && Number.isFinite(pts) && (
          <div className={`text-xs font-mono-data ${toneCls}`} data-testid="vix-change">{pts >= 0 ? "+" : ""}{Number(pts).toFixed(2)}</div>
        )}
      </div>
    </div>
  );
}

function ExtraTickerCell({ label, data, windows, serverIst, onOpenSessions, openNow, kiteSymbol, inline = false }) {
  const [hover, setHover] = useState(false);
  const [tipPos, setTipPos] = useState({ top: 0, left: 0 });
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

  const showTip = (el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 272;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - 8
    );
    setTipPos({ top: r.bottom + 8, left });
    setHover(true);
  };

  return (
    <div
      className={inline ? "inline-flex items-center relative" : "flex flex-col relative"}
      data-testid={`ticker-${label.toLowerCase().replace(/\s+/g, "-")}`}
      onMouseEnter={(e) => { if (isGift) showTip(e.currentTarget); }}
      onMouseLeave={() => setHover(false)}
    >
      {inline ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 h-6 px-1.5 rounded-sm text-[11px] tabular-nums hover:bg-slate-50 dark:hover:bg-slate-800"
          onClick={() => isGift && onOpenSessions?.()}
          title={giftTooltip || label}
        >
          {isGift && (
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-300"}`} />
          )}
          <span className="uppercase tracking-wider text-slate-400 font-semibold">
            {isGift ? "GIFT" : label}
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {hasData ? Number(data.last).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
          </span>
          {hasData && (
            <span className={toneCls} data-testid="gift-change">
              {chg >= 0 ? "+" : ""}{chg.toFixed(1)}
            </span>
          )}
          <span className={toneCls}>{hasData ? `(${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%)` : ""}</span>
        </button>
      ) : (
        <>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-800 dark:text-slate-200 font-bold">
        <div className="flex items-center gap-1.5">
          {/* persistent status dot — click opens full sessions modal */}
          {isGift && (
            <span
              title={giftTooltip || "GIFT NIFTY sessions"}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSessions?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenSessions?.();
              }}
              role="button"
              tabIndex={0}
              className={`inline-block w-2 h-2 rounded-full cursor-pointer ${isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"} mr-1.5`}
            />
          )}
          {label}
        </div>
        <div className={`text-[11px] font-mono-data ${toneCls}`}>{hasData ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "—"}</div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className={`text-base font-mono-data font-bold text-slate-950 dark:text-slate-50 tabular-nums leading-none`}>{hasData ? Number(data.last).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</div>
        <div className={`flex items-center gap-1 text-[11px] font-mono-data tabular-nums leading-none shrink-0 ${toneCls}`}>
          <span aria-hidden>{arrow}</span>
          <span>{chg > 0 ? "+" : ""}{chg.toFixed(2)}</span>
        </div>
      </div>
        </>
      )}

      {/* Fixed portal tooltip — header overflow:hidden was clipping the old absolute popover */}
      {isGift && hover && typeof document !== "undefined" && createPortal(
        <div
          data-testid="gift-nifty-hover-tip"
          className="fixed z-[200] w-[17rem] max-w-[min(92vw,17rem)] rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          style={{ top: tipPos.top, left: tipPos.left }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <div className="mb-1 font-semibold text-slate-900 dark:text-slate-100">GIFT NIFTY Sessions</div>
          <div className="mb-1.5 text-slate-700 dark:text-slate-200">{giftTooltip}</div>
          <div className="mb-1.5 text-[11px] text-slate-500">
            Kite: <span className="font-mono">{kiteSymbol || "NSEIX:GIFT NIFTY"}</span>
            {source ? ` · ${source}` : ""}
            {isProxy ? " · proxy" : ""}
          </div>
          {data?.note && <div className="mb-1 text-[10px] text-amber-700">{data.note}</div>}
          <div className="space-y-0.5 text-[11px] text-slate-500">
            {(windows || []).map((s, i) => (
              <div key={i}>
                {i === 0 ? "Morning" : i === 1 ? "Evening" : `Session ${i + 1}`}:{" "}
                {s.start_ist || s.start} – {s.end_ist || s.end} IST
                {sess && sess.activeIndex === i ? " · active" : ""}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-[11px] font-semibold text-sky-600 hover:underline"
            onClick={() => {
              setHover(false);
              onOpenSessions?.();
            }}
          >
            Open full schedule →
          </button>
        </div>,
        document.body
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