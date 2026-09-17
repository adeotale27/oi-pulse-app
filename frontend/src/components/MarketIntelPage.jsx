import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import PageBrandTitle from "@/components/PageBrandTitle";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MarketIntelUserPrefs } from "@/components/DeskAiKeysAdmin";
import { MI_FILTERS, bandClass, formatEventTypeLabel, impactScoreLabel, indiaImpactLabel, MI_RELOAD_EVENT, notifyMarketIntelReload, readMiFeedCache, writeMiFeedCache } from "@/lib/marketIntel";
import { todayIST } from "@/lib/holidays";

export default function MarketIntelPage({ compact = false }) {
  const [filt, setFilt] = useState("all");
  const [items, setItems] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => todayIST());
  const [config, setConfig] = useState(null);
  const [minDate, setMinDate] = useState(null);
  const [maxDate, setMaxDate] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const feedGen = useRef(0);

  const loadPrefs = useCallback(() => {
    return api.get("/market-intel/prefs").then((r) => setPrefs(r.data?.prefs || null)).catch(() => {});
  }, []);

  const loadConfig = useCallback(() => {
    return api.get("/market-intel/config").then((r) => {
      setConfig(r.data?.config || null);
      const cfg = r.data?.config || {};
      const maxDaysBack = cfg.max_days_back || 5;
      const todayString = todayIST();
      const min = new Date(`${todayString}T12:00:00+05:30`);
      min.setDate(min.getDate() - maxDaysBack);
      const minDateString = min.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      setMinDate(minDateString);
      setMaxDate(todayString);
      setConfigLoaded(true);
    }).catch(() => {
      const todayString = todayIST();
      const min = new Date(`${todayString}T12:00:00+05:30`);
      min.setDate(min.getDate() - 5);
      setMinDate(min.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
      setMaxDate(todayString);
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const loadFeed = useCallback(async () => {
    if (!configLoaded) return;
    if (minDate && selectedDate < minDate) {
      setErr(`No data available for dates before ${minDate}`);
      return;
    }
    if (maxDate && selectedDate > maxDate) {
      setErr(`No data available for dates after ${maxDate}`);
      return;
    }

    const gen = ++feedGen.current;
    const cached = readMiFeedCache(selectedDate, filt);
    if (cached) {
      setItems(cached);
      setErr(null);
    }
    setLoading(true);
    try {
      const r = await api.get("/market-intel", { params: { filter: filt, date: selectedDate }, timeout: 10000 });
      if (gen !== feedGen.current) return;
      const next = r.data?.items || [];
      writeMiFeedCache(selectedDate, filt, next);
      setItems(next);
      setErr(null);
    } catch (e) {
      if (gen !== feedGen.current) return;
      if (!cached) setErr(apiDetail(e, "Market intelligence feed failed"));
    } finally {
      if (gen === feedGen.current) setLoading(false);
    }
  }, [filt, selectedDate, minDate, maxDate, configLoaded]);

  useEffect(() => {
    let cancelled = false;
    const loadBoth = async () => {
      await loadPrefs();
      if (!cancelled) await loadFeed();
    };
    loadBoth();
    return () => { cancelled = true; };
  }, [loadPrefs, loadFeed]);

  useEffect(() => {
    const onReload = () => loadFeed();
    window.addEventListener(MI_RELOAD_EVENT, onReload);
    return () => window.removeEventListener(MI_RELOAD_EVENT, onReload);
  }, [loadFeed]);

  useEffect(() => {
    if (!configLoaded) return undefined;
    const sec = Math.max(60, Number(prefs?.ui_poll_seconds) || 120);
    const id = setInterval(loadFeed, sec * 1000);
    return () => clearInterval(id);
  }, [loadFeed, prefs?.ui_poll_seconds, configLoaded]);

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
      <div className="flex flex-wrap items-center gap-1">
        {MI_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilt(f.id)}
            className={`text-[10px] px-2 py-1 rounded-sm border ${filt === f.id ? "bg-emerald-50 border-emerald-300 font-semibold" : "border-slate-200"}`}
            data-testid={`mi-filter-${f.id}`}
          >{f.label}</button>
        ))}
        <div className="flex items-center gap-3 ml-auto">
          <button
            type="button"
            onClick={() => {
              // Parse YYYY-MM-DD as local time
              const [year, month, day] = selectedDate.split('-').map(Number);
              const date = new Date(year, month - 1, day);
              date.setDate(date.getDate() - 1);
              // Format back to YYYY-MM-DD in local time
              const newYear = date.getFullYear();
              const newMonth = String(date.getMonth() + 1).padStart(2, '0');
              const newDay = String(date.getDate()).padStart(2, '0');
              const newDate = `${newYear}-${newMonth}-${newDay}`;
              // Clamp to minDate
              if (minDate && newDate < minDate) {
                setSelectedDate(minDate);
              } else {
                setSelectedDate(newDate);
              }
            }}
            disabled={minDate && selectedDate <= minDate}
            className="text-[10px] px-2 py-1 rounded-sm border border-slate-200 hover:bg-slate-50"
            data-testid="mi-prev-date"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-[10px] font-mono-data">{selectedDate}</div>
          <button
            type="button"
            onClick={() => {
              // Parse YYYY-MM-DD as local time
              const [year, month, day] = selectedDate.split('-').map(Number);
              const date = new Date(year, month - 1, day);
              date.setDate(date.getDate() + 1);
              // Format back to YYYY-MM-DD in local time
              const newYear = date.getFullYear();
              const newMonth = String(date.getMonth() + 1).padStart(2, '0');
              const newDay = String(date.getDate()).padStart(2, '0');
              const newDate = `${newYear}-${newMonth}-${newDay}`;
              // Clamp to maxDate
              if (maxDate && newDate > maxDate) {
                setSelectedDate(maxDate);
              } else {
                setSelectedDate(newDate);
              }
            }}
            disabled={maxDate && selectedDate >= maxDate}
            className="text-[10px] px-2 py-1 rounded-sm border border-slate-200 hover:bg-slate-50"
            data-testid="mi-next-date"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      {loading && items.length > 0 ? (
        <div className="text-[10px] text-slate-400" data-testid="mi-loading-inline">Updating…</div>
      ) : null}
      {loading && !items.length && !err && (
        <div className="text-xs text-slate-500 text-center py-8" data-testid="mi-loading">
          Loading market intelligence...
        </div>
      )}
      {err && !items.length && (
        <div className="text-xs text-rose-700 text-center py-8 border border-rose-200 rounded-md" data-testid="mi-error">
          Could not load market intelligence: {err}
        </div>
      )}
      {!err || items.length > 0 ? (
        <div className={`space-y-2 ${loading && items.length ? "opacity-80" : ""}`}>
          {!loading && items.length === 0 && !err && (
            <div className="text-xs text-slate-500 border rounded-md p-4 text-center py-8" data-testid="mi-empty">
              No ranked events for <b>{selectedDate}</b> yet.
              {selectedDate === maxDate ?
                'Older days stay in storage but are not shown here.' :
                'No news data exist for the selected date kindly change the date.'}
              Admin can add RSS/API sources. Ingest waits ~90s after boot, then runs on the admin interval.
            </div>
          )}
          {items.length > 0 && (
            <>
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
            </>
          )}
        </div>
      )}
      <MarketIntelUserPrefs prefs={prefs} onChange={patchPrefs} />
    </div>
  );
}
