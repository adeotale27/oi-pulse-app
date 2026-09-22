import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Search, ServerCog, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const STATUS = {
  healthy: "bg-emerald-500", warning: "bg-amber-400", failed: "bg-rose-500", unknown: "bg-slate-300",
};

function statusLabel(status) {
  return ({ healthy: "Healthy", warning: "Warning", failed: "Failed", unknown: "No telemetry yet" })[status] || "Unknown";
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString();
}

function fmtLatency(value) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "short" });
}

function sourceFor(provider) {
  if (provider.id === "twelve-data") return "adr";
  if (provider.id === "kite-connect") return "kite";
  if (provider.category === "News") return "market_intel";
  return "log";
}

function Metric({ label, value }) {
  return <div className="border-l border-slate-200 pl-2"><div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div><div className="font-mono-data text-xs font-semibold text-slate-800">{value}</div></div>;
}

export default function ApiConfigurationModal({ open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState("apis");
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await api.get("/external-api-registry", { timeout: 15000, params: { _: Date.now() } });
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load the external API registry");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => { if (!open) setSelected(null); }, [open]);

  const providers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.providers || []).filter((provider) => {
      if (category !== "all" && provider.category !== category) return false;
      if (status !== "all" && provider.status !== status) return false;
      const haystack = [provider.name, provider.category, ...provider.modules, ...provider.endpoints.flatMap((x) => [x.endpoint, ...x.modules, ...x.purposes])].join(" ").toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [data, query, category, status]);

  const moduleRows = useMemo(() => {
    const grouped = {};
    providers.forEach((provider) => provider.endpoints.forEach((endpoint) => endpoint.modules.forEach((module) => {
      const row = grouped[module] ||= { module, endpoints: [] };
      row.endpoints.push({ provider: provider.name, endpoint: endpoint.endpoint, purpose: endpoint.purposes.join(" ") });
    })));
    return Object.values(grouped).sort((a, b) => a.module.localeCompare(b.module));
  }, [providers]);

  const categories = [...new Set((data?.providers || []).map((p) => p.category))].sort();
  const summary = data?.summary || {};
  const viewErrors = (provider) => {
    window.dispatchEvent(new CustomEvent("oi-open-error-log", { detail: { source: sourceFor(provider) } }));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(92vw,74rem)] w-[92vw] max-md:w-[calc(100vw-1rem)] max-md:max-w-none h-[min(88dvh,52rem)] max-h-[88dvh] overflow-hidden flex flex-col sm:rounded-lg" data-testid="api-configuration-modal">
        {selected ? (
          <>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ServerCog className="w-4 h-4" />{selected.name}</DialogTitle><DialogDescription>{selected.category} · {selected.host} · {selected.auth}</DialogDescription></DialogHeader>
            <div className="flex items-center justify-between"><Button size="sm" variant="outline" onClick={() => setSelected(null)}><ArrowLeft className="w-3.5 h-3.5 mr-1" />All providers</Button><span className="inline-flex items-center gap-1.5 text-xs font-medium"><i className={`h-2 w-2 rounded-full ${STATUS[selected.status]}`} />{statusLabel(selected.status)}</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5"><Metric label="Requests today" value={fmtNumber(selected.requests_today)} /><Metric label="Errors today" value={fmtNumber(selected.errors_today)} /><Metric label="Average latency" value={fmtLatency(selected.avg_latency_ms)} /><Metric label="Endpoints" value={selected.endpoints.length} /></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => viewErrors(selected)}>View errors</Button><span className="text-[11px] text-slate-500 self-center">Errors open in the existing Error Log, filtered to this integration where a source is available.</span></div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[47rem] text-[11px]"><thead className="sticky top-0 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500"><tr><th className="text-left px-2 py-2">Endpoint</th><th className="text-left px-2 py-2">Used by / purpose</th><th className="text-right px-2 py-2">Requests</th><th className="text-right px-2 py-2">Errors</th><th className="text-right px-2 py-2">Latency</th><th className="text-left px-2 py-2">Status</th></tr></thead><tbody>
                {selected.endpoints.map((endpoint) => <tr key={`${endpoint.method}-${endpoint.endpoint}`} className="border-t border-slate-100 align-top"><td className="px-2 py-2 font-mono-data text-slate-800"><b>{endpoint.method}</b> {endpoint.endpoint}<div className="mt-1 text-[9px] text-slate-400">{endpoint.code_references.join(" · ")}</div></td><td className="px-2 py-2"><div className="font-medium">{endpoint.modules.join(" · ")}</div><div className="mt-0.5 text-slate-500">{endpoint.purposes.join(" ")}</div></td><td className="px-2 py-2 text-right font-mono-data">{fmtNumber(endpoint.requests_today)}</td><td className="px-2 py-2 text-right font-mono-data">{fmtNumber(endpoint.errors_today)}</td><td className="px-2 py-2 text-right font-mono-data">{fmtLatency(endpoint.avg_latency_ms)}</td><td className="px-2 py-2"><span className="inline-flex items-center gap-1"><i className={`h-1.5 w-1.5 rounded-full ${STATUS[endpoint.status]}`} />{statusLabel(endpoint.status)}</span><div className="mt-1 text-[9px] text-slate-400">Last: {fmtTime(endpoint.last_request)}</div></td></tr>)}
              </tbody></table>
            </div>
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ServerCog className="w-4 h-4" />API Configuration</DialogTitle><DialogDescription>Monitor external APIs discovered from the running StrikLenz codebase, their modules, exact routes, and safe request telemetry.</DialogDescription></DialogHeader>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200">{[["Providers", summary.providers], ["Endpoints", summary.endpoints], ["Modules", summary.modules], ["Active", summary.active], ["Healthy", summary.healthy], ["Warning", summary.warning], ["Errors today", summary.errors_today], ["Avg latency", fmtLatency(summary.avg_latency_ms)]].map(([label, value]) => <div key={label} className="bg-white px-2 py-2"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-0.5 font-mono-data text-sm font-bold text-slate-800">{value ?? "—"}</div></div>)}</div>
            <div className="flex flex-wrap items-center gap-2"><div className="relative flex-1 min-w-[12rem]"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search APIs, endpoints, modules…" className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-xs outline-none focus:border-emerald-500" /></div><select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="all">All categories</option>{categories.map((x) => <option key={x}>{x}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="all">All health</option><option value="healthy">Healthy</option><option value="warning">Warning</option><option value="failed">Failed</option><option value="unknown">No telemetry</option></select><Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "Loading…" : <><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</>}</Button></div>
            <div className="flex gap-1 border-b border-slate-200"><button className={`px-3 py-1.5 text-xs font-medium border-b-2 ${mode === "apis" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} onClick={() => setMode("apis")}>APIs</button><button className={`px-3 py-1.5 text-xs font-medium border-b-2 ${mode === "modules" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} onClick={() => setMode("modules")}>Modules</button></div>
            {error ? <div className="text-xs text-rose-600">{error}</div> : null}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
              {mode === "apis" ? <div className="divide-y divide-slate-100">{providers.map((provider) => <button key={provider.id} onClick={() => setSelected(provider)} className="w-full text-left px-3 py-2.5 hover:bg-emerald-50/50 transition-colors"><div className="flex items-start gap-2"><i className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS[provider.status]}`} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-800">{provider.name}</span><span className="text-[10px] text-slate-400">{provider.category}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500"><span>{provider.endpoints.length} endpoint{provider.endpoints.length === 1 ? "" : "s"}</span><span>{provider.modules.join(" · ")}</span><span>{fmtNumber(provider.requests_today)} requests today</span><span>{fmtLatency(provider.avg_latency_ms)}</span></div><div className="mt-1 font-mono-data text-[10px] text-slate-500 truncate">{provider.endpoints.map((x) => `${x.method} ${x.endpoint}`).join("  ·  ")}</div></div><ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" /></div></button>)}{!loading && providers.length === 0 ? <div className="p-8 text-center text-xs text-slate-400">No providers match these filters.</div> : null}</div> : <div className="divide-y divide-slate-100">{moduleRows.map((row) => <div key={row.module} className="px-3 py-2.5"><div className="text-xs font-semibold text-slate-800">{row.module}</div><div className="mt-1 space-y-1">{row.endpoints.map((endpoint, i) => <div key={`${endpoint.provider}-${endpoint.endpoint}-${i}`} className="text-[11px] text-slate-600"><b>{endpoint.provider}</b> <span className="font-mono-data">{endpoint.endpoint}</span> <span className="text-slate-400">— {endpoint.purpose}</span></div>)}</div></div>)}</div>}
            </div>
            <p className="text-[10px] text-slate-500">Telemetry begins after this version starts. It stores only provider, route, method, response code, duration and error class—never credentials, headers, request bodies or responses.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
