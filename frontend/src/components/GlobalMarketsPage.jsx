import { useEffect, useMemo, useState } from "react";
import { Clock, GripVertical, Settings2 } from "lucide-react";
import PageBrandTitle from "@/components/PageBrandTitle";
import AdrPage from "@/components/AdrPage";
import { fetchGlobalMarkets } from "@/lib/globalMarketsSnapshot";

const TIMELINE_KEY = "SESSION TIMELINE";
const CATEGORY_ORDER = ["GLOBAL INDICES", "FX / FOREX", "COMMODITIES", "CRYPTO", "ADR MONITOR", "MACRO"];
const fmt = (value, precision = 2) => value == null ? "—" : Number(value).toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
const tone = (value) => Number(value) > 0 ? "text-emerald-600" : Number(value) < 0 ? "text-rose-600" : "text-slate-500";
function localTime(timezone, tick) { void tick; try { return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); } catch { return "—"; } }
function marketIsLive(item, status) {
  if (status === "24/7" || status === "LIVE") return true;
  if (status === "CLOSED" || status === "UNAVAILABLE") return false;
  return item.isMarketOpen === true || item.marketOpen === true;
}

function SessionTimeline({ items, tick }) {
  const sessions = useMemo(() => items.map((item) => {
    const status = item.marketStatus || (item.available ? "UNKNOWN" : "PENDING");
    const live = marketIsLive(item, status);
    const move = Number(item.changePercent);
    const intensity = Number.isFinite(move) ? Math.min(1, Math.abs(move) / 3) : 0;
    return {
      ...item,
      live,
      status,
      clock: localTime(item.timezone, tick),
      intensity,
      tone: move > 0 ? "bg-emerald-500" : move < 0 ? "bg-rose-500" : "bg-slate-300",
    };
  }), [items, tick]);

  if (!sessions.length) return null;
  return (
    <section className="oi-card rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900" data-testid="global-market-session-timeline">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300">Session timeline</h2>
          <p className="text-[10px] text-slate-400">Local clocks and move intensity · presentation only</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500" aria-label="Session timeline legend">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Live</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />Closed</span>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map((item) => (
          <div key={item.id} className="rounded-sm border border-slate-100 px-2 py-1.5 dark:border-slate-800" data-testid={`session-timeline-${item.id}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-semibold">{item.symbol}</span>
              <span className={`shrink-0 text-[10px] font-mono-data ${item.live ? "text-emerald-600" : "text-slate-500"}`}>
                {item.live ? "LIVE" : "CLOSED"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="meter" aria-label={`${item.symbol} move intensity`} aria-valuemin="0" aria-valuemax="1" aria-valuenow={item.intensity.toFixed(2)}>
                <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${Math.max(6, item.intensity * 100)}%`, opacity: item.intensity ? 0.45 + item.intensity * 0.55 : 0.45 }} />
              </div>
              <span className="w-10 text-right text-[10px] font-mono-data text-slate-500">{item.clock}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GlobalMarketTable({ items, tick }) {
  return <div className="oi-card overflow-x-auto rounded-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"><table className="w-full min-w-[52rem] text-[11px]"><thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500 dark:bg-slate-800"><tr><th className="px-2 py-1.5 text-left whitespace-nowrap">Instrument</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Last</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Change</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Chg. %</th><th className="px-2 py-1.5 text-right whitespace-nowrap">High</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Low</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Volume</th><th className="px-2 py-1.5 text-left whitespace-nowrap">Market Status</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Last Updated</th><th className="w-8 px-1.5 py-1.5" aria-hidden /></tr></thead><tbody>{items.map((item) => { const unavailable = !item.available && item.stale; const status = unavailable ? "UNAVAILABLE" : item.marketStatus || (item.available ? "UNKNOWN" : "PENDING"); const live = marketIsLive(item, status); return <tr key={item.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/70" data-testid={`global-market-row-${item.id}`}><td className="px-2 py-1.5 whitespace-nowrap"><b className="tracking-wide">{item.symbol}</b><div className="text-[10px] text-slate-500">{item.displayName}</div></td><td className="px-2 py-1.5 text-right whitespace-nowrap font-mono-data">{fmt(item.price, item.precision)}</td><td className={`px-2 py-1.5 text-right whitespace-nowrap font-mono-data ${tone(item.change)}`}>{item.change == null ? "—" : `${Number(item.change) >= 0 ? "+" : ""}${fmt(item.change, item.precision)}`}</td><td className={`px-2 py-1.5 text-right whitespace-nowrap font-mono-data ${tone(item.changePercent)}`}>{item.changePercent == null ? "—" : `${Number(item.changePercent) >= 0 ? "+" : ""}${Number(item.changePercent).toFixed(2)}%`}</td><td className="px-2 py-1.5 text-right whitespace-nowrap font-mono-data">{fmt(item.high, item.precision)}</td><td className="px-2 py-1.5 text-right whitespace-nowrap font-mono-data">{fmt(item.low, item.precision)}</td><td className="px-2 py-1.5 text-right whitespace-nowrap font-mono-data">{item.volume == null ? "—" : Number(item.volume).toLocaleString()}</td><td className={`px-2 py-1.5 whitespace-nowrap font-medium ${live ? "text-emerald-600 oi-status-live" : status === "UNAVAILABLE" ? "text-amber-600 oi-status-stale" : "text-slate-500"}`}>{live ? "LIVE" : status}</td><td className="px-2 py-1.5 text-right whitespace-nowrap font-mono-data text-slate-500">{item.timestamp ? localTime(item.timezone, tick) : "—"}{item.stale ? <div className="text-[9px] text-amber-600">CHECK PROVIDER</div> : null}</td><td className="w-8 px-1.5 py-1.5 text-center"><Clock className={`inline-block h-3.5 w-3.5 ${live ? "text-emerald-600" : "text-rose-500"}`} strokeWidth={2.25} aria-label={live ? "Market open" : "Market closed"} title={live ? "Market open" : "Market closed"} data-testid={`global-market-clock-${item.id}`} /></td></tr>; })}</tbody></table></div>;
}

export default function GlobalMarketsPage({ isAdmin = false, userKey = "desk", onOpenAdmin, active = true }) {
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [tick, setTick] = useState(0); const [dragged, setDragged] = useState(null); const [configRevision, setConfigRevision] = useState(0);
  const layoutKey = `striklenz.global-market-layout.${userKey || "desk"}`;
  const [order, setOrder] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(layoutKey) || "[]"); const valid = Array.isArray(saved) ? saved.filter((x) => x === TIMELINE_KEY || CATEGORY_ORDER.includes(x)) : []; return [...valid, TIMELINE_KEY, ...CATEGORY_ORDER.filter((x) => !valid.includes(x))].filter((x, i, all) => all.indexOf(x) === i); } catch { return [TIMELINE_KEY, ...CATEGORY_ORDER]; } });
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const load = () => fetchGlobalMarkets({ force: configRevision > 0 }).then((next) => { if (live) { setData(next); setError(""); } }).catch(() => live && setError("Global market quotes are temporarily unavailable."));
    load();
    const id = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(id); };
  }, [active, configRevision]);
  useEffect(() => {
    const refresh = (event) => {
      if (event?.detail?.enabled === false) setData({ categories: [], items: [], enabled: false, updatedAt: new Date().toISOString() });
      setConfigRevision((value) => value + 1);
    };
    window.addEventListener("global-markets-config-saved", refresh);
    return () => window.removeEventListener("global-markets-config-saved", refresh);
  }, []);
  const groups = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map((category) => [category, (data?.items || []).filter((item) => item.category === category)])), [data]);
  const timelineEnabled = data?.enabled !== false && data?.prefs?.session_timeline_enabled !== false;
  const shown = order.filter((category) => category === TIMELINE_KEY
    ? timelineEnabled && (data?.items?.length || 0) > 0
    : category === "ADR MONITOR" || groups[category]?.length);
  const moveCategory = (from, to) => { if (!from || from === to) return; setOrder((previous) => { const next = previous.filter((x) => x !== from); next.splice(next.indexOf(to), 0, from); try { localStorage.setItem(layoutKey, JSON.stringify(next)); } catch (_) {} return next; }); };
  return <div className="space-y-4" data-testid="global-markets-page"><div className="flex items-start justify-between gap-3"><PageBrandTitle kicker="Unified market monitor" title="Global Markets" testId="global-markets-title" />{isAdmin ? <button type="button" onClick={onOpenAdmin} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><Settings2 className="h-3.5 w-3.5" />Configure</button> : null}</div>{error ? <p className="text-sm text-rose-600">{error}</p> : null}{shown.map((category) => category === TIMELINE_KEY ? <section key={category} className="group" draggable onDragStart={() => setDragged(category)} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveCategory(dragged, category); setDragged(null); }}><div className="mb-1 flex items-center gap-1"><GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-300 group-hover:text-slate-500" /><h2 className="text-[11px] font-semibold tracking-widest uppercase text-slate-500">SESSION TIMELINE</h2><span className="text-[9px] text-slate-400">drag to reorder</span></div><SessionTimeline items={data?.enabled === false ? [] : data?.items || []} tick={tick} /></section> : <section key={category} className="group" draggable onDragStart={() => setDragged(category)} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveCategory(dragged, category); setDragged(null); }}><div className="mb-1 flex items-center gap-1"><GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-300 group-hover:text-slate-500" /><h2 className="text-[11px] font-semibold tracking-widest uppercase text-slate-500">{category}</h2><span className="text-[9px] text-slate-400">drag to reorder</span></div>{category === "ADR MONITOR" ? <AdrPage embedded isAdmin={isAdmin} userKey={userKey} onOpenAdmin={onOpenAdmin} /> : data?.enabled === false ? null : <GlobalMarketTable items={groups[category]} tick={tick} />}</section>)}</div>;
}
