import { Clock, CalendarOff, Moon, Sunrise } from "lucide-react";

/**
 * MarketStatusBanner
 *
 * Shows a professional, calm banner above the dashboard whenever the NSE
 * market is not actively open. It reads the pre-classified phase / titles
 * from `status.market.phase` so copy stays consistent between backend
 * announcements (Telegram) and the on-screen banner.
 *
 * Rendered only when `market.is_market_open === false`.
 */
export default function MarketStatusBanner({ market, lastPulledAt }) {
  if (!market || market.is_market_open) return null;

  const phase = market.phase || "post_close";
  const cfg = {
    pre_open: {
      icon: Sunrise,
      tone: "amber",
      title: market.banner_title || "Markets have not opened yet",
      detail:
        market.banner_detail ||
        "NSE opens at 9:15 AM IST. Live Open Interest polling will begin shortly. Displaying the most recent snapshot from our database.",
    },
    post_close: {
      icon: Moon,
      tone: "slate",
      title: market.banner_title || "Markets closed for the day",
      detail:
        market.banner_detail ||
        "NSE closed at 3:30 PM IST. Displaying today's final snapshot from our database — data will resume at 9:15 AM IST on the next trading day.",
    },
    weekend: {
      icon: CalendarOff,
      tone: "slate",
      title: market.banner_title || "Markets closed for the weekend",
      detail:
        market.banner_detail ||
        "NSE trading resumes on the next business day at 9:15 AM IST. Displaying the most recent snapshot from our database.",
    },
    holiday: {
      icon: CalendarOff,
      tone: "amber",
      title: market.banner_title || "Markets closed — NSE holiday",
      detail:
        market.banner_detail ||
        "Trading is suspended today. Displaying the most recent snapshot from our database.",
    },
  }[phase] || {
    icon: Clock,
    tone: "slate",
    title: "Markets closed",
    detail: "Displaying the most recent snapshot from our database.",
  };

  const toneClasses = {
    amber:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-100",
    slate:
      "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100",
  }[cfg.tone];

  const iconClasses = {
    amber: "text-amber-600 dark:text-amber-400",
    slate: "text-slate-500 dark:text-slate-400",
  }[cfg.tone];

  const Icon = cfg.icon;
  const nextOpen = market.next_market_open_ist
    ? new Date(market.next_market_open_ist).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      data-testid="market-status-banner"
      className={`w-full border-b ${toneClasses} px-4 py-2.5`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3 max-w-screen-2xl mx-auto">
        <div
          className={`shrink-0 w-8 h-8 rounded-full bg-white/70 dark:bg-slate-800/60 border border-white/60 dark:border-slate-700/60 flex items-center justify-center ${iconClasses}`}
        >
          <Icon className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold tracking-tight">
              {cfg.title}
            </span>
            <span
              data-testid="market-phase-tag"
              className="text-[10px] uppercase tracking-widest font-mono opacity-70"
            >
              {phase.replace("_", " ")}
            </span>
          </div>
          <p className="text-xs mt-0.5 opacity-90 leading-relaxed">
            {cfg.detail}
          </p>
          <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] opacity-75 font-mono-data">
            {nextOpen && (
              <span>
                <b className="font-semibold">Next open:</b> {nextOpen}
              </span>
            )}
            {lastPulledAt && (
              <span>
                <b className="font-semibold">Last snapshot:</b>{" "}
                {new Date(lastPulledAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
