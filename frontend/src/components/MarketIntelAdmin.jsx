import { useEffect, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function MarketIntelAdmin({ settings, setSettings }) {
  const [sources, setSources] = useState([]);
  const [templates, setTemplates] = useState({ apis: [], rss: [] });
  const [form, setForm] = useState({
    name: "", source_type: "RSS", endpoint: "", method: "GET", auth: "none", api_key: "",
    mapping: '{"list":"articles","title":"title","url":"url","description":"description","published_at":"publishedAt"}',
  });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/market-intel/sources").then((r) => setSources(r.data?.sources || [])).catch(() => {});
    api.get("/market-intel/templates").then((r) => setTemplates(r.data || {})).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveSrc = async (payload) => {
    setBusy(true);
    try {
      let mapping = payload.mapping;
      if (typeof mapping === "string") {
        try { mapping = JSON.parse(mapping || "{}"); } catch { mapping = {}; }
      }
      await api.post("/market-intel/sources", { ...payload, mapping });
      toast.success("Source saved");
      load();
    } catch (e) {
      toast.error(apiDetail(e, "Save failed"));
    } finally {
      setBusy(false);
    }
  };

  const run = async (id, path) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/market-intel/sources/${id}/${path}`);
      toast[data.ok ? "success" : "error"](
        `${path}: fetched ${data.fetched ?? 0} · accepted ${data.accepted ?? 0} · dups ${data.duplicates ?? 0}${data.error ? ` · ${data.error}` : ""}`,
      );
      load();
    } catch (e) {
      toast.error(apiDetail(e, "Run failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 pt-2 border-t border-slate-200" data-testid="market-intel-admin">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-800">Market Intelligence (admin)</div>
      <p className="text-xs text-slate-500">Background ingest starts ~90s after boot, then on this interval. Does not block app start. Keys stay on the server.</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>Ingest interval (sec)
          <input type="number" min={60} max={3600} className="w-full h-8 border rounded-sm px-2 mt-0.5"
            value={settings.market_intel_ingest_seconds ?? 300}
            onChange={(e) => setSettings({ ...settings, market_intel_ingest_seconds: Number(e.target.value) })}
            data-testid="mi-ingest-seconds" />
        </label>
        <label>Retention days
          <input type="number" min={3} max={90} className="w-full h-8 border rounded-sm px-2 mt-0.5"
            value={settings.market_intel_retention_days ?? 5}
            onChange={(e) => setSettings({ ...settings, market_intel_retention_days: Number(e.target.value) })} />
        </label>
        <label>Min history days
          <input type="number" min={1} max={30} className="w-full h-8 border rounded-sm px-2 mt-0.5"
            value={settings.market_intel_min_history_days ?? 2}
            onChange={(e) => setSettings({ ...settings, market_intel_min_history_days: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 mt-5">
          <input type="checkbox" checked={settings.market_intel_popup_enabled !== false} onChange={(e) => setSettings({ ...settings, market_intel_popup_enabled: e.target.checked })} />
          Allow in-app popups
        </label>
      </div>
      <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={async () => {
        if (!window.confirm("Delete news older than the retention window?")) return;
        try {
          const { data } = await api.post("/market-intel/cleanup");
          toast.message(`Cleanup: deleted ${data.deleted ?? 0}, remaining ${data.remaining ?? "—"}`);
        } catch (e) { toast.error(apiDetail(e, "Cleanup failed")); }
      }}>Cleanup now</Button>

      <div className="text-[11px] font-semibold text-slate-700">Sources</div>
      {(sources || []).map((s) => (
        <div key={s.id} className="rounded-md border px-3 py-2 text-xs space-y-1" data-testid="mi-source-row">
          <div className="flex justify-between gap-2">
            <span className="font-medium">{s.name} <span className="text-slate-400">{s.source_type}</span></span>
            <span className={s.status === "FAILED" ? "text-rose-700" : s.status === "HEALTHY" ? "text-emerald-700" : "text-slate-500"}>{s.status}</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">{s.endpoint}</div>
          <div className="text-[10px] text-slate-500">last {s.last_run || "—"} · ok {s.last_success || "—"} · err {s.last_error || "—"} · in {s.last_fetched ?? 0} / keep {s.last_accepted ?? 0} / dups {s.last_duplicates ?? 0}</div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy} onClick={() => saveSrc({ ...s, enabled: !s.enabled })}>{s.enabled ? "Disable" : "Enable"}</Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy} onClick={() => run(s.id, "test")}>Test</Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy} onClick={() => run(s.id, "fetch")}>Fetch now</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-700" disabled={busy} onClick={() => api.delete(`/market-intel/sources/${s.id}`).then(load)}>Delete</Button>
          </div>
        </div>
      ))}

      <div className="rounded-md border border-dashed p-3 space-y-2">
        <div className="text-[11px] font-semibold">Add source</div>
        <select className="w-full h-8 text-xs border rounded-sm" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
          {["RSS", "API", "FIRECRAWL", "OFFICIAL_FEED"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="mi-source-name" />
        <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="URL / endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} data-testid="mi-source-url" />
        {form.source_type === "API" && (
          <>
            <select className="w-full h-8 text-xs border rounded-sm" value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value })}>
              {["none", "bearer", "header", "query"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <textarea className="w-full text-[10px] border rounded-sm px-2 py-1 font-mono" rows={3} value={form.mapping} onChange={(e) => setForm({ ...form, mapping: e.target.value })} />
          </>
        )}
        <input className="w-full h-8 text-xs border rounded-sm px-2" type="password" placeholder="API / Firecrawl key (optional)" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
        <Button size="sm" className="h-7" disabled={busy || !form.name || !form.endpoint} onClick={() => saveSrc(form)} data-testid="mi-source-save">Save source</Button>
        <div className="text-[10px] text-slate-500">Catalog (public-apis News/Finance — add then paste your key):</div>
        <div className="flex flex-wrap gap-1">
          {(templates.apis || []).map((t) => (
            <button key={t.id} type="button" className="text-[10px] border rounded-sm px-1.5 py-0.5" onClick={() => setForm({
              name: t.name, source_type: "API", endpoint: t.endpoint, method: t.method || "GET",
              auth: t.auth, api_key: "", mapping: JSON.stringify(t.mapping || {}),
            })}>{t.name}</button>
          ))}
          {(templates.rss || []).map((t) => (
            <button key={t.id} type="button" className="text-[10px] border rounded-sm px-1.5 py-0.5" onClick={() => setForm({
              name: t.name, source_type: t.source_type, endpoint: t.endpoint, method: "GET", auth: "none", api_key: "", mapping: "{}",
            })}>{t.name}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
