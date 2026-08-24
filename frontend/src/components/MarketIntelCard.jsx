import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { firstSentence, loadDeskAiTileOrder, nudgeDeskAiTile, parseGuideSections, reorderDeskAiTiles } from "@/lib/deskAiLayout";
import { filterCashHeavyMovers } from "@/lib/deskFocus";
import { fmtOiLakh } from "@/lib/deskAiTape";

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

function Tile({ id, title, hint, children, dragging, over, canUp, canDown, onMove, onDragStart, onDragOver, onDrop, onDragEnd }) {
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
  const news = outside?.news || [];
  const corp = outside?.corporate || [];
  const breadth = outside?.breadth && typeof outside.breadth === "object" ? outside.breadth : {};
  const sections = parseGuideSections(guide?.guide);
  const headline = summaryLine(outside, guide);
  const quoteHint = outside?.quote_source && outside.quote_source !== "none"
    ? `prices from ${outside.quote_source}`
    : "cash quotes wait on Kite — OI tape still live";

  const nodes = useMemo(() => {
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
      ) : empty("NIFTY + BANKNIFTY cash movers need a live Kite quote."),
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
              {n.title}
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
      ) : empty("No index-weight results in the next few days."),
      coach: (sections.do.length || sections.dont.length) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] leading-snug" data-testid="desk-ai-guide">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Do</div>
            <ul className="space-y-1">{sections.do.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-rose-700 mb-1">Don&apos;t</div>
            <ul className="space-y-1">{sections.dont.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        </div>
      ) : empty("Ask AI or wait one poll — coach uses OI, book, VIX, and journal."),
    };
  }, [movers, news, corp, breadth, compact, oi, book, adjust, journal, sections.do, sections.dont]);

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

  const labels = { tape: "OI tape", book: "Your book", movers: "Heavyweights", breadth: "Index breadth", news: "News", watch: "Coming up", coach: "What to do" };
  const hints = { tape: "session writers", book: "greeks + journal", movers: "NIFTY + BNF cash", breadth: "vs the index print", news: "wires", watch: "results / board", coach: "do vs don't" };

  return (
    <div className="space-y-2" data-testid="market-intel-card">
      <p className="text-[13px] font-semibold leading-snug text-slate-900 dark:text-slate-100" data-testid="intel-summary">
        {headline}
      </p>
      <p className="text-[10px] text-slate-500">
        Drag or arrows to reorder · {quoteHint}
      </p>
      <div className={compact ? "grid grid-cols-1 gap-1.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
        {visible.map((id, i) => (
          <Tile
            key={id}
            id={id}
            title={labels[id]}
            hint={hints[id]}
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
