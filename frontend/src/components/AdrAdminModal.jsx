import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const blank = {
  company_name: "", indian_symbol: "", adr_symbol: "", exchange: "NYSE",
  sector: "IT", adr_ratio: "1:1", currency: "USD", provider_symbol: "",
  enabled: true, market_intelligence_enabled: true, notification_enabled: true,
};

export default function AdrAdminModal({ open, onOpenChange }) {
  const [prefs, setPrefs] = useState(null);
  const [items, setItems] = useState([]);
  const [keyDraft, setKeyDraft] = useState("");
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/adrs/config");
    setPrefs(data?.prefs || null);
    setItems(data?.items || []);
    setKeyDraft("");
  };

  useEffect(() => {
    if (!open) return;
    load().catch(() => toast.error("Could not load ADR config"));
  }, [open]);

  const savePrefs = async (patch) => {
    setBusy(true);
    try {
      const { data } = await api.post("/adrs/config", patch);
      setPrefs(data?.prefs || null);
      toast.success("ADR settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const test = async () => {
    try {
      const { data } = await api.post("/adrs/test");
      if (data?.ok) toast.success("Connected");
      else toast.error(data?.error || "Connection Failed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Connection Failed");
    }
  };

  const saveItem = async () => {
    setBusy(true);
    try {
      await api.post("/adrs/items", { ...form, provider_symbol: form.provider_symbol || form.adr_symbol });
      toast.success("ADR saved");
      setForm(blank);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save ADR");
    } finally { setBusy(false); }
  };

  if (!prefs && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent><DialogHeader><DialogTitle>ADRs</DialogTitle></DialogHeader><div className="text-sm text-slate-500">Loading…</div></DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="adr-admin-modal" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ADRs</DialogTitle>
          <DialogDescription>Twelve Data quotes for Indian ADRs. The API key stays in the vault and is never returned to the browser.</DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-md border p-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest">ADR Provider</div>
          <div className="text-xs">Provider: Twelve Data · Key: <span data-testid="adr-key-status">{prefs?.api_key_configured ? "Configured" : "Not Configured"}</span></div>
          <div>
            <Label className="text-xs">Replace API key</Label>
            <Input data-testid="adr-api-key" type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="Leave blank to keep current key" className="font-mono text-xs mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={prefs?.enabled !== false} onCheckedChange={(ck) => savePrefs({ enabled: !!ck })} />
            <span className="text-xs">Enabled</span>
          </div>
          <div>
            <Label className="text-xs">Polling interval (seconds)</Label>
            <Input type="number" min={60} max={3600} className="h-8 mt-1" value={prefs?.poll_interval_seconds ?? 300} onChange={(e) => setPrefs({ ...prefs, poll_interval_seconds: Number(e.target.value) })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
              const patch = { poll_interval_seconds: prefs.poll_interval_seconds };
              if (keyDraft.trim()) patch.api_key = keyDraft.trim();
              savePrefs(patch).then(() => setKeyDraft(""));
            }}>Save provider</Button>
            <Button type="button" size="sm" variant="outline" data-testid="adr-test-api" onClick={test}>Test API Connection</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => savePrefs({ discover: true }).then(load)}>Sync Indian ADRs</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => api.post("/adrs/poll").then(() => toast.success("Poll queued"))}>Poll now</Button>
          </div>
        </section>

        <section className="space-y-2 rounded-md border p-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest">Market Session</div>
          <p className="text-xs text-slate-600">US timezone America/New_York · 09:30–16:00 ET (DST automatic). Indian opening refresh 09:15 IST (one poll while US is closed).</p>
          <div className="flex items-center gap-2">
            <Switch checked={prefs?.indian_open_refresh !== false} onCheckedChange={(ck) => savePrefs({ indian_open_refresh: !!ck })} />
            <span className="text-xs">Indian opening refresh</span>
          </div>
        </section>

        <section className="space-y-2 rounded-md border p-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest">Alert Settings</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Large move %</Label>
              <Input type="number" step="0.1" className="h-8 mt-1" value={prefs?.large_move_threshold_percent ?? 5} onChange={(e) => setPrefs({ ...prefs, large_move_threshold_percent: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Banking threshold %</Label>
              <Input type="number" step="0.1" className="h-8 mt-1" value={prefs?.banking_move_threshold_percent ?? 5} onChange={(e) => setPrefs({ ...prefs, banking_move_threshold_percent: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={prefs?.notifications_enabled !== false} onCheckedChange={(ck) => savePrefs({ notifications_enabled: !!ck })} />
            <span className="text-xs">Notifications</span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => savePrefs({
            large_move_threshold_percent: prefs.large_move_threshold_percent,
            banking_move_threshold_percent: prefs.banking_move_threshold_percent,
          })}>Save alerts</Button>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest">ADR Universe</div>
          <div className="overflow-x-auto border rounded-sm text-[11px]">
            <table className="w-full">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  {["Company", "Indian", "ADR", "Exch", "Sector", "Ratio", "On", "MI", "Alerts", ""].map((h) => (
                    <th key={h} className="text-left px-2 py-1">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-2 py-1">{it.company_name}</td>
                    <td className="px-2 py-1 font-mono-data">{it.indian_symbol}</td>
                    <td className="px-2 py-1 font-mono-data">{it.adr_symbol}</td>
                    <td className="px-2 py-1">{it.exchange}</td>
                    <td className="px-2 py-1">{it.sector}</td>
                    <td className="px-2 py-1">{it.adr_ratio}</td>
                    <td className="px-2 py-1">{it.enabled ? "On" : "Off"}</td>
                    <td className="px-2 py-1">{it.market_intelligence_enabled ? "On" : "Off"}</td>
                    <td className="px-2 py-1">{it.notification_enabled ? "On" : "Off"}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button type="button" className="text-sky-700 mr-2" onClick={() => setForm(it)}>Edit</button>
                      <button type="button" className="text-slate-600 mr-2" onClick={() => api.post(`/adrs/items/${it.id}/toggle`).then(load)}>Enable/Disable</button>
                      <button type="button" className="text-rose-700" onClick={() => api.delete(`/adrs/items/${it.id}`).then(load)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {["company_name", "indian_symbol", "adr_symbol", "exchange", "sector", "adr_ratio"].map((k) => (
              <div key={k}>
                <Label className="text-xs capitalize">{k.replaceAll("_", " ")}</Label>
                <Input className="h-8 mt-1" value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`adr-form-${k}`} />
              </div>
            ))}
          </div>
          <Button type="button" size="sm" data-testid="adr-add" disabled={busy} onClick={saveItem}>+ Add ADR</Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
