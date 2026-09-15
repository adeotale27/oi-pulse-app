import { useEffect, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Newspaper } from "lucide-react";

export default function MarketIntelSettingsModal({ open, onOpenChange }) {
  const [sources, setSources] = useState([]);
  const [templates, setTemplates] = useState({ apis: [], rss: [] });
  const [settings, setSettings] = useState({
    market_intel_ingest_seconds: 300,
    market_intel_retention_days: 5,
    market_intel_min_history_days: 2,
    market_intel_popup_enabled: true,
    market_intel_popup_dock_until_next: true,
  });
  const [form, setForm] = useState({
    name: "", source_type: "RSS", endpoint: "", method: "GET", auth: "none", api_key: "",
    mapping: '{"list":"articles","title":"title","url":"url","description":"description","published_at":"publishedAt"}',
  });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/market-intel/sources").then((r) => setSources(r.data?.sources || [])).catch(() => {});
    api.get("/market-intel/templates").then((r) => setTemplates(r.data || {})).catch(() => {});
    api.get("/settings").then((r) => {
      const d = r.data || {};
      setSettings({
        market_intel_ingest_seconds: d.market_intel_ingest_seconds ?? 300,
        market_intel_retention_days: d.market_intel_retention_days ?? 5,
        market_intel_min_history_days: d.market_intel_min_history_days ?? 2,
        market_intel_popup_enabled: d.market_intel_popup_enabled !== false,
        market_intel_popup_dock_until_next: d.market_intel_popup_dock_until_next !== false,
      });
    }).catch(() => {});
  };
  useEffect(() => { if (open) load(); }, [open]);

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

  const toggleEnabled = async (s, enabled) => {
    await saveSrc({
      id: s.id, name: s.name, source_type: s.source_type, endpoint: s.endpoint,
      method: s.method || "GET", auth: s.auth || "none", auth_key: s.auth_key,
      auth_header: s.auth_header, mapping: s.mapping || {}, enabled, query: s.query,
      priority: s.priority, max_items: s.max_items, category: s.category, region: s.region,
    });
  };

  const saveDeskSettings = async () => {
    setBusy(true);
    try {
      await api.post("/settings", settings);
      toast.success("Mkt Intel settings saved");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="market-intel-settings-modal" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="w-4 h-4" />
            Mkt Intel settings
          </DialogTitle>
          <DialogDescription>
            Public market-news RSS is on by default. Keyed APIs run only when a key is saved. Untick a source to skip it. Ingest always stores news on the interval below — hiding the page or popups does not stop that.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3" data-testid="market-intel-admin">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
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
            <label className="flex items-start gap-2 mt-1 sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={settings.market_intel_popup_enabled !== false} onChange={(e) => setSettings({ ...settings, market_intel_popup_enabled: e.target.checked })} />
              <span>Show the in-app Mkt Intel popup. Off hides it for guests and admin. Ingest still stores news.</span>
            </label>
            <label className="flex items-start gap-2 sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={settings.market_intel_popup_dock_until_next !== false} onChange={(e) => setSettings({ ...settings, market_intel_popup_dock_until_next: e.target.checked })} data-testid="mi-popup-dock-until-next" />
              <span>After close, keep a <b>Mkt Intel</b> chip until the next session (after day close / next open). Same idea as Overnight. Untick to hide it completely when dismissed.</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" className="h-7" disabled={busy} onClick={saveDeskSettings}>Save interval</Button>
            <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={async () => {
              if (!window.confirm("Delete news older than the retention window?")) return;
              try {
                const { data } = await api.post("/market-intel/cleanup");
                toast.message(`Cleanup: deleted ${data.deleted ?? 0}, remaining ${data.remaining ?? "—"}`);
              } catch (e) { toast.error(apiDetail(e, "Cleanup failed")); }
            }}>Cleanup now</Button>
          </div>

          <div className="text-[11px] font-semibold text-slate-700">Sources in use</div>
          {(sources || []).map((s) => (
            <div key={s.id} className="rounded-md border px-3 py-2 text-xs space-y-1" data-testid="mi-source-row">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!s.enabled}
                  disabled={busy}
                  onChange={(e) => toggleEnabled(s, e.target.checked)}
                  data-testid={`mi-source-on-${s.id}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.name}</span>{" "}
                  <span className="text-slate-400">{s.source_type}</span>
                  {s.needs_key && !s.has_secret ? <span className="ml-1 text-amber-700">needs key</span> : null}
                  {s.has_secret ? <span className="ml-1 text-emerald-700">key saved</span> : null}
                </span>
                <span className={s.status === "FAILED" ? "text-rose-700" : s.status === "HEALTHY" ? "text-emerald-700" : "text-slate-500"}>{s.status}</span>
              </label>
              <div className="text-[10px] text-slate-500 truncate pl-5">{s.endpoint}</div>
              <div className="text-[10px] text-slate-500 pl-5">last {s.last_run || "—"} · err {s.last_error || "—"} · in {s.last_fetched ?? 0} / keep {s.last_accepted ?? 0}</div>
              <div className="flex flex-wrap gap-1 pl-5">
                <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy} onClick={() => run(s.id, "test")}>Test</Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy} onClick={() => run(s.id, "fetch")}>Fetch now</Button>
                {!s.is_catalog ? (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-700" disabled={busy} onClick={() => api.delete(`/market-intel/sources/${s.id}`).then(load)}>Delete</Button>
                ) : null}
              </div>
              {s.needs_key ? (
                <input
                  className="w-full h-7 text-xs border rounded-sm px-2 ml-5 max-w-[calc(100%-1.25rem)]"
                  type="password"
                  placeholder="Paste API key"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) saveSrc({ ...s, api_key: v, enabled: true });
                    e.target.value = "";
                  }}
                />
              ) : null}
            </div>
          ))}

          <div className="rounded-md border border-dashed p-3 space-y-2">
            <div className="text-[11px] font-semibold">Add extra source</div>
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
            <div className="text-[10px] text-slate-500">Catalog (tick above after add; keyed APIs need a key):</div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
