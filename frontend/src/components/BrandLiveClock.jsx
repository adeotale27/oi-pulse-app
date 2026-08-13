import { useEffect, useState } from "react";
import OiPulseLogo from "@/components/OiPulseLogo";

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
 * Compact brand + live IST clock for the phone header.
 * Replaces the crowded LIVE badge + BigClock pair.
 */
export default function BrandLiveClock({ className = "" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = formatIstClock(now);

  return (
    <div
      className={`flex items-center gap-2 min-w-0 ${className}`}
      data-testid="brand-live-clock"
      title={`${clock} IST`}
    >
      <OiPulseLogo className="h-8 w-8 rounded-lg shrink-0" />
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 truncate">
          OI Pulse
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-mono-data whitespace-nowrap">{clock} IST</span>
        </span>
      </div>
    </div>
  );
}
