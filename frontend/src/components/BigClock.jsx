import { useEffect, useRef, useState } from "react";
import { useNotify } from "@/hooks/useNotify";
import { toast } from "sonner";

// Helper: return IST time parts for a Date
function getISTParts(dt = new Date()) {
  // Use Intl.DateTimeFormat to get parts in Asia/Kolkata timezone
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(dt);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

export default function BigClock({ compact = false }) {
  const [now, setNow] = useState(new Date());
  const { push, alarm, requestPermission } = useNotify();
  const notifiedRef = useRef(new Set()); // keys like YYYY-MM-DD|HH:MM

  useEffect(() => {
    // Request permission only for full view to avoid prompting mobile users for a compact header clock
    if (!compact) requestPermission();
  }, [requestPermission, compact]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { h, m, s } = getISTParts(now);
  const pad = (n) => String(n).padStart(2, "0");
  // Convert to 12-hour display
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h >= 12 ? "PM" : "AM";

  // Red alert window: 15:00:00 <= time < 15:30:00 IST
  const inAlertWindow = h === 15 && m < 30;

  // Notification schedule (IST times): 15:00, 15:15, 15:25
  useEffect(() => {
    // Build key for this exact minute
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const minuteKey = `${key}|${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

    const targets = ["15:00", "15:15", "15:25"];
    const cur = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

    if (targets.includes(cur) && s === 0) {
      // Only notify once per minuteKey
      if (!notifiedRef.current.has(minuteKey)) {
        notifiedRef.current.add(minuteKey);
        try { push(`Market reminder · ${cur} IST`, `It is ${cur} IST — consider exiting positions.`); } catch (e) { /* ignore */ }
        try { alarm(); } catch (_) { /* ignore */ }
        try { toast.success(`Reminder: ${cur} IST`, { description: "Time to review / exit positions" }); } catch (_) { /* ignore */ }
      }
    }
  }, [h, m, s, now, push, alarm]);

  // Compact rendering for header / mobile
  if (compact) {
    return (
      <div className={`px-2 py-1 rounded-sm flex items-center gap-2 ${inAlertWindow ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-900"}`}>
        <div className="font-mono-data font-semibold tabular-nums text-sm">{hour12}:{pad(m)}</div>
        <div className="text-xs opacity-80">{ampm}</div>
        <div className={`w-2 h-2 rounded-full ml-1 ${inAlertWindow ? "bg-white" : "bg-emerald-500"}`} />
      </div>
    );
  }

  return (
    <div className={`p-3 sm:p-4 border-t border-slate-200 ${inAlertWindow ? "bg-rose-50" : "bg-transparent"}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Local (IST)</div>
      <div className={`w-full rounded-md p-2 sm:p-3 text-center flex flex-col items-center justify-center ${inAlertWindow ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-900"}`}>
        <div className="flex items-baseline gap-3">
          <div className="font-mono-data font-bold tracking-tight tabular-nums text-2xl sm:text-3xl md:text-4xl">
            {hour12}:{pad(m)}
          </div>
          {/* Seconds are hidden on very small screens to avoid layout wrap */}
          <div className="font-mono-data font-medium tracking-tight tabular-nums text-lg text-slate-500 hidden sm:inline">:{pad(s)}</div>
          <div className="text-sm sm:text-base font-semibold ml-1">{ampm}</div>
        </div>

        {inAlertWindow ? (
          <div className="text-xs sm:text-sm mt-1 font-semibold text-white/90">Market closing soon — exit or hedge positions</div>
        ) : (
          <div className="text-xs sm:text-sm mt-1 text-slate-500">Market clock (IST)</div>
        )}
      </div>
    </div>
  );
}
