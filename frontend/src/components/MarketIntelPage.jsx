import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import PageBrandTitle from "@/components/PageBrandTitle";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { MarketIntelUserPrefs } from "@/components/DeskAiKeysAdmin";
import { MI_FILTERS, bandClass, directionalBasisLabel, directionalImpactClass, directionalImpactLabel, formatEventTypeLabel, impactScoreLabel, indiaImpactLabel, marketTimingLabel, newsFreshnessLabel, sourceAgreementLabel, marketIntelTimeLabel, marketIntelPublicationLabel, volatilityRiskClass, volatilitySellerNote, MI_RELOAD_EVENT, notifyMarketIntelReload, readMiFeedCache, writeMiFeedCache } from "@/lib/marketIntel";
import { todayIST } from "@/lib/holidays";

export default function MarketIntelPage({ compact = false, isAdmin = false, demoMode = false }) {
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
  const [refreshing, setRefreshing] = useState(false);
  const [performance, setPerformance] = useState(null);
  const [performanceError, setPerformanceError] = useState(null);
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
    const cached = demoMode ? null : readMiFeedCache(selectedDate, filt);
    if (cached) {
      setItems(cached);
      setErr(null);
    }
    setLoading(true);
    try {
      const r = await api.get("/market-intel", { params: { filter: filt, date: selectedDate }, timeout: 25000 });
      if (gen !== feedGen.current) return;
      const next = r.data?.items || [];
      if (!demoMode) writeMiFeedCache(selectedDate, filt, next);
      setItems(next);
      setErr(null);
    } catch (e) {
      if (gen !== feedGen.current) return;
      if (!cached) setErr(apiDetail(e, "Market intelligence feed failed"));
    } finally {
      if (gen === feedGen.current) setLoading(false);
    }
  }, [filt, selectedDate, minDate, maxDate, configLoaded, demoMode]);

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
    let cancelled = false;
    const loadPerformance = () => api.get("/market-intel/performance", { timeout: 15000 })
      .then((r) => {
        if (cancelled) return;
        setPerformance(r.data || null);
        setPerformanceError(null);
      })
      .catch(() => {
        if (!cancelled) setPerformanceError("Market outcome measurements are currently unavailable.");
      });
    loadPerformance();
    const id = setInterval(loadPerformance, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return undefined;
    const sec = Math.max(60, Number(prefs?.ui_poll_seconds) || 60);
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

  const refreshLatest = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setErr(null);
    try {
      await api.post("/market-intel/refresh", {}, { timeout: 120000 });
      notifyMarketIntelReload();
      await loadFeed();
    } catch (e) {
      setErr(apiDetail(e, "Could not refresh configured news sources"));
    } finally {
      setRefreshing(false);
    }
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
        <div className="flex items-center gap-2 ml-auto">
          {isAdmin ? (
            <button
              type="button"
              onClick={refreshLatest}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-sm border border-emerald-300 text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
              data-testid="mi-refresh-latest"
              title="Fetch each enabled Market Intelligence source now"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh latest"}
            </button>
          ) : null}
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
        <p className="text-[11px] text-slate-500" data-testid="mi-score-guide">
          Importance ranks story significance. Direction and volatility are estimates, not a price forecast or live IV readings.
        </p>
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
      {items.length > 0 || (!loading && !err) ? (
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
                <article key={it.event_cluster_id || it.id} className="oi-surface-lift oi-3d-stage rounded-md border border-slate-200 bg-white p-3 space-y-1" data-testid="mi-event">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${bandClass(it.impact_band)}`}>{it.impact_band || "—"}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${bandClass(it.impact_band)}`}>{impactScoreLabel(it.impact_score)}</span>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${directionalImpactClass(it.market_direction)}`}
                      title={`${directionalBasisLabel(it.direction_basis)} ${it.direction_reason || ""}`}
                      data-testid="mi-direction"
                    >
                      {it.market_direction === "SUPPORTIVE" ? <ArrowUp aria-hidden="true" className="h-3 w-3" /> : null}
                      {it.market_direction === "NEGATIVE" ? <ArrowDown aria-hidden="true" className="h-3 w-3" /> : null}
                      {directionalImpactLabel(it.market_direction)}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-800">{formatEventTypeLabel(it.event_type)}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">
                      {(it.independent_source_names || []).slice(0, 3).join(" · ") || it.source_name}
                      {" · "}{it.independent_source_count ?? it.source_count ?? 1} independent source{(it.independent_source_count ?? it.source_count ?? 1) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                    <span>{sourceAgreementLabel(it.source_direction_agreement)}</span>
                    <span>{marketTimingLabel(it.market_timing)}</span>
                    <span>{newsFreshnessLabel(it.news_freshness)}</span>
                    <span>Published: {it.published_at_known ? marketIntelPublicationLabel(it.published_at, it.published_at_precision) : "time not supplied"}</span>
                    <span>Received: {marketIntelTimeLabel(it.discovered_at)}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 leading-snug">{it.title}</h3>
                  {it.direction_reason ? <p className="text-[11px] text-slate-600" data-testid="mi-direction-reason">{it.direction_reason}</p> : null}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
                    <span>{indiaImpactLabel(it.india_relevance_score)}</span>
                    <span className={`rounded-sm border px-1.5 py-0.5 font-semibold ${volatilityRiskClass(it.volatility_risk)}`} title={it.volatility_risk_reason || "Text-based catalyst assessment, not live implied volatility."}>
                      Volatility {it.volatility_risk || "unavailable"}
                    </span>
                  </div>
                  {volatilitySellerNote(it.volatility_risk) ? (
                    <p className="text-[10px] text-amber-800" data-testid="mi-seller-note">
                      {volatilitySellerNote(it.volatility_risk)}
                    </p>
                  ) : null}
                  {it.india_link_reason ? <p className={`text-[11px] ${it.india_link_status === "UNCLEAR" ? "text-slate-500" : "text-slate-600"}`} data-testid="mi-india-link">{it.india_link_reason}</p> : null}
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
      ) : null}
      {/* Keep retrospective analytics after the ranked news so the feed stays first. */}
      <MarketIntelOutcomePanels performance={performance} error={performanceError} />
      <MarketIntelUserPrefs prefs={prefs} onChange={patchPrefs} />
    </div>
  );
}

function MarketIntelOutcomePanels({ performance, error }) {
  return (
    <>
      <details className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px]" data-testid="mi-performance">
        <summary className="cursor-pointer font-semibold text-slate-700">How have direction reads lined up with real index moves?</summary>
        {error ? (
          <p className="pt-2 text-rose-700" role="status">{error}</p>
        ) : performance ? (
          <>
            <p className="pt-2 text-slate-500">
              Market-hours stories only; after-hours / pre-open stories are separate ({performance.after_hours_story_count || 0}), as are weekend / holiday stories ({performance.weekend_or_holiday_story_count || 0}) and unknown timing ({performance.unknown_timing_story_count || 0}).
              Flat moves under 0.05% are excluded. Accuracy appears after {performance.minimum_sample_count} scored examples.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3" data-testid="mi-performance-results">
              {(performance.results || []).map((row) => (
                <div key={`${row.index}-${row.horizon}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                  <span className="font-medium text-slate-700">{row.index} · {row.horizon === "session_close" ? "close" : row.horizon}</span>
                  <span className={row.accuracy_pct == null ? "text-slate-500" : "font-semibold text-slate-800"}>
                    {row.accuracy_pct == null
                      ? `Building sample ${row.sample_count}/${performance.minimum_sample_count}`
                      : `${row.accuracy_pct}% (${row.sample_count})`}
                    {` · ${row.unavailable_count || 0} unavailable`}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : <p className="pt-2 text-slate-500">Loading measured outcomes…</p>}
      </details>
      <details className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[10px]" data-testid="mi-confidence-calibration">
        <summary className="cursor-pointer font-semibold text-slate-700">Do stronger direction reads perform better?</summary>
        {error ? (
          <p className="pt-2 text-rose-700" role="status">{error}</p>
        ) : performance ? (
          <>
            <p className="pt-2 text-slate-500">
              Weak (1–24), moderate (25–49), and strong (50–100) are bands of the direction engine’s heuristic score magnitude—not probabilities. Hit rates exclude flat moves and appear after {performance.minimum_sample_count} scored event outcomes per band, index, and horizon.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="mi-confidence-results">
              {(performance.results || []).map((row) => (
                <div key={`${row.index}-${row.horizon}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="font-semibold text-slate-700">{row.index} · {row.horizon === "session_close" ? "close" : row.horizon}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-slate-600">
                    {(row.strength_bands || []).map((band) => (
                      <span key={band.band}>
                        {band.band?.toLowerCase()}: {band.accuracy_pct == null
                          ? `building ${band.sample_count}/${performance.minimum_sample_count}`
                          : `${band.accuracy_pct}% (${band.sample_count})`}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-slate-500">
                    {row.strength_comparison
                      ? row.strength_comparison.higher_strength_more_accurate
                        ? `Strong reads lead weak reads by ${row.strength_comparison.strong_minus_weak_pct_points} percentage points.`
                        : `Strong reads do not lead weak reads (${row.strength_comparison.strong_minus_weak_pct_points} percentage points).`
                      : `Strong-vs-weak comparison builds after ${performance.minimum_sample_count} scored outcomes in each band.`}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : <p className="pt-2 text-slate-500">Loading direction-strength outcomes…</p>}
      </details>
      <details className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[10px]" data-testid="mi-volatility-performance">
        <summary className="cursor-pointer font-semibold text-slate-700">Did volatility reads line up with later VIX rises or wider index ranges?</summary>
        {error ? (
          <p className="pt-2 text-rose-700" role="status">{error}</p>
        ) : performance?.volatility ? (
          <>
            <p className="pt-2 text-slate-500">
              Separate from direction. VIX rise means at least +0.5 points and +5%; a wider index range means at least +0.05 percentage points and 20% wider than the equally long pre-story window. Rates appear after {performance.minimum_sample_count} observations. This measures timing, not proof the story caused the move.
            </p>
            <h3 className="pt-2 pb-1 font-semibold text-slate-700">India VIX</h3>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3" data-testid="mi-vix-performance-results">
              {(performance.volatility.india_vix || []).map((row) => (
                <div key={`${row.risk_level}-${row.horizon}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                  <span className="font-medium text-slate-700">{row.risk_level} · {row.horizon === "session_close" ? "close" : row.horizon}</span>
                  <span className="text-right text-slate-600">
                    {row.material_increase_pct == null
                      ? `Building ${row.sample_count}/${performance.minimum_sample_count}`
                      : `VIX up ${row.material_increase_pct}% (${row.sample_count})`}
                    {row.average_change_points == null ? "" : ` · avg ${row.average_change_points >= 0 ? "+" : ""}${row.average_change_points} pts`}
                    {` · ${row.unavailable_count || 0} unavailable`}
                  </span>
                </div>
              ))}
            </div>
            <h3 className="pt-2 pb-1 font-semibold text-slate-700">Index ranges versus the preceding equal-length window</h3>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="mi-range-performance-results">
              {(performance.volatility.index_ranges || []).map((row) => (
                <div key={`${row.risk_level}-${row.index}-${row.horizon}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                  <span className="font-medium text-slate-700">{row.risk_level} · {row.index} · {row.horizon === "session_close" ? "close" : row.horizon}</span>
                  <span className="text-right text-slate-600">
                    {row.range_increased_pct == null
                      ? `Building ${row.sample_count}/${performance.minimum_sample_count}`
                      : `Wider ${row.range_increased_pct}% (${row.sample_count})`}
                    {row.average_pre_range_pct == null || row.average_post_range_pct == null
                      ? ""
                      : ` · ${row.average_pre_range_pct}% → ${row.average_post_range_pct}%`}
                    {` · ${row.unavailable_count || 0} unavailable`}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : <p className="pt-2 text-slate-500">Loading measured volatility outcomes…</p>}
      </details>
      <details className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[10px]" data-testid="mi-catalyst-performance">
        <summary className="cursor-pointer font-semibold text-slate-700">Which catalysts were followed by volatility?</summary>
        {error ? (
          <p className="pt-2 text-rose-700" role="status">{error}</p>
        ) : performance?.volatility?.catalysts ? (
          <>
            <p className="pt-2 text-slate-500">
              Event-cluster outcomes only. A catalyst metric is shown only after {performance.minimum_sample_count} usable observations for that horizon; categories are rule-classified and do not imply causation.
            </p>
            <h3 className="pt-2 pb-1 font-semibold text-slate-700">India VIX</h3>
            {performance.volatility.catalysts.india_vix?.length ? (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="mi-catalyst-vix-results">
                {performance.volatility.catalysts.india_vix.map((row) => (
                  <div key={`${row.catalyst}-${row.horizon}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    <span className="font-medium text-slate-700">{formatEventTypeLabel(row.catalyst)} · {row.horizon === "session_close" ? "close" : row.horizon}</span>
                    <span className="text-right text-slate-600">
                      VIX up {row.material_increase_pct}% ({row.sample_count}) · avg {row.average_change_points >= 0 ? "+" : ""}{row.average_change_points} pts
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-slate-500">No catalyst has enough observed VIX outcomes yet.</p>}
            <h3 className="pt-2 pb-1 font-semibold text-slate-700">Index ranges</h3>
            {performance.volatility.catalysts.index_ranges?.length ? (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="mi-catalyst-range-results">
                {performance.volatility.catalysts.index_ranges.map((row) => (
                  <div key={`${row.catalyst}-${row.index}-${row.horizon}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    <span className="font-medium text-slate-700">{formatEventTypeLabel(row.catalyst)} · {row.index} · {row.horizon === "session_close" ? "close" : row.horizon}</span>
                    <span className="text-right text-slate-600">
                      Wider {row.range_increased_pct}% ({row.sample_count}) · {row.average_pre_range_pct}% → {row.average_post_range_pct}%
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-slate-500">No catalyst has enough observed index-range outcomes yet.</p>}
          </>
        ) : <p className="pt-2 text-slate-500">Loading catalyst outcomes…</p>}
      </details>
    </>
  );
}
