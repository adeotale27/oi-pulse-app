import { useMemo, useState } from "react";

const PRI_TONE = {
  CRITICAL: "border-rose-400 bg-rose-50 text-rose-950",
  HIGH: "border-orange-300 bg-orange-50 text-orange-950",
  MEDIUM: "border-amber-300 bg-amber-50 text-amber-950",
  LOW: "border-sky-200 bg-sky-50 text-sky-950",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "NIFTY", label: "NIFTY" },
  { id: "BANKNIFTY", label: "BANKNIFTY" },
  { id: "SENSEX", label: "SENSEX" },
  { id: "constituent", label: "Stocks" },
  { id: "news", label: "News" },
  { id: "breakout", label: "Breakouts" },
  { id: "corporate", label: "Events" },
  { id: "global", label: "Global" },
  { id: "risk", label: "Risk" },
];

function matchFilter(ev, filter) {
  if (!filter || filter === "all") return true;
  const kind = String(ev.kind || "");
  const idx = String(ev.index || "");
  if (filter === "NIFTY" || filter === "BANKNIFTY" || filter === "SENSEX") {
    return idx === filter || String(ev.symbol || "") === filter;
  }
  if (filter === "risk") {
    return ["HIGH", "CRITICAL"].includes(String(ev.priority || "").toUpperCase())
      || kind === "corporate" || kind === "global";
  }
  if (filter === "constituent") return kind === "constituent" || kind === "sector" || kind === "breadth";
  return kind === filter;
}

export default function MarketIntelCard({
  outside,
  guide,
  compact = false,
  title = "Market intelligence",
}) {
  const [filter, setFilter] = useState("all");
  const events = useMemo(() => {
    const list = Array.isArray(outside?.events) ? outside.events : [];
    return list.filter((e) => matchFilter(e, filter));
  }, [outside, filter]);
  const movers = outside?.movers || [];
  const news = outside?.news || [];
  const briefing = outside?.briefing || "";
  const text = (guide?.guide || "").trim();

  return (
    <div className={compact ? "space-y-2" : "space-y-2.5"} data-testid="market-intel-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest font-bold text-violet-800 dark:text-violet-200">
          {title}
        </span>
        {outside?.quote_source ? (
          <span className="text-[10px] text-slate-500">quotes {outside.quote_source}</span>
        ) : null}
      </div>

      {movers.length ? (
        <div className="flex flex-wrap gap-1.5" data-testid="desk-ai-movers">
          {movers.slice(0, compact ? 4 : 8).map((m) => {
            const up = Number(m.pct) >= 0;
            return (
              <span
                key={`${m.index}-${m.symbol}`}
                className={`rounded-sm border px-1.5 py-0.5 font-mono-data text-[11px] ${
                  up ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"
                }`}
                title={m.note || m.why || ""}
              >
                {m.symbol} {up ? "+" : ""}{Number(m.pct || 0).toFixed(1)}%
                {m.weightage != null ? ` · ${Number(m.weightage).toFixed(1)}%wt` : ""}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">{outside?.note || "No heavyweight cash move vs overnight"}</p>
      )}

      {!compact ? (
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`h-6 px-1.5 rounded-sm text-[10px] font-semibold border ${
                filter === f.id
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`intel-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {events.length ? (
        <ul className="space-y-1.5 max-h-[22rem] overflow-y-auto" data-testid="intel-events">
          {events.slice(0, compact ? 5 : 12).map((e) => {
            const pri = String(e.priority || "MEDIUM").toUpperCase();
            return (
              <li
                key={e.id || e.event}
                className={`rounded-md border px-2 py-1.5 ${PRI_TONE[pri] || PRI_TONE.MEDIUM}`}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                  <span>{pri}</span>
                  <span className="font-medium normal-case tracking-normal opacity-80">
                    {e.symbol || e.index || e.kind}
                  </span>
                </div>
                <div className="text-[12px] font-semibold leading-snug">{e.event}</div>
                {e.why ? <div className="text-[11px] leading-snug opacity-90">{e.why}</div> : null}
                {!compact && (e.buyer || e.seller) ? (
                  <div className="mt-1 grid gap-0.5 text-[11px]">
                    {e.buyer ? <div><b>Buyer:</b> {e.buyer}</div> : null}
                    {e.seller ? <div><b>Seller:</b> {e.seller}</div> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!events.length && news.length ? (
        <ul className="space-y-0.5 text-[12px] text-slate-800 dark:text-slate-100" data-testid="desk-ai-news">
          {news.slice(0, compact ? 2 : 3).map((n) => (
            <li key={n.title} className="truncate">• {n.title}</li>
          ))}
        </ul>
      ) : null}

      {text || briefing ? (
        <p
          className="text-[13px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-medium"
          data-testid="desk-ai-guide"
        >
          {text || briefing}
        </p>
      ) : null}
    </div>
  );
}
