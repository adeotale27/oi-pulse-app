import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, apiDetail, INDEX_ADMIN_TIMEOUT_MS } from "@/lib/api";
import { toast } from "sonner";
import { Layers, Plus, RefreshCw, Search } from "lucide-react";

const MCX_MAJORS = [
  { id: "CRUDEOIL", label: "Crude oil" },
  { id: "GOLD", label: "Gold" },
  { id: "SILVER", label: "Silver" },
  { id: "NATURALGAS", label: "Nat. gas" },
];

function Cap({ ok, label }) {
  return (
    <div className="flex items-center justify-between text-[12px] py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className={ok ? "text-emerald-700 font-semibold" : "text-rose-600 font-semibold"}>
        {ok ? "✓" : "✕"}
      </span>
    </div>
  );
}

export default function IndexManagementModal({ open, onOpenChange, onChanged }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [results, setResults] = useState([]);
  const [inspect, setInspect] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const loadList = useCallback(async () => {
    const { data } = await api.get("/admin/indices");
    setList(data.indices || []);
    setSyncedAt(data.synced_at || null);
  }, []);

  useEffect(() => {
    if (!open) return;
    setInspect(null);
    setResults([]);
    setQ("");
    loadList().catch((e) => toast.error(apiDetail(e, "Could not load indices")));
  }, [open, loadList]);

  const search = async () => {
    setSearching(true);
    try {
      const { data } = await api.get("/admin/indices/search", {
        params: { q, limit: 40 },
        timeout: INDEX_ADMIN_TIMEOUT_MS,
      });
      setResults(data.results || []);
      if (data.synced_at) setSyncedAt(data.synced_at);
    } catch (e) {
      toast.error(apiDetail(e, "Search failed — is Kite connected?"));
    } finally {
      setSearching(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/indices/sync", null, { timeout: INDEX_ADMIN_TIMEOUT_MS });
      toast.success(`Synced ${data.count || 0} underlyings from Kite`);
      await loadList();
      if (q) await search();
    } catch (e) {
      toast.error(apiDetail(e, "Sync failed"));
    } finally {
      setBusy(false);
    }
  };

  const openInspect = async (name) => {
    setBusy(true);
    try {
      const { data } = await api.get("/admin/indices/inspect", { params: { name }, timeout: INDEX_ADMIN_TIMEOUT_MS });
      setInspect(data);
    } catch (e) {
      toast.error(apiDetail(e, "Inspect failed"));
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (!inspect?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/indices/${encodeURIComponent(inspect.id)}/enable`, null, { timeout: INDEX_ADMIN_TIMEOUT_MS });
      toast.success(`${inspect.id} enabled — OI poll will include it`);
      setInspect((p) => (p ? { ...p, enabled: true } : p));
      await loadList();
      onChanged?.();
    } catch (e) {
      toast.error(apiDetail(e, "Enable failed"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (name) => {
    setBusy(true);
    try {
      await api.post(`/admin/indices/${encodeURIComponent(name)}/disable`, null, { timeout: INDEX_ADMIN_TIMEOUT_MS });
      toast.success(`${name} hidden from the desk (history kept)`);
      if (inspect?.id === name) setInspect((p) => (p ? { ...p, enabled: false } : p));
      await loadList();
      onChanged?.();
    } catch (e) {
      toast.error(apiDetail(e, "Disable failed"));
    } finally {
      setBusy(false);
    }
  };

  const caps = inspect?.capabilities || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0" data-testid="index-management-modal">
        <DialogHeader className="px-4 py-3 border-b border-slate-200">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Layers className="w-4 h-4 text-emerald-600" />
            Index management
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-500">
            Discover Kite F&amp;O names, check CE/PE OI, then enable. NIFTY / SENSEX / BANKNIFTY stay as they are.
            MCX majors: CRUDEOIL, GOLD, SILVER, NATURALGAS (not the minis). ATM from nearest FUT.
            {syncedAt ? ` Dump ${new Date(syncedAt).toLocaleString("en-IN")}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-2 flex gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              className="h-8 pl-7 text-[13px]"
              placeholder="Search indices…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              data-testid="index-search"
            />
          </div>
          <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={search} disabled={searching}>
            Search
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={sync} disabled={busy} title="Refresh Kite dump">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">On the desk</div>
            <div className="space-y-1">
              {list.map((idx) => (
                <div
                  key={idx.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                >
                  <button type="button" className="flex-1 text-left" onClick={() => openInspect(idx.id)}>
                    <div className="text-[13px] font-semibold text-slate-800">{idx.display_name || idx.id}</div>
                    <div className="text-[10px] text-slate-400">
                      {idx.exchange || "—"} · {idx.enabled ? "ENABLED" : "off"}
                    </div>
                  </button>
                  {idx.enabled ? (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => disable(idx.id)}>
                      Disable
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-emerald-700" disabled={busy} onClick={() => openInspect(idx.id)}>
                      Inspect
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Discover</div>
              <span className="text-[10px] text-slate-400 inline-flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Add index
              </span>
            </div>
            {results.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[12px] text-slate-400">Search Kite names, or inspect an MCX major:</p>
                <div className="flex flex-wrap gap-1.5">
                  {MCX_MAJORS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-800"
                      onClick={() => openInspect(m.id)}
                      data-testid={`mcx-major-${m.id}`}
                    >
                      {m.label}
                      <span className="ml-1 text-[10px] font-mono text-slate-400">{m.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50"
                    onClick={() => openInspect(r.id)}
                    data-testid={`index-hit-${r.id}`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-[13px] font-semibold">{r.id}</span>
                      <span className="text-[10px] text-slate-400">{r.exchange}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {r.capabilities?.optionOI ? "OI ✓" : "OI ✕"} · {r.capabilities?.futures ? "FUT ✓" : "FUT ✕"} · {r.expiry_count || 0} expiries
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {inspect ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3" data-testid="index-inspect">
              <div className="text-[15px] font-bold text-slate-900">{inspect.id}</div>
              <div className="text-[11px] text-slate-500 mb-2">
                {inspect.exchange || "—"} · {inspect.quote_symbol || "no cash quote"} · step {inspect.step}
              </div>
              <Cap ok={caps.livePrice} label="Live price" />
              <Cap ok={caps.futures} label="Futures" />
              <Cap ok={caps.options} label="Options" />
              <Cap ok={caps.optionOI} label="OI analytics" />
              {inspect.hint ? <p className="mt-2 text-[11px] text-slate-600 leading-snug">{inspect.hint}</p> : null}
              {inspect.notes ? <p className="mt-2 text-[11px] text-rose-700">{inspect.notes}</p> : null}
              <div className="mt-3 flex gap-2">
                {inspect.can_enable_oi && !inspect.enabled ? (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={enable} data-testid="index-enable">
                    Enable index
                  </Button>
                ) : null}
                {inspect.enabled ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => disable(inspect.id)}>
                    Disable
                  </Button>
                ) : null}
                {!inspect.can_enable_oi ? (
                  <span className="text-[11px] text-slate-500 self-center">Cannot enable OI analytics</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
