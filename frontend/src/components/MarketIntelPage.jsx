import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import PageBrandTitle from "@/components/PageBrandTitle";
import { MarketIntelUserPrefs } from "@/components/DeskAiKeysAdmin";
import { MI_FILTERS, bandClass, formatEventTypeLabel, impactScoreLabel, indiaImpactLabel, MI_RELOAD_EVENT, notifyMarketIntelReload } from "@/lib/marketIntel";

export default function MarketIntelPage({ compact = false }) {
  const [filt, setFilt] = useState("all");
  const [items, setItems] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [err, setErr] = useState(null);

  const loadPrefs = useCallback(() => {
    api.get("/market-intel/prefs").then((r) => setPrefs(r.data?.prefs || null)).catch(() => {});
  }, []);

  const loadFeed = useCallback(() => {
    api.get("/market-intel", { params: { filter: filt }, timeout: 20000 })
      .then((r) => { setItems(r.data?.items || []); setErr(null); })
      .catch((e) => setErr(e?.message || "feed failed"));
  }, [filt]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);
  useEffect(() => { loadFeed(); }, [loadFeed]);
  useEffect(() => {
    const onReload = () => loadFeed();
    window.addEventListener(MI_RELOAD_EVENT, onReload);
    return () => window.removeEventListener(MI_RELOAD_EVENT, onReload);
  }, [loadFeed]);

  useEffect(() => {
    const sec = Math.max(60, Number(prefs?.ui_poll_seconds) || 120);
    const id = setInterval(loadFeed, sec * 1000);
    return () => clearInterval(id);
  }, [loadFeed, prefs?.ui_poll_seconds]);

  const patchPrefs = (patch) => {
    const next = { ...(prefs || {}), ...patch };
    setPrefs(next);
    api.post("/market-intel/prefs", patch).then(() => {
      if ("popup_enabled" in patch) notifyMarketIntelReload();
    }).catch(() => {});
  };

  return (
    <div className="space-y-3" data-testid="market-intel-page">
      {!compact && (
        <PageBrandTitle kicker="Desk" title="Market Intelligence" testId="market-intel-title" />
      )}
      <div className="flex flex-wrap gap-1">
        {MI_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilt(f.id)}
            className={`text-[10px] px-2 py-1 rounded-sm border ${filt === f.id ? "bg-emerald-50 border-emerald-300 font-semibold" : "border-slate-200"}`}
            data-testid={`mi-filter-${f.id}`}
          >{f.label}</button>
        ))}
      </div>
      {err && <div className="text-xs text-rose-700">Showing last stored items if any. ({err})</div>}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-slate-500 border rounded-md p-4">No ranked events for <b>today</b> yet. Older days stay in storage but are not shown here. Admin can add RSS/API sources. Ingest waits ~90s after boot, then runs on the admin interval.</div>
        )}
        {items.map((it) => (
          <article key={it.event_cluster_id || it.id} className="rounded-md border border-slate-200 bg-white p-3 space-y-1" data-testid="mi-event">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${bandClass(it.impact_band)}`}>{it.impact_band || "—"}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${bandClass(it.impact_band)}`}>{impactScoreLabel(it.impact_score)}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-800">{formatEventTypeLabel(it.event_type)}</span>
              <span className="text-[10px] text-slate-400 ml-auto">{it.source_name}{it.source_count > 1 ? ` · ${it.source_count} sources` : ""}</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 leading-snug">{it.title}</h3>
            <div className="text-[11px] text-slate-600">{indiaImpactLabel(it.india_relevance_score)} · {String(it.published_at || "").slice(0, 16)}</div>
            {it.summary ? <p className="text-xs text-slate-600 line-clamp-3">{it.summary}</p> : null}
            {Array.isArray(it.potential) && it.potential.length > 0 && (
              <ul className="text-[11px] text-slate-700 list-disc pl-4">
                {it.potential.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {it.article_url ? <a className="text-[11px] text-emerald-800 underline" href={it.article_url} target="_blank" rel="noreferrer">Open source</a> : null}
          </article>
        ))}
      </div>
      <MarketIntelUserPrefs prefs={prefs} onChange={patchPrefs} />
    </div>
  );
}
