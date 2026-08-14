import { useEffect, useState } from "react";
import OiPulseLogo from "@/components/OiPulseLogo";
import { APP_NAME, APP_VERSION_LABEL, openAboutApp } from "@/lib/appVersion";

function formatIstClock(now = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);
}

/**
 * Brand + live IST clock for the header (including phone).
 * Compact keeps a smaller logo; name and version always stay visible.
 * Tap opens About.
 */
export default function BrandLiveClock({ className = "", compact = false }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = formatIstClock(now);

  return (
    <button
      type="button"
      onClick={openAboutApp}
      className={`flex items-center gap-2 min-w-0 text-left rounded-md hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${className}`}
      data-testid="brand-live-clock"
      title={`About ${APP_NAME} ${APP_VERSION_LABEL} · ${clock} IST`}
    >
      <OiPulseLogo className={`${compact ? "h-7 w-7" : "h-8 w-8"} rounded-lg shrink-0`} />
      <div className="flex flex-col leading-tight min-w-0">
        <span className={`${compact ? "text-[11px]" : "text-[12px]"} font-semibold text-emerald-700 dark:text-emerald-400 truncate`}>
          {APP_NAME} <span className="text-[10px] font-semibold text-slate-500">{APP_VERSION_LABEL}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-mono-data whitespace-nowrap">{clock}{compact ? "" : " IST"}</span>
        </span>
      </div>
    </button>
  );
}
