import { useCallback, useEffect, useState } from "react";
import { api, apiDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MI_CATS } from "@/lib/marketIntel";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export default function DeskAiKeysModal({ open, onOpenChange }) {
  const [providers, setProviders] = useState([]);
  const [envFallback, setEnvFallback] = useState(false);
  const [form, setForm] = useState({ name: "", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "" });
  const [draftKeys, setDraftKeys] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/desk-ai/providers").then((r) => {
      setProviders(r.data?.providers || []);
      setEnvFallback(!!r.data?.env_fallback);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async (payload) => {
    setBusy(true);
    try {
      await api.post("/desk-ai/providers", payload);
      toast.success("Desk AI key saved");
      setForm((f) => ({ ...f, api_key: "" }));
      setDraftKeys({});
      load();
    } catch (e) {
      toast.error(apiDetail(e, "Could not save provider"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (p) => {
    const envOk = p.id === "openai" && envFallback;
    if (!p.has_key && !envOk) {
      toast.error("Add an API key for this provider (or set OPENAI_API_KEY for OpenAI) before making it Active.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/desk-ai/providers/${p.id}/select`);
      load();
    } catch (e) {
      toast.error(apiDetail(e, "Cannot activate — add a key first"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="desk-ai-keys-modal" className="max-w-lg max-h-[90dvh] overflow-y-auto w-[calc(100vw-1.25rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Desk AI keys
          </DialogTitle>
          <DialogDescription>
            Store an OpenAI-compatible key on the server (never in the browser). Env OPENAI_API_KEY is fallback for OpenAI only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3" data-testid="desk-ai-keys-admin">
          {envFallback ? (
            <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-sm px-2 py-1">OPENAI_API_KEY is set in env — OpenAI can be Active without a vaulted key.</p>
          ) : (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1">No env OpenAI key. Paste a key below, then Active.</p>
          )}
          <div className="space-y-2">
            {providers.map((p) => {
              const envOk = p.id === "openai" && envFallback;
              const canUse = p.has_key || envOk;
              return (
                <div key={p.id} className="rounded-md border border-slate-200 px-3 py-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{p.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{p.base_url} · {p.model} · {p.has_key ? "key saved" : envOk ? "env key" : "no key"}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={p.selected ? "default" : "outline"}
                      className="h-7 text-[11px]"
                      disabled={busy || (!canUse && !p.selected)}
                      onClick={() => activate(p)}
                      data-testid={`desk-ai-use-${p.id}`}
                    >
                      {p.selected ? "Active" : "Use"}
                    </Button>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      className="flex-1 h-8 text-xs border rounded-sm px-2"
                      placeholder={p.has_key ? "•••••••• — paste to replace" : "Paste API key"}
                      value={draftKeys[p.id] || ""}
                      onChange={(e) => setDraftKeys((d) => ({ ...d, [p.id]: e.target.value }))}
                      autoComplete="off"
                      data-testid={`desk-ai-key-${p.id}`}
                    />
                    <Button
                      size="sm"
                      className="h-8 text-[11px]"
                      disabled={busy || !(draftKeys[p.id] || "").trim()}
                      onClick={() => save({ id: p.id, name: p.name, base_url: p.base_url, model: p.model, api_key: (draftKeys[p.id] || "").trim(), select: true })}
                    >
                      Save key
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-md border border-dashed border-slate-300 p-3 space-y-2">
            <div className="text-[11px] font-semibold text-slate-700">Add provider (e.g. DeepSeek)</div>
            <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="desk-ai-new-name" />
            <input className="w-full h-8 text-xs border rounded-sm px-2 font-mono" placeholder="Base URL" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            <input className="w-full h-8 text-xs border rounded-sm px-2" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="w-full h-8 text-xs border rounded-sm px-2" type="password" placeholder="API key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} data-testid="desk-ai-new-key" />
            <Button size="sm" className="h-7" disabled={busy || !form.name || !form.api_key} onClick={() => save({ ...form, select: true })} data-testid="desk-ai-add-provider">Save &amp; use</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        ["page_enabled", "Show this page (ingest still runs if off)"],
        ["popup_enabled", "Very important news popup for me"],
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
