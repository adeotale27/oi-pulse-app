import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorSourceLabel, notifyErrorLogUnseenChanged } from "@/lib/errorLog";

function fmtTs(iso) {
  if (!iso) return "—";
  const s = String(iso).replace("T", " ").replace("Z", "");
  return s.slice(0, 19);
}

export default function ErrorLogModal({ open, onOpenChange }) {
  const [rows, setRows] = useState([]);
  const [sources, setSources] = useState([]);
  const [srcFilter, setSrcFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async (source = srcFilter) => {
    setLoading(true);
    setErr("");
    try {
      const params = { limit: 80 };
      if (source) params.source = source;
      const r = await api.get("/errors", { params, timeout: 8000 });
      setRows(r.data?.errors || []);
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
    if (open) load(srcFilter);
  }, [open]);

  const pickSrc = (src) => {
    setSrcFilter(src);
    load(src);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92dvh] max-h-[92dvh] overflow-hidden flex flex-col sm:rounded-lg" data-testid="error-log-modal">
        <DialogHeader>
          <DialogTitle>Error log</DialogTitle>
          <DialogDescription>
            API, desk UI, and logger errors. Tokens are stripped. Same fingerprint within 5 minutes is counted, not duplicated.
          </DialogDescription>
        </DialogHeader>
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
        </div>
        {err ? <p className="text-[12px] text-rose-600">{err}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md border border-slate-100 text-[11px]">
          <table className="w-full table-fixed">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1 w-[9.5rem]">When (UTC)</th>
                <th className="text-left font-semibold px-2 py-1 w-24">Src</th>
                <th className="text-left font-semibold px-2 py-1 w-36">Kind</th>
                <th className="text-left font-semibold px-2 py-1">Message</th>
                <th className="text-right font-semibold px-2 py-1 w-10">n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-50 align-top">
                  <td className="px-2 py-1 whitespace-nowrap font-mono-data">{fmtTs(row.ts)}</td>
                  <td className="px-2 py-1 break-all">{row.source}</td>
                  <td className="px-2 py-1 break-all">{row.kind}</td>
                  <td className="px-2 py-1">
                    <div className="text-slate-800 whitespace-pre-wrap break-words">{row.message}</div>
                    <div className="text-[10px] text-slate-400 break-all">{row.path}</div>
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
