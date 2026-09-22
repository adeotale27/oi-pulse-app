import { useEffect, useMemo, useState } from "react";
import PageBrandTitle from "@/components/PageBrandTitle";
import AdrPage from "@/components/AdrPage";
import { fetchGlobalMarkets } from "@/lib/globalMarketsSnapshot";

const CATEGORY_ORDER = ["GLOBAL INDICES", "FX / FOREX", "COMMODITIES", "CRYPTO", "ADR MONITOR", "MACRO"];

function clock(timezone, tick) {
  void tick;
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); } catch { return "—"; }
}
function fmt(value, precision) {
  return value == null ? "No Data" : Number(value).toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}
function tone(value) { return Number(value) > 0 ? "text-emerald-600" : Number(value) < 0 ? "text-rose-600" : "text-slate-500"; }
function statusTone(status) { return status === "LIVE" || status === "24/7" ? "text-emerald-600" : status === "PRE-MARKET" ? "text-amber-600" : "text-slate-500"; }

function InstrumentRow({ item, tick }) {
  const status = item.available ? item.marketStatus : "NO DATA";
  return <div className="grid grid-cols-[minmax(9rem,1.35fr)_minmax(5rem,.8fr)_minmax(5rem,.75fr)] gap-2 border-t border-slate-100 dark:border-slate-800 px-2 py-2.5 text-xs first:border-t-0" data-testid={`global-market-row-${item.id}`}>
    <div className="min-w-0"><div className="font-semibold tracking-wide truncate">{item.symbol}</div><div className="text-[10px] text-slate-500 truncate">{item.displayName}</div></div>
    <div className="font-mono-data text-right tabular-nums"><div>{fmt(item.price, item.precision)}</div><div className={`text-[10px] ${tone(item.changePercent)}`}>{item.change == null ? "" : `${Number(item.change) >= 0 ? "+" : ""}${fmt(item.change, item.precision)} · ${Number(item.changePercent) >= 0 ? "+" : ""}${Number(item.changePercent).toFixed(2)}%`}</div></div>
    <div className={`text-right text-[10px] font-semibold ${statusTone(status)}`}><div>● {status}</div><div className="font-mono-data font-normal text-slate-400">{clock(item.timezone, tick)}</div>{item.stale ? <div className="text-amber-600">STALE</div> : null}</div>
  </div>;
}

export default function GlobalMarketsPage({ isAdmin = false, userKey = "desk", onOpenAdmin }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    let live = true;
    const load = () => fetchGlobalMarkets().then((next) => { if (live) { setData(next); setError(""); } }).catch(() => live && setError("Global market quotes are temporarily unavailable."));
    load(); const id = window.setInterval(load, 60_000); return () => { live = false; window.clearInterval(id); };
  }, []);
  const groups = useMemo(() => {
    const items = data?.items || [];
    return Object.fromEntries(CATEGORY_ORDER.map((category) => [category, category === "MACRO" ? items.filter((item) => item.category === category || item.macro) : items.filter((item) => item.category === category)]));
  }, [data]);
  return <div className="space-y-4" data-testid="global-markets-page">
    <PageBrandTitle kicker="Unified market monitor" title="Global Markets" testId="global-markets-title" />
    {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    {CATEGORY_ORDER.map((category) => category === "ADR MONITOR" ? <section key={category} className="pt-1"><h2 className="mb-2 text-[11px] font-semibold tracking-widest uppercase text-slate-500">ADR Monitor</h2><AdrPage embedded isAdmin={isAdmin} userKey={userKey} onOpenAdmin={onOpenAdmin} /></section> : <section key={category}><h2 className="mb-1 text-[11px] font-semibold tracking-widest uppercase text-slate-500">{category}</h2><div className="rounded-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">{groups[category]?.length ? groups[category].map((item) => <InstrumentRow key={item.id} item={item} tick={tick} />) : <div className="px-2 py-3 text-xs text-slate-400">No instruments configured.</div>}</div></section>)}
  </div>;
}
