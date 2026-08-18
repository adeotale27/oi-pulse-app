import { useMemo, useState, useEffect } from "react";
import { CalendarDays, PartyPopper } from "lucide-react";
import { allHolidays, todayIST, formatDatePretty, daysBetweenIST, subscribeHolidays } from "@/lib/holidays";
import { upcomingEvents, eventBadgeTone } from "@/lib/econCalendar";
import PageBrandTitle from "@/components/PageBrandTitle";

export default function HolidaysTab() {
  const today = todayIST();
  const [calTick, setCalTick] = useState(0);
  useEffect(() => subscribeHolidays(() => setCalTick((n) => n + 1)), []);
  const holidays = useMemo(() => allHolidays(), [calTick]);
  const events = useMemo(() => upcomingEvents(20), []);

  return (
    <div className="space-y-6" data-testid="holidays-tab">
      <PageBrandTitle title="Events" className="mb-1" testId="events-page-title" />
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-slate-700" />
          <div className="text-sm font-semibold">NSE Trading Holidays</div>
          <span className="text-[10px] text-slate-400">Official circular · upload next year in Admin Upload</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {holidays.map((h) => {
            const isPast = h.date < today;
            const isToday = h.date === today;
            const diff = daysBetweenIST(today, h.date);
            const isNext = !isPast && diff <= 60;
            return (
              <div
                key={h.date}
                data-testid="holiday-row"
                className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                  isToday
                    ? "border-rose-500 bg-rose-50"
                    : isPast
                      ? "border-slate-100 bg-slate-50 text-slate-400 line-through"
                      : isNext
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex-shrink-0 w-16 text-xs font-mono-data font-semibold">
                  {formatDatePretty(h.date).split(",")[0]}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">
                    {formatDatePretty(h.date)}
                  </div>
                  <div className={`text-sm font-medium ${isPast ? "" : "text-slate-900"}`}>
                    {h.name}
                  </div>
                </div>
                {isToday && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-rose-500 text-white rounded-sm uppercase">
                    Today
                  </span>
                )}
                {!isPast && !isToday && diff <= 7 && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500 text-white rounded-sm uppercase">
                    In {diff}d
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <PartyPopper className="w-4 h-4 text-slate-700" />
          <div className="text-sm font-semibold">Upcoming Economic Events</div>
          <span className="text-[10px] text-slate-400">RBI · Budget · CPI · GDP</span>
        </div>
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.date + e.name} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-sm border ${eventBadgeTone(e.type)}`}>{e.type}</span>
              <div className="flex-1">
                <div className="text-sm font-medium">{e.name}</div>
                <div className="text-[10px] text-slate-500">{formatDatePretty(e.date)}</div>
              </div>
              <div className="text-[11px] font-mono-data text-slate-600">In {e.daysAway}d</div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-xs text-slate-400">No upcoming events tracked.</div>
          )}
        </div>
      </div>
    </div>
  );
}
