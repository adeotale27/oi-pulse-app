import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { allHolidays, subscribeHolidays, todayIST } from "@/lib/holidays";
import { shouldRemindHolidayCalendar } from "@/lib/holidayReminder";

/**
 * Guests (and anyone on the desk) see this from 20 Dec until Admin uploads
 * a holiday circular that covers the needed year.
 */
export default function GuestHolidayCalendarBanner({ isAdmin = false, onOpenUpload }) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeHolidays(() => setTick((n) => n + 1)), []);
  const show = useMemo(() => {
    void tick;
    return shouldRemindHolidayCalendar(todayIST(), allHolidays());
  }, [tick]);

  if (!show) return null;
  const year = Number(todayIST().slice(0, 4));
  const md = todayIST().slice(5);
  const need = md >= "12-20" ? year + 1 : year;

  return (
    <div
      data-testid="guest-holiday-calendar-banner"
      className="w-full border-b border-sky-200 bg-sky-50 text-sky-950 px-3 sm:px-4 py-2"
      role="status"
    >
      <div className="flex items-start gap-2">
        <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-sky-700" />
        <div className="min-w-0 flex-1 text-[12px] leading-snug">
          <span className="font-semibold">NSE holiday calendar {need}</span>
          {" — "}
          from 20 Dec the desk needs next year’s trading holidays.
          {isAdmin
            ? " Upload the NSE circular in Admin → Upload (NSE holiday circular)."
            : " Ask the desk admin to upload the new NSE holiday list."}
        </div>
        {isAdmin && onOpenUpload && (
          <button
            type="button"
            data-testid="guest-holiday-calendar-upload"
            onClick={onOpenUpload}
            className="shrink-0 rounded-sm bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-semibold px-2 py-1"
          >
            Upload
          </button>
        )}
      </div>
    </div>
  );
}
