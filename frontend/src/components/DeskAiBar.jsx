import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { api, subscribeExtras } from "@/lib/api";
import { upcomingHolidays } from "@/lib/holidays";
import { eventDisplayName } from "@/lib/carryFocus";

export default function DeskAiBar({ activeIndex }) {
  const [guide, setGuide] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const extrasRef = useRef({});

  useEffect(() => subscribeExtras((d) => {
    extrasRef.current = d || {};
  }), []);

  const run = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const [st, fiiRes, evRes] = await Promise.all([
        api.get("/desk-guide").catch(() => ({ data: null })),
        api.get("/market/fii-dii").catch(() => ({ data: null })),
        activeIndex ? api.get(`/events/${activeIndex}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      ]);
      setMeta(st.data);
      const fii = fiiRes.data?.data;
      const holidays = upcomingHolidays().slice(0, 6).map((h) => ({ name: h.name, date: h.date }));
      const events = (evRes.data?.events || []).slice(0, 8);
      const gift = extrasRef.current?.gift_nifty?.change_pct;
      const vRaw = extrasRef.current?.vix;
      const vix = vRaw?.last ?? vRaw?.ltp ?? vRaw;
      const { data } = await api.post("/desk-guide", {
        surface: "desk",
        force: !!force,
        vix: vix != null ? Number(vix) : null,
        giftPct: gift != null ? Number(gift) : null,
        fii: {
          date: fii?.as_of_date,
          fiiNet: fii?.fii?.net,
          diiNet: fii?.dii?.net,
        },
        holidays,
        results: events.map((e) => ({
          name: eventDisplayName(e) || e.name,
          date: e.date,
          daysAway: e.daysAway,
          index: e.index || activeIndex,
        })),
      });
      setGuide(data);
    } catch {
      /* keep last */
    } finally {
      setBusy(false);
    }
  }, [activeIndex]);

  useEffect(() => {
    run(false);
    const id = setInterval(() => run(false), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [run]);

  const text = (guide?.guide || "").trim();
  const llm = guide?.source === "llm" || meta?.enabled;
  const source = guide?.source === "llm" ? "AI" : "rules";

  return (
    <section
      id="desk-ai-bar"
      data-testid="desk-ai-bar"
      className="shrink-0 mb-2 rounded-md border-2 border-violet-400 bg-gradient-to-r from-violet-50 via-white to-indigo-50 dark:from-violet-950/50 dark:via-slate-900 dark:to-indigo-950/40 dark:border-violet-700 px-3 py-2.5 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="w-5 h-5 text-violet-700 dark:text-violet-300 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold tracking-tight text-violet-950 dark:text-violet-100">
              Desk AI
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${
                llm && source === "AI"
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
              data-testid="desk-ai-source"
            >
              {source === "AI" ? "Live GPT" : meta?.enabled ? "GPT ready" : "Rules"}
            </span>
            {guide?.cached ? (
              <span className="text-[10px] uppercase tracking-widest text-slate-400">cached</span>
            ) : null}
            <button
              type="button"
              onClick={() => run(true)}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-sm border border-violet-300 bg-white text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60 dark:bg-slate-800 dark:text-violet-200 dark:border-violet-700"
              data-testid="desk-ai-refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
              Ask AI
            </button>
          </div>
          <p
            className="text-[13px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-medium"
            data-testid="desk-ai-guide"
          >
            {text || (busy ? "Reading the book, FII/DII, VIX, and the calendar…" : "Open Positions or wait one tick — the coach uses your book + session tape.")}
          </p>
        </div>
      </div>
    </section>
  );
}
