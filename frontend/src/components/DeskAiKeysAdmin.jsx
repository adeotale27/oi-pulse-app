import { useCallback, useEffect, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MI_CATS } from "@/lib/marketIntel";
import { toast } from "sonner";

export default function DeskAiKeysAdmin() {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ name: "", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/desk-ai/providers").then((r) => setProviders(r.data?.providers || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (payload) => {
    setBusy(true);
    try {
      const { data } = await api.post("/desk-ai/providers", payload);
      setProviders((await api.get("/desk-ai/providers")).data?.providers || [data.provider].filter(Boolean));
      toast.success("Desk AI provider saved");
      setForm((f) => ({ ...f, api_key: "" }));
    } catch (e) {
      toast.error(apiDetail(e, "Could not save provider"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 pt-2 border-t border-slate-200" data-testid="desk-ai-keys-admin">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-800">Desk AI keys</div>
      <p className="text-xs text-slate-500">
        Pick an OpenAI-compatible provider and store the key on the server (never in the browser). Env <code>OPENAI_API_KEY</code> still works as fallback.
      </p>
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="rounded-md border border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{p.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{p.base_url} · {p.model} · {p.has_key ? "key saved" : "no key"}</div>
            </div>
            <Button size="sm" variant={p.selected ? "default" : "outline"} className="h-7 text-[11px]" disabled={busy} onClick={() => api.post(`/desk-ai/providers/${p.id}/select`).then(load)}>
              {p.selected ? "Active" : "Use"}
            </Button>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-dashed border-slate-300 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-slate-700">Add provider (e.g. DeepSeek)</div>
        <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="desk-ai-new-name" />
        <input className="w-full h-8 text-xs border rounded-sm px-2 font-mono" placeholder="Base URL" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
        <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input className="w-full h-8 text-xs border rounded-sm px-2" type="password" placeholder="API key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} data-testid="desk-ai-new-key" />
        <Button size="sm" className="h-7" disabled={busy || !form.name} onClick={() => save({ ...form, select: true })} data-testid="desk-ai-add-provider">Save &amp; use</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {providers.filter((p) => !p.is_custom).map((p) => (
          <div key={`key-${p.id}`} className="space-y-1">
            <div className="text-[10px] text-slate-500">{p.name} key</div>
            <input
              type="password"
              className="w-full h-8 text-xs border rounded-sm px-2"
              placeholder={p.has_key ? "••••••••" : "Paste key"}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v) save({ id: p.id, name: p.name, base_url: p.base_url, model: p.model, api_key: v, select: true });
                e.target.value = "";
              }}
              data-testid={`desk-ai-key-${p.id}`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function MarketIntelUserPrefs({ prefs, onChange }) {
  if (!prefs) return null;
  const toggleCat = (c) => {
    const cur = new Set(prefs.categories || []);
    if (cur.has(c)) cur.delete(c);
    else cur.add(c);
    onChange({ categories: Array.from(cur) });
  };
  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-2 text-xs" data-testid="mi-user-prefs">
      <div className="font-semibold text-slate-800">Your Market Intelligence</div>
      {[
        ["page_enabled", "Show this page"],
        ["popup_enabled", "Very important news popup"],
        ["show_critical", "Show critical"],
        ["show_high", "Show high impact"],
        ["show_moderate", "Show moderate"],
      ].map(([k, lab]) => (
        <label key={k} className="flex items-center gap-2">
          <input type="checkbox" checked={!!prefs[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
          {lab}
        </label>
      ))}
      <label className="flex items-center gap-2">Popup min impact
        <input type="number" className="w-16 h-7 border rounded-sm px-1" value={prefs.popup_min_impact ?? 90} onChange={(e) => onChange({ popup_min_impact: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">Popup min India
        <input type="number" className="w-16 h-7 border rounded-sm px-1" value={prefs.popup_min_india ?? 70} onChange={(e) => onChange({ popup_min_india: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">UI refresh (sec)
        <input type="number" className="w-16 h-7 border rounded-sm px-1" min={60} max={1800} value={prefs.ui_poll_seconds ?? 120} onChange={(e) => onChange({ ui_poll_seconds: Number(e.target.value) })} />
      </label>
      <div className="flex flex-wrap gap-1">
        {MI_CATS.map((c) => (
          <button key={c} type="button" onClick={() => toggleCat(c)} className={`px-2 py-0.5 rounded-sm border text-[10px] ${(prefs.categories || []).includes(c) ? "bg-emerald-50 border-emerald-300" : "border-slate-200"}`}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
