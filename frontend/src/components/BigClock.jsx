import { useEffect, useRef, useState } from "react";
import { useNotify } from "@/hooks/useNotify";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FNO_CLOSE_MINUTE, WEEKEND_START_MINUTE, REMINDER_MINUTES, hmFromMinutes } from "@/lib/marketTimes";
import {
  EVENT_WARNING_MINUTE,
  SUNDAY_BRIEF_MINUTE,
  buildEventWarningCopy,
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

  const inAlertWindow =
    isTradingDay &&
    minutesOfDay >= (15 * 60 + 10) &&
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

    const scheduledAlerts = [
      {
        time: "08:59",
        days: [1, 2, 3, 4, 5],
        title: "Market is about to open",
        description: "Market is about to open.",
        toast: "Market is about to open.",
      },
      {
        time: "09:00",
        days: [1, 2, 3, 4, 5],
        title: "Market has opened",
        description: "Market has opened. Have a profitable day.",
        toast: "Market opened — have a profitable day",
      },
      {
        time: "09:15",
        days: [1, 2, 3, 4, 5],
        title: "Trading has begun",
        description: "Trading has begun.",
        toast: "Trading has begun.",
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
    <div className={`p-3 sm:p-4 border-t border-slate-200 ${inAlertWindow ? "bg-rose-50" : closedTone ? "bg-emerald-50" : "bg-transparent"}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Local (IST)</div>
      <div
        className={`w-full rounded-md p-2 sm:p-3 text-center flex flex-col items-center justify-center ${
          inAlertWindow
            ? "bg-rose-600 text-white"
            : closedTone
              ? "bg-emerald-100 text-emerald-900"
              : "bg-slate-100 text-slate-900"
        }`}
        data-testid="big-clock"
      >
        <div className="flex items-baseline gap-3">
          <div className="font-mono-data font-bold tracking-tight tabular-nums text-2xl sm:text-3xl md:text-4xl">
            {hour12}:{pad(m)}
          </div>
          <div className="font-mono-data font-medium tracking-tight tabular-nums text-lg text-slate-500 hidden sm:inline">:{pad(s)}</div>
          <div className="text-sm sm:text-base font-semibold ml-1">{ampm}</div>
        </div>

        {inAlertWindow ? (
          <div className="text-xs sm:text-sm mt-1 font-semibold text-white/90">{statusLine}</div>
        ) : closedTone ? (
          <div className="text-xs sm:text-sm mt-1 font-semibold text-emerald-900">{statusLine}</div>
        ) : (
          <div className="text-xs sm:text-sm mt-1 text-slate-500">{statusLine}</div>
        )}
      </div>
    </div>
  );
}
