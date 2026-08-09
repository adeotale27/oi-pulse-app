import { Clock, CalendarOff, Moon, Sunrise } from "lucide-react";
import { formatIstClock } from "@/lib/dataTruth";

/**
 * MarketStatusBanner — single-line, compact.
 * Renders only when `market.is_market_open === false`.
 */
export default function MarketStatusBanner({ market, lastPulledAt, dataDate = null }) {
  if (!market || market.is_market_open) return null;

  const phase = market.phase || "post_close";
  const openHm = market.display_open_ist || "09:15";
  const closeHm = market.display_close_ist || "15:40";
  const sessionDate = dataDate || market.session_anchor_date || null;
  const cfg = {
    pre_open: {
      icon: Sunrise,
      tone: "amber",
      title: market.banner_title || "Markets not open yet",
      short: `Opens ${openHm} IST`,
    },
    post_close: {
      icon: Moon,
      tone: "slate",
      title: market.banner_title || "Markets closed",
      short: `Closed at ${closeHm} IST`,
    },
    weekend: {
      icon: CalendarOff,
      tone: "slate",
      title: market.banner_title || "Weekend",
      short: `Resumes next session ${openHm} IST`,
    },
    holiday: {
      icon: CalendarOff,
      tone: "amber",
      title: market.banner_title || "NSE holiday",
      short: "Trading suspended today",
    },
  }[phase] || {
    icon: Clock,
    tone: "slate",
    title: "Markets closed",
    short: "",
  };

  const toneCls = {
    amber:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-100",
    slate:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200",
  }[cfg.tone];
  const iconCls = {
    amber: "text-amber-600 dark:text-amber-400",
    slate: "text-slate-500 dark:text-slate-400",
  }[cfg.tone];
  const Icon = cfg.icon;
  const snapClock = lastPulledAt ? formatIstClock(lastPulledAt, false) : null;

  return (
    <div
      data-testid="market-status-banner"
      className={`w-full border-b ${toneCls} px-4 py-1.5`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconCls}`} strokeWidth={2} />
        <span className="font-semibold">{cfg.title}</span>
        <span className="opacity-70">·</span>
        <span className="opacity-90">{cfg.short}</span>
        {sessionDate && (
          <>
            <span className="opacity-70">·</span>
            <span
              className="font-mono-data opacity-90"
              data-testid="market-banner-session-date"
              title="Board is showing this NSE session date (not live ticks)"
            >
              Session {sessionDate}
            </span>
          </>
        )}
        {snapClock && (
          <>
            <span className="opacity-70 hidden sm:inline">·</span>
            <span className="opacity-75 font-mono-data hidden sm:inline">
              Last snapshot {snapClock} IST
            </span>
          </>
        )}
      </div>
    </div>
  );
}
