import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Calendar, AlertTriangle, TrendingUp, Users, Building2, Clock, ChevronDown, ChevronUp } from "lucide-react";

/**
 * EventRiskWidget — shows upcoming index event risk for the current strategy
 * page (activeIndex). Auto-refetches when activeIndex changes.
 *
 * Weightage-based colour coding:
 *   > 5 %  → dark red
 *   3-5 %  → red
 *   1-3 %   → orange
 *   < 1 %   → yellow
 *   missing → grey (lowest priority)
 */

const INDEX_LABEL = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "Bank Nifty",
  SENSEX: "Sensex",
};

function weightageBucket(w) {
  if (w == null) return "grey";
  if (w > 5) return "dark-red";
  if (w >= 3) return "red";
  if (w >= 1) return "orange";
  return "yellow";
}

const BUCKET_STYLES = {
  // Professional palette — left-border severity stripe + neutral card body.
  "dark-red": {
    card:  "border-l-4 border-l-rose-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100",
    chip:  "bg-rose-700 text-white border-rose-800",
    dot:   "bg-rose-700",
    badge: "text-rose-700 dark:text-rose-300",
    label: "Critical",
  },
  red: {
    card:  "border-l-4 border-l-rose-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100",
    chip:  "bg-rose-500 text-white border-rose-600",
    dot:   "bg-rose-500",
    badge: "text-rose-600 dark:text-rose-400",
    label: "High",
  },
 yellow: {
  card:  "border-l-4 border-l-lime-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100",
  chip:  "bg-lime-500 text-white border-lime-600",
  dot:   "bg-lime-500",
  badge: "text-lime-600 dark:text-lime-400",
  label: "Medium",
},
  orange: {
    card:  "border-l-4 border-l-sky-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100",
    chip:  "bg-sky-500 text-white border-sky-600",
    dot:   "bg-sky-500",
    badge: "text-sky-600 dark:text-sky-400",
    label: "Low",
  },
  grey: {
    card:  "border-l-4 border-l-slate-300 dark:border-l-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100",
    chip:  "bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600",
    dot:   "bg-slate-400",
    badge: "text-slate-500 dark:text-slate-400",
    label: "N/A",
  },
};

function formatDate(iso) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch (_) { return iso; }
}

function daysLeftText(n) {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 0) return `${Math.abs(n)}d ago`;
  return `${n}d left`;
}

export default function EventRiskWidget({ activeIndex }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  useEffect(() => {
    if (!activeIndex) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    api.get(`/events/${activeIndex}`)
      .then((r) => { if (!cancelled) setEvents(r.data.events || []); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || e.message || "Failed to load events"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeIndex]);

  // ---- Derived data ----
  const upcoming = useMemo(() => events.filter((e) => e.days_remaining >= 0), [events]);
  const next7 = useMemo(() => upcoming.filter((e) => e.days_remaining <= 7), [upcoming]);

  const summary = useMemo(() => {
    const results = upcoming.filter((e) => e.event_type === "Quarterly Results").length;
    const board = upcoming.filter((e) => e.event_type === "Board Meeting").length;
    const highest = [...upcoming]
      .filter((e) => e.weightage != null)
      .sort((a, b) => (b.weightage || 0) - (a.weightage || 0))[0] || null;
    const nextEvent = [...upcoming]
      .sort((a, b) => a.days_remaining - b.days_remaining)[0] || null;
    return {
      results,
      board,
      next7Count: next7.length,
      highest,
      nextEvent,
    };
  }, [upcoming, next7]);

  const timeline = useMemo(() => {
    const groups = {};
    upcoming.forEach((e) => {
      const k = e.event_date;
      if (!groups[k]) groups[k] = [];
      groups[k].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  const label = INDEX_LABEL[activeIndex] || activeIndex;

  return (
    <div
      data-testid="event-risk-widget"
      className="mt-1 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Upcoming Index Event Risk
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">
            {label}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {loading ? "Loading…" : err ? <span className="text-rose-500">{err}</span> : `${upcoming.length} upcoming`}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3 border-b border-slate-100 dark:border-slate-800">
        <SummaryCard icon={TrendingUp} label="Upcoming Results" value={summary.results} tint="rose" />
        <SummaryCard icon={Users} label="Board Meetings" value={summary.board} tint="indigo" />
        <SummaryCard icon={Clock} label="Next 7 Days" value={summary.next7Count} tint="amber" />
        <SummaryCard
          icon={Building2}
          label="Highest Weightage Upcoming Event company "
          value={
    summary.highest
      ? (
          activeIndex === "SENSEX"
            ? (summary.highest.constituents ||
               summary.highest.company_name ||
               summary.highest.symbol)
            : summary.highest.symbol
        )
      : "—"
  }
  sub={
    summary.highest
      ? `${summary.highest.weightage?.toFixed(2)}%`
      : ""
  }
          tint="red"
        />
        <SummaryCard
          icon={Calendar}
          label="Next Upcoming"
          value={
  summary.nextEvent
    ? (
        activeIndex === "SENSEX"
          ? (summary.nextEvent.constituents ||
             summary.nextEvent.company_name ||
             summary.nextEvent.symbol)
          : summary.nextEvent.symbol
      )
    : "—"
}
          sub={summary.nextEvent ? daysLeftText(summary.nextEvent.days_remaining) : ""}
          tint="emerald"
        />
      </div>

      {/* Upcoming 7-day risk */}
      {next7.length > 0 && (
        <div className="px-3 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
            Upcoming 7-Day Event Risk
          </div>
          <div className="flex gap-2 flex-wrap">
            {next7.slice(0, 12).map((e) => (
              <EventChip key={e.id} ev={e} compact />
            ))}
          </div>
        </div>
      )}

      {/* Full events tile grid */}
      <div className="p-3">
        {upcoming.length === 0 && !loading && !err && (
          <p className="text-xs text-slate-500 text-center py-4">
            No upcoming events for {label} constituents.
          </p>
        )}
        {upcoming.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
              All Upcoming Events (Sorted by Priority)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(showAll ? upcoming : upcoming.slice(0, 9)).map((e) => (
                <EventCard key={e.id} ev={e} />
              ))}
            </div>
            {upcoming.length > 9 && (
              <button
                data-testid="events-show-more"
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 flex items-center gap-1"
              >
                {showAll ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all ({upcoming.length})</>}
              </button>
            )}
          </>
        )}
      </div>

      {/* Monthly timeline */}
      {timeline.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-2">
          <button
            data-testid="events-timeline-toggle"
            onClick={() => setShowTimeline((v) => !v)}
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 flex items-center gap-1"
          >
            {showTimeline ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Monthly Timeline ({timeline.length} dates)
          </button>
          {showTimeline && (
            <div className="mt-2 space-y-2 max-h-64 overflow-auto pr-1">
              {timeline.map(([date, evs]) => (
                <div key={date}>
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                    {formatDate(date)} ({evs.length})
                  </div>
                  <ul className="pl-2 mt-1 space-y-0.5">
                    {evs.map((e) => (
                      <li key={e.id} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${BUCKET_STYLES[weightageBucket(e.weightage)].dot}`} />
                        <span className="font-medium">{e.symbol}</span>
                        <span className="text-slate-400">·</span>
                        <span>{e.event_type}</span>
                        {e.weightage != null && (
                          <span className="text-slate-400 ml-auto">{e.weightage.toFixed(2)}%</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tint = "slate" }) {
  const tintCls = {
    rose:    "text-rose-600 dark:text-rose-400",
    indigo:  "text-indigo-600 dark:text-indigo-400",
    amber:   "text-amber-600 dark:text-amber-400",
    red:     "text-red-700 dark:text-red-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  }[tint] || "text-slate-600 dark:text-slate-300";

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-md p-2 bg-slate-50 dark:bg-slate-800/50">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <Icon className={`w-3 h-3 ${tintCls}`} />
        {label}
      </div>
      <div className={`text-base font-semibold mt-0.5 ${tintCls}`}>{value ?? "—"}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function EventChip({ ev }) {
  const bucket = weightageBucket(ev.weightage);
  const s = BUCKET_STYLES[bucket];
  return (
    <div
      data-testid={`event-chip-${ev.symbol}`}
      className={`rounded-md border px-2 py-1 ${s.chip} shadow-sm`}
      title={`${ev.company_name} — ${ev.event_type} on ${formatDate(ev.event_date)}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-bold">{ev.symbol}</span>
        {ev.weightage != null ? (
          <span className="text-[10px] opacity-90">{ev.weightage.toFixed(2)}%</span>
        ) : (
          <span className="text-[10px] opacity-70">N/A</span>
        )}
      </div>
      <div className="text-[10px] leading-tight">
        {ev.event_type}
      </div>
      <div className="text-[10px] leading-tight opacity-90">
        {formatDate(ev.event_date)} · {daysLeftText(ev.days_remaining)}
      </div>
    </div>
  );
}

function EventCard({ ev }) {
  const bucket = weightageBucket(ev.weightage);
  const s = BUCKET_STYLES[bucket];
  return (
    <div
      data-testid={`event-card-${ev.symbol}`}
      className={`rounded-md border border-slate-200 dark:border-slate-700 p-2.5 shadow-sm ${s.card}`}
      title={ev.details || ev.purpose_raw}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{ev.company_name}</div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{ev.symbol}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xs font-bold ${s.badge}`}>
            {ev.weightage != null ? `${ev.weightage.toFixed(2)}%` : "N/A"}
          </div>
          <div className={`text-[9px] uppercase tracking-widest font-semibold ${s.badge}`}>
            {s.label}
          </div>
        </div>
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-700">
        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{ev.event_type}</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between mt-0.5">
          <span>{formatDate(ev.event_date)}</span>
          <span className={`font-semibold ${s.badge}`}>{daysLeftText(ev.days_remaining)}</span>
        </div>
      </div>
    </div>
  );
}