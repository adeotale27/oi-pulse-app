import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { api, fetchOIChange, subscribeExtras } from "@/lib/api";
import { upcomingHolidays } from "@/lib/holidays";
import { eventDisplayName } from "@/lib/carryFocus";
import { compactBookFromPositions, fmtOiLakh, summarizeIndexTape } from "@/lib/deskAiTape";

const INDEXES = ["NIFTY", "SENSEX", "BANKNIFTY"];

export default function DeskAiBar({
  activeIndex,
  current,
  previous,
  enabledIndices,
  visible = true,
}) {
  const [guide, setGuide] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const extrasRef = useRef({});
  const [extrasTick, setExtrasTick] = useState(0);
  const currentRef = useRef(current);
  const previousRef = useRef(previous);
  currentRef.current = current;
  previousRef.current = previous;

  useEffect(() => subscribeExtras((d) => {
    extrasRef.current = d || {};
    setExtrasTick((n) => n + 1);
  }), []);

  const liveTape = useMemo(
    () => summarizeIndexTape(current, previous),
    [current, previous],
  );

  const run = useCallback(async (force = false) => {
    if (!visible) return;
    setBusy(true);
    try {
      const snapCurrent = currentRef.current;
      const snapPrevious = previousRef.current;
      const idxs = (enabledIndices?.length ? enabledIndices : INDEXES).filter((i) => INDEXES.includes(i));
      const [st, fiiRes, evRes, posRes, ...oiPack] = await Promise.all([
        api.get("/desk-guide").catch(() => ({ data: null })),
        api.get("/market/fii-dii").catch(() => ({ data: null })),
        activeIndex ? api.get(`/events/${activeIndex}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        api.get("/positions").catch(() => ({ data: null })),
        ...idxs.map((idx) => fetchOIChange(idx, 15).catch(() => null)),
      ]);
      setMeta(st.data);
      const fii = fiiRes.data?.data;
      const holidays = upcomingHolidays().slice(0, 6).map((h) => ({ name: h.name, date: h.date }));
      const events = (evRes.data?.events || []).slice(0, 8);
      const gift = extrasRef.current?.gift_nifty?.change_pct;
      const vRaw = extrasRef.current?.vix;
      const vix = vRaw?.last ?? vRaw?.ltp ?? vRaw;
      const oi = idxs.map((idx, i) => {
        if (idx === activeIndex && snapCurrent) return summarizeIndexTape(snapCurrent, snapPrevious);
        const pack = oiPack[i];
        return summarizeIndexTape(pack?.current, pack?.previous);
      }).filter(Boolean);
      const packed = compactBookFromPositions(posRes.data);
      const { data } = await api.post("/desk-guide", {
        surface: "desk",
        force: !!force,
        vix: vix != null ? Number(vix) : null,
        giftPct: gift != null ? Number(gift) : null,
        weekday: new Date().getDay(),
        fii: {
          date: fii?.as_of_date,
          fiiNet: fii?.fii?.net,
          diiNet: fii?.dii?.net,
        },
        holidays,
        results: events.map((e) => ({
          name: eventDisplayName(e) || e.name,
          date: e.date,
          daysAway: e.days_remaining ?? e.daysAway,
          index: e.index || activeIndex,
        })),
        oi,
        book: packed.book,
        adjust: packed.adjust,
      });
      setGuide(data);
    } catch {
      /* keep last */
    } finally {
      setBusy(false);
    }
  }, [activeIndex, enabledIndices, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    run(false);
    const id = setInterval(() => run(false), 30 * 1000);
    return () => clearInterval(id);
  }, [run, visible]);

  useEffect(() => {
    if (!visible || !current?.timestamp) return undefined;
    const t = setTimeout(() => run(false), 1500);
    return () => clearTimeout(t);
  }, [current?.timestamp, visible, run]);

  if (!visible) return null;

  const text = (guide?.guide || "").trim();
  const source = guide?.source === "llm" ? "AI" : "rules";
  const llmLive = source === "AI";
  const gift = extrasRef.current?.gift_nifty?.change_pct;
  const vRaw = extrasRef.current?.vix;
  const vixNow = vRaw?.last ?? vRaw?.ltp ?? vRaw;

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
                llmLive
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
              data-testid="desk-ai-source"
            >
              {llmLive ? "Live GPT" : meta?.enabled ? "Rules · GPT retry" : "Rules"}
            </span>
            {guide?.cached && llmLive ? (
              <span className="text-[10px] uppercase tracking-widest text-slate-400">GPT cached</span>
            ) : null}
            {guide?.llm_error ? (
              <span className="text-[10px] text-amber-700" title={guide.llm_error}>GPT miss</span>
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
          <div
            className="flex flex-wrap gap-1.5 mb-1.5 font-mono-data text-[11px] text-slate-700 dark:text-slate-200"
            data-testid="desk-ai-tape"
          >
            {liveTape ? (
              <span className="rounded-sm border border-violet-200 bg-white/80 px-1.5 py-0.5">
                {liveTape.idx} {liveTape.px ?? "—"} ATM {liveTape.atm ?? "—"} PCR {liveTape.pcr ?? "—"} CE {fmtOiLakh(liveTape.ceChg)} PE {fmtOiLakh(liveTape.peChg)}
              </span>
            ) : (
              <span className="text-slate-400">Waiting for OI tick…</span>
            )}
            {vixNow != null && Number.isFinite(Number(vixNow)) ? (
              <span className="rounded-sm border border-slate-200 bg-white/80 px-1.5 py-0.5">VIX {Number(vixNow).toFixed(2)}</span>
            ) : null}
            {gift != null && Number.isFinite(Number(gift)) ? (
              <span className="rounded-sm border border-slate-200 bg-white/80 px-1.5 py-0.5">GIFT {Number(gift) >= 0 ? "+" : ""}{Number(gift).toFixed(2)}%</span>
            ) : null}
            <span className="sr-only">{extrasTick}</span>
          </div>
          <p
            className="text-[13px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-medium"
            data-testid="desk-ai-guide"
          >
            {text || (busy ? "Reading live OI, book, VIX, GIFT, FII/DII, and the calendar…" : "Waiting for the next OI tick.")}
          </p>
        </div>
      </div>
    </section>
  );
}
