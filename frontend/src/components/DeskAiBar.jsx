import { useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { upcomingHolidays } from "@/lib/holidays";
import { eventDisplayName } from "@/lib/carryFocus";
import { compactBookFromPositions } from "@/lib/deskAiTape";
import MarketIntelCard from "@/components/MarketIntelCard";

export default function DeskAiBar({
  activeIndex,
  visible = true,
  askAi = true,
}) {
  const [guide, setGuide] = useState(null);
  const [meta, setMeta] = useState(null);
  const [outside, setOutside] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (force = false) => {
    if (!visible) return;
    setBusy(true);
    try {
      const [st, outRes, evRes, posRes] = await Promise.all([
        api.get("/desk-guide").catch(() => ({ data: null })),
        api.get("/desk-outside").catch(() => ({ data: null })),
        activeIndex ? api.get(`/events/${activeIndex}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        api.get("/positions").catch(() => ({ data: null })),
      ]);
      setMeta(st.data);
      setOutside(outRes.data || null);
      const holidays = upcomingHolidays().slice(0, 6).map((h) => ({ name: h.name, date: h.date }));
      const events = (evRes.data?.events || []).slice(0, 8);
      const packed = compactBookFromPositions(posRes.data);
      const { data } = await api.post("/desk-guide", {
        surface: "desk",
        force: !!force,
        skip_llm: !askAi || !force,
        holidays,
        results: events.map((e) => ({
          name: eventDisplayName(e) || e.name,
          date: e.date,
          daysAway: e.days_remaining ?? e.daysAway,
          index: e.index || activeIndex,
        })),
        book: packed.book,
        adjust: packed.adjust,
      });
      setGuide(data);
    } catch {
      /* keep last */
    } finally {
      setBusy(false);
    }
  }, [activeIndex, visible, askAi]);

  useEffect(() => {
    if (!visible) return undefined;
    run(false);
    const id = setInterval(() => run(false), 45 * 1000);
    return () => clearInterval(id);
  }, [run, visible]);

  if (!visible) return null;

  const source = guide?.source === "llm" ? "AI" : "rules";
  const llmLive = source === "AI";

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
            <span className="text-[10px] uppercase tracking-widest text-violet-700/80">
              outside the OI chart
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${
                llmLive
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
              data-testid="desk-ai-source"
            >
              {llmLive ? "Live GPT" : meta?.enabled ? "Rules · GPT retry" : "Rules"}
            </span>
            {guide?.llm_error ? (
              <span className="text-[10px] text-amber-700" title={guide.llm_error}>GPT miss</span>
            ) : null}
            {askAi ? (
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
            ) : (
              <span className="ml-auto text-[10px] text-slate-500">Ask AI off</span>
            )}
          </div>
          <MarketIntelCard outside={outside} guide={guide} />
        </div>
      </div>
    </section>
  );
}
