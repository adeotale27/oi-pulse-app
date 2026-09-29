import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { buildSessionBrief, findEvidenceConflicts, firstSentence, formatEvidenceAsOf, formatSessionDate, loadDeskAiTileOrder, nudgeDeskAiTile, parseGuideSections, reorderDeskAiTiles } from "@/lib/deskAiLayout";
import { filterCashHeavyMovers } from "@/lib/deskFocus";
import { fmtOiLakh } from "@/lib/deskAiTape";

const SCENARIO_LABELS = {
  baseCase: "Base case",
  contraryCase: "Contrary case",
  gapUp: "Gap up",
  gapDown: "Gap down",
  reassessIf: "Reassess if",
  watchNext: "Watch next",
};

function pctLabel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function summaryLine(outside, guide) {
  const fromGuide = firstSentence(guide?.guide, 180);
  if (fromGuide && !/^session focus/i.test(fromGuide)) return fromGuide;
  const brief = firstSentence(outside?.briefing, 160);
  if (brief && !/^session focus/i.test(brief)) return brief;
  const movers = filterCashHeavyMovers(outside?.movers || []);
  if (movers[0] && movers[0].pct != null) {
    const m = movers[0];
    const w = m.weightage != null ? ` (${Number(m.weightage).toFixed(1)}% of ${m.index || "the index"})` : "";
    return `${m.symbol} is ${pctLabel(m.pct)}${w} — cash, not option OI.`;
  }
  return outside?.note || "Desk AI is on the live OI tape, your book, and the cash wires.";
}

function Tile({ id, title, hint, children, dragging, over, canUp, canDown, onMove, onDragStart, onDragOver, onDrop, onDragEnd, wide }) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        if (e.target instanceof Element && e.target.closest("button")) {
          e.preventDefault();
          return;
        }
        onDragStart(e, id);
      }}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={(e) => onDrop(e, id)}
      onDragEnd={onDragEnd}
      data-testid={`intel-tile-${id}`}
      className={`rounded-md border bg-white/90 dark:bg-slate-900/70 px-2.5 py-2 min-w-0 ${
        wide ? "sm:col-span-2" : ""
      } ${
        over ? "border-emerald-500 ring-1 ring-emerald-300" : "border-slate-200 dark:border-slate-700"
      } ${dragging ? "opacity-60" : ""}`}
      title="Drag or use arrows to reorder"
    >
      <div className="flex items-center gap-1 mb-1">
        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h3>
        {hint ? <span className="ml-auto text-[10px] text-slate-400">{hint}</span> : null}
        <div className="flex items-center shrink-0 ml-1">
          <button
            type="button"
            data-testid={`intel-tile-up-${id}`}
            aria-label={`Move ${title} up`}
            disabled={!canUp}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMove?.(id, -1);
            }}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid={`intel-tile-down-${id}`}
            aria-label={`Move ${title} down`}
            disabled={!canDown}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMove?.(id, 1);
            }}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {children}
    </article>
  );
}

export default function MarketIntelCard({
  outside,
  market,
  extras,
  guide,
  compact = false,
  layoutKey,
  oi = [],
  book = null,
  adjust = null,
  journal = null,
}) {
  const [order, setOrder] = useState(() => loadDeskAiTileOrder(layoutKey));
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClick = useRef(false);

  const movers = filterCashHeavyMovers(outside?.movers || []);
  const sections = parseGuideSections(guide?.guide);
  const scenarios = Object.entries(sections.scenarios || {})
    .filter(([, lines]) => lines.length);
  const headline = summaryLine(outside, guide);
  const sessionBrief = buildSessionBrief({ market, extras, outside, oi, journal });
  const evidenceConflicts = findEvidenceConflicts({ extras, outside });
  const quoteHint = outside?.quote_source && outside.quote_source !== "none"
    ? `prices from ${outside.quote_source}`
    : "cash quotes wait on Kite — OI tape still live";

  const nodes = useMemo(() => {
    const news = outside?.news || [];
    const corp = outside?.corporate || [];
    const breadth = outside?.breadth && typeof outside.breadth === "object" ? outside.breadth : {};
    const breadthRows = Object.entries(breadth).filter(
      ([id, b]) => b && (b.n || b.adv != null) && (id === "NIFTY" || id === "BANKNIFTY"),
    );
    const empty = (msg) => (
      <p className="text-[12px] leading-snug text-slate-500">{msg}</p>
    );
    return {
      tape: (oi || []).length ? (
        <ul className="space-y-1">
          {oi.slice(0, 3).map((row) => {
            const ce = Number(row.ceChg) || 0;
            const pe = Number(row.peChg) || 0;
            const writer = pe >= ce ? "Put writers" : "Call writers";
            return (
              <li key={row.idx} className="text-[12px] leading-snug text-slate-800">
                <b>{row.idx}</b> {writer}
                {row.pcr != null ? ` · PCR ${Number(row.pcr).toFixed(2)}` : ""}
                {` · CE ${fmtOiLakh(ce)} PE ${fmtOiLakh(pe)}`}
                {row.callWall || row.putWall ? ` · walls ${row.callWall || "—"}/${row.putWall || "—"}` : ""}
                {row.dataStatus || row.asOf ? (
                  <span className="block text-[10px] text-slate-500">
                    {row.dataStatus ? `${row.dataStatus} · ` : ""}
                    {row.asOf ? `${formatEvidenceAsOf(row.asOf)} snapshot` : "timestamp unavailable"}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : empty("Waiting for session OI on NIFTY / SENSEX / BANKNIFTY."),
      book: (book?.shortCount || journal) ? (
        <div className="text-[12px] leading-snug text-slate-800 space-y-1">
          {book?.shortCount ? (
            <p>
              <b>{book.shortCount} shorts</b>
              {Object.entries(book.byIndex || {}).slice(0, 3).map(([idx, bag]) => (
                <span key={idx}> · {idx} {bag.ce || 0} CE / {bag.pe || 0} PE</span>
              ))}
            </p>
          ) : null}
          {adjust && (adjust.netDelta != null || adjust.avgIv != null) ? (
            <p className="font-mono-data text-slate-600">
              {adjust.netDelta != null ? `Δ ${Number(adjust.netDelta).toFixed(0)}` : ""}
              {adjust.netTheta != null ? ` · Θ ${Number(adjust.netTheta).toFixed(0)}` : ""}
              {adjust.avgIv != null ? ` · IV ${Number(adjust.avgIv).toFixed(0)}%` : ""}
            </p>
          ) : null}
          {journal?.day_booked_pct != null ? (
            <p className={Number(journal.day_booked_pct) <= -5 ? "text-rose-800 font-semibold" : "text-slate-700"}>
              Today booked {Number(journal.day_booked_pct) >= 0 ? "+" : ""}{Number(journal.day_booked_pct).toFixed(2)}% of wallet
            </p>
          ) : null}
          {journal?.win_rate != null ? (
            <p>
              Journal {journal.trading_days || "—"}d · win {Number(journal.win_rate).toFixed(0)}%
              {journal.booked_pnl != null ? ` · booked ${Number(journal.booked_pnl) >= 0 ? "+" : ""}${Math.round(journal.booked_pnl)}` : ""}
            </p>
          ) : null}
        </div>
      ) : empty("Connect the book (Positions) to score shorts vs this tape."),
      movers: movers.length ? (
        <ul className="space-y-1">
          {movers.slice(0, compact ? 4 : 6).map((m) => {
            const up = Number(m.pct) >= 0;
            return (
              <li key={`${m.index}-${m.symbol}`} className="text-[12px] leading-snug">
                <span className={`font-mono-data font-semibold ${up ? "text-emerald-800" : "text-rose-800"}`}>
                  {m.symbol} {pctLabel(m.pct)}
                </span>
                <span className="text-slate-600">
                  {m.weightage != null ? ` · ${Number(m.weightage).toFixed(1)}% of ${m.index || "index"}` : ""}
                  {up ? " — lifting the index" : " — dragging the index"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : empty(
        outside?.briefing
        || outside?.note
        || (Number(outside?.heavy_count) > 0
          ? "Constituents are on file — waiting for live cash quotes (Kite)."
          : "Upload Nifty 50 / Bank Nifty constituents in Admin → Upload, then wait for a live quote."),
      ),
      breadth: breadthRows.length ? (
        <ul className="space-y-1">
          {breadthRows.map(([idx, b]) => (
            <li key={idx} className="text-[12px] leading-snug text-slate-800 dark:text-slate-100">
              <b>{idx}</b> {b.adv}/{b.n} advancing
              {b.above_vwap != null ? ` · ${b.above_vwap} above VWAP` : ""}
            </li>
          ))}
        </ul>
      ) : empty("Breadth fills when constituent quotes are live."),
      news: news.length ? (
        <ul className="space-y-1">
          {news.slice(0, compact ? 2 : 4).map((n) => (
            <li key={n.title} className="text-[12px] leading-snug text-slate-800 dark:text-slate-100">
              <span>{n.title}</span>
              <span className="block text-[10px] text-slate-500">
                {n.source || "News feed"} · {n.published ? `published ${formatEvidenceAsOf(n.published)}` : "publish time unavailable"}
              </span>
            </li>
          ))}
        </ul>
      ) : empty("No wires in this poll."),
      watch: corp.length ? (
        <ul className="space-y-1">
          {corp.slice(0, compact ? 3 : 5).map((c) => (
            <li key={`${c.symbol}-${c.days}`} className="text-[12px] leading-snug text-slate-800">
              <b>{c.symbol}</b> {c.event_type || "event"} in {c.days}d
              {c.weightage ? ` · ${Number(c.weightage).toFixed(1)}% wt` : ""}
            </li>
          ))}
        </ul>
      ) : empty("No tracked major index-company results or board meetings are listed for the next 7 days."),
      coach: (sections.do.length || sections.dont.length || scenarios.length) ? (
        <div className="space-y-2 text-[12px] leading-snug" data-testid="desk-ai-guide">
          {sections.do[0] && /^Capital/i.test(sections.do[0]) ? (
            <p className="rounded-sm border border-rose-200 bg-rose-50 px-2 py-1.5 font-semibold text-rose-950" data-testid="desk-ai-capital">
              {sections.do[0]}
            </p>
          ) : null}
          {scenarios.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
              {scenarios.map(([key, lines]) => (
                <div key={key}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                    {SCENARIO_LABELS[key]}
                  </div>
                  <ul className="space-y-1">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
                </div>
              ))}
            </div>
          ) : null}
          {sections.do.length || sections.dont.length ? (
            <div className="grid grid-cols-1 gap-2">
              {sections.do.length ? (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Do</div>
                  <ol className="space-y-1.5 list-decimal pl-4">
                    {sections.do
                      .filter((s, i) => !(i === 0 && /^Capital/i.test(s)))
                      .map((s, i) => <li key={`do-${i}`}>{s}</li>)}
                  </ol>
                  {!sections.do.filter((s, i) => !(i === 0 && /^Capital/i.test(s))).length ? (
                    <p className="text-slate-500">Only the capital line above — no extra adds.</p>
                  ) : null}
                </div>
              ) : null}
              {sections.dont.length ? (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-rose-700 mb-1">Don&apos;t</div>
                  <ul className="space-y-1.5 list-disc pl-4">
                    {sections.dont.map((s, i) => <li key={`dont-${i}`}>{s}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : empty("Ask AI or wait one poll — coach uses OI, book, VIX, journal, and today's booked %."),
    };
  }, [movers, compact, oi, book, adjust, journal, sections.do, sections.dont, scenarios,
    outside?.briefing, outside?.heavy_count, outside?.note, outside?.news,
    outside?.corporate, outside?.breadth]);

  const visible = order.filter((id) => nodes[id] != null);

  const onDragStart = (e, id) => {
    skipClick.current = false;
    setDraggingId(id);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch { /* noop */ }
  };
  const onDragOver = (e, id) => {
    if (!draggingId) return;
    e.preventDefault();
    if (overId !== id) setOverId(id);
  };
  const onDrop = (e, dropId) => {
    e.preventDefault();
    let from = draggingId;
    try { from = e.dataTransfer.getData("text/plain") || from; } catch { /* noop */ }
    setDraggingId(null);
    setOverId(null);
    if (from && dropId && from !== dropId) {
      skipClick.current = true;
      setOrder((prev) => reorderDeskAiTiles(prev, from, dropId, layoutKey));
    }
  };

  const labels = { tape: "OI tape", book: "Your book", movers: "Heavyweights", breadth: "Index breadth", news: "News", watch: "Company events", coach: "What to do" };
  const hints = { tape: "session writers", book: "greeks + journal", movers: "NIFTY + BNF cash", breadth: "vs the index print", news: "wires", watch: "earnings / board", coach: "conditional guidance" };
  const evidence = guide?.evidence_quality;
  const evidenceNames = ["Session OI", "GIFT quote", "India VIX", "Outside tape"];
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  const sourceNames = new Set(sources.map((source) => source.name));
  const missingSources = evidence
    ? evidenceNames.filter((name) => !sourceNames.has(name))
    : [];
  const inferenceLabel = guide?.source === "llm"
    ? "AI inference"
    : guide
      ? "Rule-based read"
      : "Current market context";

  return (
    <div className="space-y-2" data-testid="market-intel-card">
      <section className="rounded-md border border-violet-200 bg-violet-50/70 px-2.5 py-2 dark:border-violet-900 dark:bg-violet-950/30" data-testid="desk-ai-inference">
        <div className="text-[10px] font-bold uppercase tracking-widest text-violet-800 dark:text-violet-200">{inferenceLabel}</div>
        <p className="mt-0.5 text-[13px] font-semibold leading-snug text-slate-900 dark:text-slate-100" data-testid="intel-summary">
          {headline}
        </p>
      </section>
      <p className="text-[10px] text-slate-500">
        Drag or arrows to reorder · {quoteHint}
      </p>
      {sessionBrief ? (
        <section className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-3 dark:border-sky-800 dark:bg-sky-950/50 sm:px-4" data-testid="desk-ai-session-brief">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold tracking-wide text-sky-950 dark:text-sky-100">{sessionBrief.title}</h3>
            {sessionBrief.sessionDate ? (
              <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-sky-700 dark:bg-slate-900 dark:text-slate-200">
                Session: {formatSessionDate(sessionBrief.sessionDate)}
              </span>
            ) : null}
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sessionBrief.items.map((item) => (
              <li key={item.id} data-testid={`desk-ai-brief-item-${item.id}`} className="min-w-0 rounded-md border border-sky-200 bg-white px-3 py-2.5 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</h4>
                  {item.status ? (
                    <span data-testid={`desk-ai-brief-status-${item.id}`} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      /stale|delayed|unavailable|missing|error/i.test(item.status)
                        ? "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200"
                        : /live|fresh/i.test(item.status)
                          ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}>
                      {item.status}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 break-words text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                  {item.text}
                </p>
                {(item.source || item.asOf) ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">Source:</span> {item.source || "Not identified"}
                    {item.asOf ? (
                      <span className="block">
                        <span className="font-semibold">{item.timeKind || "Updated"}:</span> {formatEvidenceAsOf(item.asOf)}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {sessionBrief.outsideAsOf ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Cash data:</span> {sessionBrief.outsideSource || "Source unavailable"} · refreshed {formatEvidenceAsOf(sessionBrief.outsideAsOf)}
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500" data-testid="desk-ai-observed-data">
        Observed data
      </div>
      {evidence ? (
        <details className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[10px] dark:border-slate-700 dark:bg-slate-900/50" data-testid="desk-ai-evidence-quality">
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
            Evidence &amp; limits · {evidence.covered}/{evidence.total} timestamps
            {missingSources.length ? ` · ${missingSources.length} missing` : ""}
            {evidenceConflicts.length ? ` · ${evidenceConflicts.length} mixed` : ""}
          </summary>
          <p className="mt-1 text-slate-500">Coverage is input availability, not forecast confidence.</p>
          <ul className="mt-1 space-y-1">
            {sources.map((source) => (
              <li key={source.name} className="text-slate-600 dark:text-slate-300">
                <b>{source.name}</b>
                {source.source ? ` · ${source.source}` : ""}
                {source.asOf ? ` · ${source.timeKind === "fetched" ? "fetched " : "as of "}${formatEvidenceAsOf(source.asOf)}` : " · time unavailable"}
                {source.ageMinutes != null ? ` · ${source.ageMinutes}m old` : ""}
                {source.status ? ` · ${source.status}` : ""}
              </li>
            ))}
          </ul>
          {missingSources.length ? (
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              No timestamped input supplied: {missingSources.join(", ")}.
            </p>
          ) : null}
          {evidenceConflicts.length ? (
            <ul className="mt-1 space-y-1 text-amber-800 dark:text-amber-200" aria-label="Mixed evidence">
              {evidenceConflicts.map((conflict) => (
                <li key={conflict.id}>
                  <b>{conflict.text}</b>
                  <span className="block text-slate-500">{conflict.sources.join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
      <div className={compact ? "grid grid-cols-1 gap-1.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
        {visible.map((id, i) => (
          <Tile
            key={id}
            id={id}
            title={labels[id]}
            hint={hints[id]}
            wide={id === "coach" && !compact}
            dragging={draggingId === id}
            over={overId === id}
            canUp={i > 0}
            canDown={i < visible.length - 1}
            onMove={(tileId, delta) => setOrder((prev) => nudgeDeskAiTile(prev, tileId, delta, layoutKey))}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={() => { setDraggingId(null); setOverId(null); }}
          >
            {nodes[id]}
          </Tile>
        ))}
      </div>
    </div>
  );
}
