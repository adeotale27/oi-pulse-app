import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WEEKEND_START_MINUTE, GIFT_SESSION_WINDOWS } from "@/lib/marketTimes";

function parseHM(hm) {
  const [hh, mm] = String(hm).split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function fmtHM(hm) {
  // ensure "HH:MM" format
  const [hh, mm] = String(hm).split(":").map((v) => (v == null ? 0 : Number(v)));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}`;
}

function minutesToHuman(mins) {
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function GiftSessionsModal({ open, onOpenChange, windows = [], serverIst = null }) {
  // normalize windows: accept null, single-object, or array
  const sessions = (() => {
    try {
      if (!windows) return GIFT_SESSION_WINDOWS;
      if (Array.isArray(windows)) return windows.length ? windows : GIFT_SESSION_WINDOWS;
      if (windows.sessions && Array.isArray(windows.sessions) && windows.sessions.length) return windows.sessions;
      if (windows.sessions && typeof windows.sessions === "object" && !Array.isArray(windows.sessions) && windows.sessions.start_ist && windows.sessions.end_ist) {
        return [{ start_ist: windows.sessions.start_ist, end_ist: windows.sessions.end_ist }];
      }
      if (windows.start_ist && windows.end_ist) return [{ start_ist: windows.start_ist, end_ist: windows.end_ist }];
      if (windows.start && windows.end) return [{ start_ist: windows.start, end_ist: windows.end }];
      return GIFT_SESSION_WINDOWS;
    } catch {
      return GIFT_SESSION_WINDOWS;
    }
  })();

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

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [open]);

  const info = useMemo(() => {
    const nowDate = getIstDate(serverIst ? new Date(serverIst) : new Date());
    const nowMinutes = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
    const nowDay = nowDate.getUTCDay();
    const minutesOfDay = nowMinutes;
    const isWeekend = (nowDay === 5 && minutesOfDay >= WEEKEND_START_MINUTE) || nowDay === 6 || nowDay === 0;

    let activeIndex = -1;
    if (!isWeekend) {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const startM = parseHM(s.start_ist || s.start || "00:00");
        const endM = parseHM(s.end_ist || s.end || "00:00");
        if (startM <= endM) {
          if (nowMinutes >= startM && nowMinutes <= endM) { activeIndex = i; break; }
        } else {
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
        const nextMondayStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), 6, 30));
        const nextMonday = new Date(nextMondayStart.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
        minsUntilNext = Math.max(0, Math.round((nextMonday.getTime() - nowDate.getTime()) / 60000));
      } else {
        let minDelta = 24 * 60 + 1;
        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          const startM = parseHM(s.start_ist || s.start || "00:00");
          let delta = startM - nowMinutes;
          if (delta <= 0) delta += 24 * 60;
          if (delta < minDelta) { minDelta = delta; nextIndex = i; }
        }
        minsUntilNext = minDelta;
      }
    } else {
      const s = sessions[activeIndex];
      const endM = parseHM(s.end_ist || s.end || "00:00");
      let remaining = 0;
      const nowM = nowMinutes;
      const startM = parseHM(s.start_ist || s.start || "00:00");
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
  }, [sessions, serverIst, tick]);

  return (
    <Dialog open={!!open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>GIFT NIFTY Sessions</DialogTitle>
          <DialogDescription>Current session status and upcoming session timings (IST).</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="text-sm text-slate-700">
            {info.activeIndex >= 0 ? (
              <div className="flex items-center gap-2">
                <div className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                <div>Open · time left: <span className="font-mono-data">{minutesToHuman(info.minsUntilNext)}</span></div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="inline-block w-2 h-2 rounded-full bg-slate-300" />
                <div>Closed · next starts in <span className="font-mono-data">{minutesToHuman(info.minsUntilNext)}</span></div>
              </div>
            )}
          </div>

          <div className="text-sm text-slate-600 space-y-1">
            {sessions.map((s, i) => (
              <div key={i} className={`p-2 rounded ${info.activeIndex === i ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50 border border-slate-100'}`}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{i === 0 ? 'Morning' : i === 1 ? 'Evening' : `Session ${i+1}`}</div>
                  <div className="text-xs text-slate-500">{(s.start_ist || s.start)} – {(s.end_ist || s.end)} IST</div>
                </div>
                {info.activeIndex === i && (
                  <div className="text-xs text-slate-500 mt-1">Time left: <span className="font-mono-data">{minutesToHuman(info.minsUntilNext)}</span></div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)} className="rounded-sm">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
