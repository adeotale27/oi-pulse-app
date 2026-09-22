import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toast } from "sonner";

const GROUPS = ["GLOBAL INDICES", "FX / FOREX", "COMMODITIES", "CRYPTO", "MACRO"];

export default function GlobalMarketsSettings({ active }) {
  const [items, setItems] = useState([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!active) return; api.get("/global-markets/config").then(({ data }) => setItems(data?.items || [])).catch(() => toast.error("Could not load Global Markets configuration")); }, [active]);
  const groups = useMemo(() => Object.fromEntries(GROUPS.map((group) => [group, items.filter((item) => item.category === group)])), [items]);
  const patch = (id, next) => setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...next } : item));
  const setGroup = (category, enabled) => setItems((previous) => previous.map((item) => item.category === category ? { ...item, enabled } : item));
  const save = async () => { setBusy(true); try { const { data } = await api.post("/global-markets/config", { instruments: items.map(({ id, enabled, providerSymbol }) => ({ id, enabled, providerSymbol })) }); setItems(data?.items || []); window.dispatchEvent(new Event("global-markets-config-saved")); toast.success("Global Markets saved"); } catch (e) { toast.error(e?.response?.data?.detail || "Could not save Global Markets"); } finally { setBusy(false); } };
  return <section className="space-y-3 pt-2" data-testid="global-market-settings"><div><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Global Markets</div><p className="mt-1 text-xs text-slate-500">Every quote is opt-in. Turn a whole category off to remove that component from the desk and stop its polling. Edit a provider symbol only if your data provider documents a different valid symbol.</p></div>{GROUPS.map((category) => groups[category]?.length ? <div key={category} className="rounded-md border border-slate-200"><div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2"><span className="text-[11px] font-semibold tracking-wide">{category}</span><label className="flex items-center gap-2 text-[11px] font-medium">Show category <Switch checked={groups[category].some((item) => item.enabled)} onCheckedChange={(enabled) => setGroup(category, !!enabled)} /></label></div><div className="divide-y">{groups[category].map((item) => <div key={item.id} className="grid grid-cols-[auto_minmax(8rem,1fr)_minmax(7rem,1fr)] items-center gap-2 px-3 py-2"><Switch checked={!!item.enabled} onCheckedChange={(enabled) => patch(item.id, { enabled: !!enabled })} aria-label={`Show ${item.displaySymbol}`} /><div className="min-w-0 text-xs"><b>{item.displaySymbol}</b><div className="truncate text-[10px] text-slate-500">{item.displayName}</div></div><Input className="h-7 font-mono-data text-[11px]" value={item.providerSymbol || ""} onChange={(event) => patch(item.id, { providerSymbol: event.target.value })} aria-label={`${item.displaySymbol} provider symbol`} /></div>)}</div></div> : null)}<Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Global Markets"}</Button></section>;
}
