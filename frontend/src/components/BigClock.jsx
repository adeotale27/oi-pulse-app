import { useEffect, useRef, useState } from "react";
import { useNotify } from "@/hooks/useNotify";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FNO_CLOSE_MINUTE, WEEKEND_START_MINUTE, REMINDER_MINUTES, hmFromMinutes, getMarketOpenMinute, getMarketOpenHm } from "@/lib/marketTimes";
import {
  EVENT_WARNING_MINUTE,
  SUNDAY_BRIEF_MINUTE,
  buildEventWarningCopy,
  SECOND_SESSION_MINUTE,
} from "@/lib/overnightBrief";
import { isHoliday, todayIST } from "@/lib/holidays";

const CARRY_INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];

async function fetchIndexImpactPacks() {
  const packs = await Promise.all(
    CARRY_INDICES.map(async (idx) => {
      try {
        const { data } = await api.get(`/events/${idx}`);
        return { index: idx, events: data?.events || [] };
      } catch {
        return { index: idx, events: [] };
      }
    }),
  );
  return packs;
}

async function showCarryToast(weekday) {
  let indexImpacts = [];
  try {
    indexImpacts = await fetchIndexImpactPacks();
  } catch (_) { /* ignore */ }
  return buildEventWarningCopy(weekday, { indexImpacts });
}

// Helper: return a Date object representing the current IST local time.
function getISTDate(dt = new Date()) {
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

function getISTParts(dt = new Date()) {
  const istDate = getISTDate(dt);
  return {
    h: istDate.getUTCHours(),
    m: istDate.getUTCMinutes(),
    s: istDate.getUTCSeconds(),
    weekday: istDate.getUTCDay(), // 0=Sun … 5=Fri … 6=Sat
  };
}

export default function BigClock({ compact = false }) {
  const [now, setNow] = useState(new Date());
  const { push, alarm, requestPermission } = useNotify();
  const notifiedRef = useRef(new Set()); // keys like YYYY-MM-DD|HH:MM

  useEffect(() => {
    if (!compact) requestPermission();
  }, [requestPermission, compact]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { h, m, s, weekday } = getISTParts(now);
  const pad = (n) => String(n).padStart(2, "0");
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h >= 12 ? "PM" : "AM";

  const minutesOfDay = h * 60 + m;
  const holidayToday = isHoliday(todayIST());
  const isWeekend = (weekday === 5 && minutesOfDay >= WEEKEND_START_MINUTE) || weekday === 6 || weekday === 0;
  // Closing-soon / open reminders only on real NSE trading days (not Sat/Sun/holidays).
  const isTradingDay = !isWeekend && !holidayToday && weekday >= 1 && weekday <= 5;
  const isWeekday = isTradingDay;
  const holidayName = holidayToday?.name || null;

  const openMin = getMarketOpenMinute();
  const inAlertWindow =
    isTradingDay &&
    minutesOfDay >= Math.max(openMin, FNO_CLOSE_MINUTE - 20) &&
    minutesOfDay < FNO_CLOSE_MINUTE;

  useEffect(() => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const minuteKey = `${key}|${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const cur = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const openHm = getMarketOpenHm();
    const preOpenHm = hmFromMinutes(Math.max(0, openMin - 16));
    const auctionHm = hmFromMinutes(Math.max(0, openMin - 15));

    const scheduledAlerts = [
      {
        time: preOpenHm,
        days: [1, 2, 3, 4, 5],
        title: "Market is about to open",
        description: "Market is about to open.",
        toast: "Market is about to open.",
      },
      {
        time: auctionHm,
        days: [1, 2, 3, 4, 5],
        title: "Market has opened",
        description: "Market has opened. Have a profitable day.",
        toast: "Market opened — have a profitable day",
      },
      {
        time: openHm,
        days: [1, 2, 3, 4, 5],
        title: "Trading has begun",
        description: "Trading has begun.",
        toast: "Trading has begun.",
      },
      {
        time: hmFromMinutes(SECOND_SESSION_MINUTE),
        days: [1, 2, 3, 4, 5],
        title: "2nd session started",
        description: "It is 12:00 IST — start of the 2nd session. Review open risk and afternoon bias.",
        toast: "2nd session started · 12:00 IST",
      },
      {
        time: hmFromMinutes(WEEKEND_START_MINUTE),
        days: [5],
        title: "Market closed for weekend",
        description: "Hope you had a great week. See you on Monday.",
        toast: "Market closing for weekend — see you on Monday",
      },
    ];

    const reminderTimes = REMINDER_MINUTES.map(hmFromMinutes).filter(
      (t) => t !== hmFromMinutes(EVENT_WARNING_MINUTE),
    );

    if (s !== 0) return;

    // Never fire open/close/reminder toasts on NSE holidays (weekday check alone is not enough).
    if (holidayName && cur !== hmFromMinutes(SUNDAY_BRIEF_MINUTE)) {
      return;
    }

    const scheduled = scheduledAlerts.find(
      (alert) => alert.time === cur && alert.days.includes(weekday),
    );

    if (scheduled && !notifiedRef.current.has(minuteKey)) {
      notifiedRef.current.add(minuteKey);
      try { push(scheduled.title, scheduled.description); } catch (_) { /* ignore */ }
      try { alarm(); } catch (_) { /* ignore */ }
      try { toast.success(scheduled.toast, { description: scheduled.description }); } catch (_) { /* ignore */ }
    }

    // At the open: if tomorrow (or carry window) has multiple events, surface them
    // from the Big Clock so the desk sees India CPI + US CPI etc. early.
    if (
      isWeekday &&
      cur === openHm &&
      !notifiedRef.current.has(`${minuteKey}|multi-events`)
    ) {
      notifiedRef.current.add(`${minuteKey}|multi-events`);
      (async () => {
        const copy = await showCarryToast(weekday);
        if (!copy?.hasEvents || !(copy.lines?.length > 1)) return;
        try {
          push(copy.title, copy.lines.slice(0, 4).join(" · "));
        } catch (_) { /* ignore */ }
        try {
          toast(copy.title, {
            id: `open-events-${key}`,
            description: copy.lines.slice(0, 8).join("\n"),
            duration: 20000,
            closeButton: true,
            important: true,
            classNames: {
              toast: "border-2 border-amber-500 bg-amber-50 text-amber-950",
            },
          });
        } catch (_) { /* ignore */ }
      })();
    }

    // 15:15 sticky event / carry warning — must be dismissed manually.
    // OvernightGapBrief sticky card also auto-surfaces at this minute.
    if (
      isWeekday &&
      cur === hmFromMinutes(EVENT_WARNING_MINUTE) &&
      !notifiedRef.current.has(`${minuteKey}|events`)
    ) {
      notifiedRef.current.add(`${minuteKey}|events`);
      (async () => {
        const copy = await showCarryToast(weekday);
        try { push(copy.title, copy.lines.slice(0, 3).join(" · ") || copy.description); } catch (_) { /* ignore */ }
        try { alarm(); } catch (_) { /* ignore */ }
        try {
          toast(copy.title, {
            id: `event-carry-${key}`,
            description: copy.description,
            duration: Infinity, // manual close only
            closeButton: true,
            important: true,
            classNames: {
              toast: copy.hasEvents
                ? "border-2 border-amber-500 bg-amber-50 text-amber-950"
                : "border border-slate-300",
            },
          });
        } catch (_) { /* ignore */ }
      })();
    }

    // Sunday 20:00 — Monday-open gap brief toast (card also auto-opens).
    if (
      weekday === 0 &&
      cur === hmFromMinutes(SUNDAY_BRIEF_MINUTE) &&
      !notifiedRef.current.has(`${minuteKey}|sunday-brief`)
    ) {
      notifiedRef.current.add(`${minuteKey}|sunday-brief`);
      (async () => {
        const copy = await showCarryToast(0);
        try {
          push(
            "Sunday night gap brief",
            copy.lines.slice(0, 3).join(" · ") || "Review GIFT + Monday events before the open.",
          );
        } catch (_) { /* ignore */ }
        try { alarm(); } catch (_) { /* ignore */ }
        try {
          toast("Sunday night · Should I carry into Monday?", {
            id: `sunday-carry-${key}`,
            description:
              copy.hasEvents
                ? copy.description
                : "Check GIFT overnight move and whole-day bias in the sticky gap brief.",
            duration: Infinity,
            closeButton: true,
            important: true,
            classNames: {
              toast: "border-2 border-amber-500 bg-amber-50 text-amber-950",
            },
          });
        } catch (_) { /* ignore */ }
      })();
    }

    if (isWeekday && reminderTimes.includes(cur) && !notifiedRef.current.has(minuteKey)) {
      notifiedRef.current.add(minuteKey);
      try { push(`Market reminder · ${cur} IST`, `It is ${cur} IST — consider exiting positions.`); } catch (_) { /* ignore */ }
      try { alarm(); } catch (_) { /* ignore */ }
      try { toast.success(`Reminder: ${cur} IST`, { description: "Time to review / exit positions" }); } catch (_) { /* ignore */ }
    }
  }, [h, m, s, now, push, alarm, isWeekday, weekday, holidayName]);

  const closedTone = isWeekend || !!holidayName;
  const statusLine = inAlertWindow
    ? "Market closing soon — exit or hedge positions"
    : holidayName
      ? `NSE holiday — ${holidayName}`
      : isWeekend
        ? "Market closed for weekend — have a great weekend"
        : "Market clock (IST)";

  if (compact) {
    return (
      <div
        className={`px-2 py-1 rounded-sm flex items-center gap-2 ${
          inAlertWindow
            ? "bg-rose-600 text-white"
            : closedTone
              ? "bg-emerald-100 text-emerald-900"
              : "bg-slate-100 text-slate-900"
        }`}
        title={statusLine}
        data-testid="big-clock-compact"
      >
        <div className="font-mono-data font-semibold tabular-nums text-sm">{hour12}:{pad(m)}</div>
        <div className="text-xs opacity-80">{ampm}</div>
        <div className={`w-2 h-2 rounded-full ml-1 ${inAlertWindow ? "bg-white" : "bg-emerald-500"}`} />
      </div>
    );
  }

  return (
    <div
      className={`relative p-3 sm:p-4 border-t overflow-hidden ${
        inAlertWindow
          ? "border-rose-200"
          : closedTone
            ? "border-emerald-200"
            : "border-slate-200"
      }`}
    >
      {/* Atmospheric market-desk backdrop */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${
          inAlertWindow
            ? "bg-[radial-gradient(ellipse_at_top,_#fecaca_0%,_#fff1f2_45%,_#ffffff_100%)]"
            : closedTone
              ? "bg-[radial-gradient(ellipse_at_top,_#a7f3d0_0%,_#ecfdf5_40%,_#ffffff_100%)]"
              : "bg-[radial-gradient(ellipse_at_30%_0%,_#bbf7d0_0%,_transparent_50%),radial-gradient(ellipse_at_80%_100%,_#fed7aa_0%,_transparent_45%),linear-gradient(165deg,#f8fafc_0%,#ecfdf5_55%,#fff7ed_100%)]"
        }`}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent, transparent 11px, rgba(15,23,42,0.04) 11px, rgba(15,23,42,0.04) 12px)",
        }}
      />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-600 mb-1.5 font-semibold">
          Local (IST)
        </div>
        <div
          className={`w-full rounded-md p-3 sm:p-4 text-center flex flex-col items-center justify-center border shadow-sm ${
            inAlertWindow
              ? "bg-rose-600/95 text-white border-rose-500"
              : closedTone
                ? "bg-white/80 text-emerald-950 border-emerald-200 backdrop-blur-sm"
                : "bg-white/75 text-slate-900 border-emerald-200/80 backdrop-blur-sm"
          }`}
          data-testid="big-clock"
        >
          <div className="flex items-baseline justify-center gap-1.5 sm:gap-2">
            <div className="font-mono-data font-bold tracking-tight tabular-nums text-3xl sm:text-4xl md:text-5xl leading-none">
              {hour12}:{pad(m)}
            </div>
            <div
              className={`font-mono-data font-medium tracking-tight tabular-nums text-base sm:text-lg leading-none ${
                inAlertWindow ? "text-white/65" : "text-slate-400"
              }`}
              aria-hidden
            >
              {pad(s)}
            </div>
            <span
              className={`text-[11px] sm:text-xs font-semibold tracking-wide leading-none ${
                inAlertWindow ? "text-white/90" : "text-emerald-800"
              }`}
            >
              {ampm}
            </span>
          </div>

          {inAlertWindow ? (
            <div className="text-xs sm:text-sm mt-2 font-semibold text-white/95">{statusLine}</div>
          ) : closedTone ? (
            <div className="text-xs sm:text-sm mt-2 font-semibold text-emerald-900">{statusLine}</div>
          ) : (
            <div className="text-xs sm:text-sm mt-2 text-slate-600 font-medium">{statusLine}</div>
          )}
        </div>
      </div>
    </div>
  );
}
