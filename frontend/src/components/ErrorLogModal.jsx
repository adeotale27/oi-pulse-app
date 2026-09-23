import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { errorSourceLabel, notifyErrorLogUnseenChanged } from "@/lib/errorLog";
import { toast } from "sonner";

const HIDDEN_SOURCES_KEY = "oiHiddenErrorSources";
function readHiddenSources() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_SOURCES_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  } catch { return []; }
}

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch { return "—"; }
}

function fmtDay(iso) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

export default function ErrorLogModal({ open, onOpenChange, initialSource = "" }) {
  const [rows, setRows] = useState([]);
  const [sources, setSources] = useState([]);
  const [srcFilter, setSrcFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [stored, setStored] = useState(0);
  const [oldest, setOldest] = useState(null);
  const [newest, setNewest] = useState(null);
  const [purgeDays, setPurgeDays] = useState(1);
  const [hiddenSources, setHiddenSources] = useState(readHiddenSources);
  const [hideMenuOpen, setHideMenuOpen] = useState(false);

  const applyMeta = (data) => {
    if (typeof data?.stored === "number") setStored(data.stored);
    setOldest(data?.oldest || null);
    setNewest(data?.newest || null);
  };

  const load = async (source = srcFilter, hidden = hiddenSources) => {
    setLoading(true);
    setErr("");
    try {
      const params = { limit: 80 };
      if (source) params.source = source;
      if (hidden.length) params.hide_sources = hidden.join(",");
      const r = await api.get("/errors", { params, timeout: 8000 });
      setRows(r.data?.errors || []);
      applyMeta(r.data);
      const nextSrc = Array.isArray(r.data?.sources) ? r.data.sources.filter(Boolean) : [];
      setSources(nextSrc);
      if (source && nextSrc.length && !nextSrc.includes(source)) setSrcFilter("");
      try {
        const seen = await api.post("/errors/mark-seen", {}, { timeout: 8000 });
        notifyErrorLogUnseenChanged(seen.data?.unseen ?? 0);
      } catch {
        notifyErrorLogUnseenChanged(0);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load error log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const source = initialSource || srcFilter;
    if (source !== srcFilter) setSrcFilter(source);
    load(source);
  }, [open, initialSource]);

  const pickSrc = (src) => {
    setSrcFilter(src);
    load(src);
  };

  const toggleHiddenSource = (src) => {
    const next = hiddenSources.includes(src)
      ? hiddenSources.filter((item) => item !== src)
      : [...hiddenSources, src];
    setHiddenSources(next);
    try { localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify(next)); } catch { /* noop */ }
    load(srcFilter, next);
  };

  const flushAll = async () => {
    if (!window.confirm("Delete every stored error from the database?")) return;
    try {
      const r = await api.post("/errors/flush", {}, { timeout: 15000 });
      applyMeta(r.data);
      setRows([]);
      notifyErrorLogUnseenChanged(0);
      toast.success(`Flushed ${r.data?.deleted ?? 0} errors`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Flush failed");
    }
  };

  const purgeOldest = async () => {
    const days = Math.max(1, parseInt(purgeDays, 10) || 1);
    if (!window.confirm(`Delete errors from ${fmtDay(oldest)} for the first ${days} day(s)?`)) return;
    try {
      const r = await api.post("/errors/purge", null, { params: { days }, timeout: 15000 });
      toast.success(`Deleted ${r.data?.deleted ?? 0} · ${r.data?.stored ?? 0} remaining`);
      await load(srcFilter);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(76vw,52rem)] w-[76vw] max-md:w-[calc(100vw-1rem)] max-md:max-w-none h-[min(88dvh,48rem)] max-h-[88dvh] overflow-hidden flex flex-col sm:rounded-lg"
        data-testid="error-log-modal"
      >
        <DialogHeader>
          <DialogTitle>Error log</DialogTitle>
          <DialogDescription className="whitespace-normal break-words">
            API, desk UI, and logger errors. Tokens are stripped. Same fingerprint within 5 minutes is counted, not duplicated.
          </DialogDescription>
        </DialogHeader>
        <div className="text-[11px] text-slate-600 whitespace-normal break-words" data-testid="error-log-stats">
          Stored in Mongo <code>error_logs</code>: <b>{stored}</b> records
          {oldest ? <> from {fmtDay(oldest)} to {fmtDay(newest)}</> : null}.
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <Button type="button" size="sm" variant="outline" onClick={() => load(srcFilter)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <span className="text-[11px] text-slate-500">{rows.length} shown</span>
          <Button
            type="button"
            size="sm"
            variant={srcFilter ? "outline" : "default"}
            className="h-7 px-2 text-[11px]"
            data-testid="error-src-all"
            onClick={() => pickSrc("")}
          >
            All
          </Button>
          {sources.map((src) => (
            <Button
              key={src}
              type="button"
              size="sm"
              variant={srcFilter === src ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              data-testid={`error-src-${src}`}
              onClick={() => pickSrc(src)}
            >
              {errorSourceLabel(src)}
            </Button>
          ))}
          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant={hiddenSources.length ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              data-testid="error-hide-sources"
              onClick={() => setHideMenuOpen((value) => !value)}
              aria-expanded={hideMenuOpen}
            >
              {hideMenuOpen ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              Hide sources{hiddenSources.length ? ` (${hiddenSources.length})` : ""}
            </Button>
            {hideMenuOpen ? (
              <div className="absolute left-0 top-8 z-50 max-h-64 min-w-52 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Hide from this log</div>
                {sources.length ? sources.map((src) => (
                  <label key={src} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50">
                    <Checkbox checked={hiddenSources.includes(src)} onCheckedChange={() => toggleHiddenSource(src)} />
                    <span>{errorSourceLabel(src)}</span>
                  </label>
                )) : <div className="px-1 py-1 text-[11px] text-slate-400">No sources found</div>}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 text-[11px]">
          <span>Delete from {fmtDay(oldest)}</span>
          <input
            type="number"
            min={1}
            className="h-7 w-14 border rounded-sm px-1"
            value={purgeDays}
            onChange={(e) => setPurgeDays(e.target.value)}
            data-testid="error-purge-days"
            disabled={!oldest}
          />
          <span>days</span>
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={!oldest} onClick={purgeOldest} data-testid="error-purge">
            Delete range
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-rose-700" onClick={flushAll} data-testid="error-flush">
            Flush all
          </Button>
        </div>
        {err ? <p className="text-[12px] text-rose-600 whitespace-normal break-words">{err}</p> : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-100 text-[11px]" data-testid="error-log-scroll">
          <table className="w-full min-w-[42rem] table-fixed">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1 w-[9.5rem]">When (IST)</th>
                <th className="text-left font-semibold px-2 py-1 w-24">Src</th>
                <th className="text-left font-semibold px-2 py-1 w-36">Kind</th>
                <th className="text-left font-semibold px-2 py-1">Message</th>
                <th className="text-right font-semibold px-2 py-1 w-10">n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-50 align-top">
                  <td className="px-2 py-1 font-mono-data whitespace-normal break-words">{fmtTs(row.ts)}</td>
                  <td className="px-2 py-1 whitespace-normal break-words">{row.source}</td>
                  <td className="px-2 py-1 whitespace-normal break-words">{row.kind}</td>
                  <td className="px-2 py-1">
                    <div className="text-slate-800 whitespace-pre-wrap break-words">{row.message}</div>
                    <div className="text-[10px] text-slate-400 whitespace-normal break-words">{row.path}</div>
                  </td>
                  <td className="px-2 py-1 text-right font-mono-data">{row.count || 1}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && !err ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-slate-400">
                    No stored errors yet
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
