import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toast } from "sonner";

const GROUPS = ["GLOBAL INDICES", "FX / FOREX", "COMMODITIES", "CRYPTO", "MACRO"];
const PROVIDERS = [
  { value: "twelve_data", label: "Twelve Data" },
  { value: "fmp", label: "Financial Modeling Prep" },
];

const blankCustom = {
  displaySymbol: "",
  displayName: "",
  category: "GLOBAL INDICES",
  provider: "twelve_data",
  providerSymbol: "",
  enabled: true,
};

export default function GlobalMarketsSettings({ active }) {
  const [items, setItems] = useState([]); const [removed, setRemoved] = useState([]); const [prefs, setPrefs] = useState(null); const [enabled, setEnabled] = useState(true); const [fmpKey, setFmpKey] = useState(""); const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (!active) return;
    api.get("/global-markets/config").then(({ data }) => {
      setItems(data?.items || []);
      setPrefs(data?.prefs || null);
      setEnabled(data?.prefs?.enabled !== false);
      setFmpKey("");
      setRemoved([]);
    }).catch(() => toast.error("Could not load Global Markets configuration"));
  }, [active]);
  const categories = useMemo(() => [...new Set([...GROUPS, ...items.map((item) => item.category).filter(Boolean)])], [items]);
  const groups = useMemo(() => Object.fromEntries(categories.map((group) => [group, items.filter((item) => item.category === group)])), [categories, items]);
  const fmpSelected = useMemo(() => items.some((item) => item.enabled && item.provider === "fmp"), [items]);
  const patch = (id, next) => setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...next } : item));
  const setGroup = (category, enabled) => setItems((previous) => previous.map((item) => item.category === category ? { ...item, enabled } : item));
  const remove = (item) => {
    setItems((previous) => previous.filter((row) => row.id !== item.id));
    setRemoved((previous) => previous.some((row) => row.id === item.id) ? previous : [...previous, { id: item.id, remove: true }]);
  };
  const addCustom = () => {
    const symbol = custom.displaySymbol.trim();
    const providerSymbol = custom.providerSymbol.trim();
    if (!symbol || !custom.displayName.trim() || !providerSymbol) {
      toast.error("Add a display name, symbol, and provider symbol");
      return;
    }
    const id = `custom_${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${Date.now()}`;
    setItems((previous) => [...previous, { ...custom, id, displaySymbol: symbol, displayName: custom.displayName.trim(), providerSymbol }]);
    setCustom(null);
  };
  const save = async () => {
    setBusy(true);
    try {
      const payload = [...items.map(({ id, enabled, provider, providerSymbol, displaySymbol, displayName, category }) => ({
        id, enabled, provider, providerSymbol, displaySymbol, displayName, category,
      })), ...removed];
      const { data } = await api.post("/global-markets/config", { instruments: payload, enabled, ...(fmpKey.trim() ? { fmp_api_key: fmpKey.trim() } : {}) });
      setItems(data?.items || []);
      setPrefs(data?.prefs || prefs);
      setFmpKey("");
      setRemoved([]);
      setEnabled(data?.prefs?.enabled !== false);
      window.dispatchEvent(new CustomEvent("global-markets-config-saved", { detail: { enabled: data?.prefs?.enabled !== false } }));
      toast.success("Global Markets saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save Global Markets"); } finally { setBusy(false); }
  };
  const testFmp = async () => {
    setTesting(true);
    try {
      if (fmpKey.trim()) {
        const { data: saved } = await api.post("/global-markets/config", {
          instruments: items.map(({ id, enabled, provider, providerSymbol, displaySymbol, displayName, category }) => ({
            id, enabled, provider, providerSymbol, displaySymbol, displayName, category,
          })),
          fmp_api_key: fmpKey.trim(),
        });
        setItems(saved?.items || items);
        setPrefs(saved?.prefs || prefs);
        setFmpKey("");
        window.dispatchEvent(new CustomEvent("global-markets-config-saved", { detail: { enabled: saved?.prefs?.enabled !== false } }));
      }
      const { data } = await api.post("/global-markets/test");
      if (data?.ok) toast.success(data.message || "FMP connection is working");
      else toast.error(data?.error || "FMP connection failed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "FMP connection failed");
    } finally { setTesting(false); }
  };
  const setGlobalMarketsEnabled = async (enabled) => {
    setBusy(true);
    try {
      const payload = items.map(({ id, enabled: itemEnabled, provider, providerSymbol, displaySymbol, displayName, category }) => ({ id, enabled: itemEnabled, provider, providerSymbol, displaySymbol, displayName, category }));
      const { data } = await api.post("/global-markets/config", { instruments: payload, enabled });
      const persistedEnabled = data?.prefs?.enabled === true;
      setEnabled(persistedEnabled);
      setPrefs(data?.prefs || { ...prefs, enabled: persistedEnabled });
      window.dispatchEvent(new CustomEvent("global-markets-config-saved", { detail: { enabled: persistedEnabled } }));
      toast.success(persistedEnabled ? "Global Markets enabled" : "Global Markets disabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update Global Markets");
    } finally { setBusy(false); }
  };
  return <section className="space-y-3 pt-2" data-testid="global-market-settings">
    <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Global Markets</div><p className="mt-1 text-xs text-slate-500">Choose a provider for each instrument. Every quote is opt-in; edit the provider symbol only when the provider documents a different valid symbol. You can add a custom market or remove an entry such as TOTAL2.</p></div><label className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700"><Switch checked={enabled} disabled={busy} onCheckedChange={(next) => { setEnabled(!!next); setGlobalMarketsEnabled(!!next); }} />Use Global Markets</label></div>
    {categories.map((category) => groups[category]?.length ? <div key={category} className="rounded-md border border-slate-200"><div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2"><span className="text-[11px] font-semibold tracking-wide">{category}</span><label className="flex items-center gap-2 text-[11px] font-medium">Show category <Switch checked={groups[category].some((item) => item.enabled)} onCheckedChange={(enabled) => setGroup(category, !!enabled)} /></label></div><div className="divide-y">{groups[category].map((item) => <div key={item.id} className="grid grid-cols-[auto_minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(7rem,1fr)_auto] items-center gap-2 px-3 py-2"><Switch checked={!!item.enabled} onCheckedChange={(enabled) => patch(item.id, { enabled: !!enabled })} aria-label={`Show ${item.displaySymbol}`} /><div className="min-w-0 text-xs"><b>{item.displaySymbol}</b><div className="truncate text-[10px] text-slate-500">{item.displayName}</div></div>{item.id === "gift_nifty" ? <div className="text-[10px] font-semibold text-emerald-700">Built-in Kite feed</div> : <><select className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px]" value={item.provider || "twelve_data"} onChange={(event) => patch(item.id, { provider: event.target.value })} aria-label={`${item.displaySymbol} provider`}>{PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select><Input className="h-7 font-mono-data text-[11px]" value={item.providerSymbol || ""} onChange={(event) => patch(item.id, { providerSymbol: event.target.value })} aria-label={`${item.displaySymbol} provider symbol`} /></>}<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-slate-500" onClick={() => remove(item)} aria-label={`Remove ${item.displaySymbol}`}>Remove</Button></div>)}</div></div> : null)}
    <div className="rounded-md border border-slate-200 p-3 space-y-2"><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Financial Modeling Prep</div><p className="text-xs text-slate-500">Configure FMP before enabling instruments assigned to it. The key is write-only and is never displayed.</p><p className="text-[10px] leading-4 text-slate-500">Only enabled instruments assigned to FMP can trigger FMP requests. If no enabled instrument uses FMP, no FMP quote call is made.</p><div className="flex items-center gap-2"><Input type="password" autoComplete="off" className="h-8 font-mono text-xs" placeholder="Leave blank to keep current key" aria-label="FMP API key" value={fmpKey} onChange={(e) => setFmpKey(e.target.value)} /><span className="text-[11px] text-slate-500 whitespace-nowrap">{prefs?.fmp_api_key_configured ? "Configured" : "Not configured"}</span></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={testing || !fmpSelected} onClick={testFmp}>{testing ? "Testing…" : "Test FMP connection"}</Button><span className="self-center text-[10px] text-slate-500">{fmpSelected ? "Uses a safe FMP quote check." : "Assign at least one enabled instrument to FMP first."}</span></div></div>
    {custom ? <div className="rounded-md border border-dashed border-slate-300 p-3 space-y-2"><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Add custom instrument</div><div className="grid grid-cols-2 gap-2"><Input placeholder="Display symbol" aria-label="Custom display symbol" value={custom.displaySymbol} onChange={(e) => setCustom({ ...custom, displaySymbol: e.target.value })} /><Input placeholder="Display name" aria-label="Custom display name" value={custom.displayName} onChange={(e) => setCustom({ ...custom, displayName: e.target.value })} /><select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" aria-label="Custom category" value={custom.category} onChange={(e) => setCustom({ ...custom, category: e.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select><select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" aria-label="Custom provider" value={custom.provider} onChange={(e) => setCustom({ ...custom, provider: e.target.value })}>{PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select><Input className="font-mono-data text-xs" placeholder="Provider symbol" aria-label="Custom provider symbol" value={custom.providerSymbol} onChange={(e) => setCustom({ ...custom, providerSymbol: e.target.value })} /></div><div className="flex gap-2"><Button type="button" size="sm" onClick={addCustom}>Add instrument</Button><Button type="button" size="sm" variant="ghost" onClick={() => setCustom(null)}>Cancel</Button></div></div> : <Button type="button" size="sm" variant="outline" onClick={() => setCustom({ ...blankCustom })}>Add custom instrument</Button>}
    <Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Global Markets"}</Button>
  </section>;
}
