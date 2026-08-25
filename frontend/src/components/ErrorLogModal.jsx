import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

function fmtTs(iso) {
  if (!iso) return "—";
  const s = String(iso).replace("T", " ").replace("Z", "");
  return s.slice(0, 19);
}

export default function ErrorLogModal({ open, onOpenChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api.get("/errors", { params: { limit: 80 }, timeout: 8000 });
      setRows(r.data?.errors || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load error log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="error-log-modal">
        <DialogHeader>
          <DialogTitle>Error log</DialogTitle>
          <DialogDescription>
            API, desk UI, and logger errors. Tokens are stripped. Same fingerprint within 5 minutes is counted, not duplicated.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 shrink-0">
          <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <span className="text-[11px] text-slate-500">{rows.length} shown</span>
        </div>
        {err ? <p className="text-[12px] text-rose-600">{err}</p> : null}
        <div className="overflow-auto rounded-md border border-slate-100 text-[11px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1">When (UTC)</th>
                <th className="text-left font-semibold px-2 py-1">Src</th>
                <th className="text-left font-semibold px-2 py-1">Kind</th>
                <th className="text-left font-semibold px-2 py-1">Message</th>
                <th className="text-right font-semibold px-2 py-1">n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-50 align-top">
                  <td className="px-2 py-1 whitespace-nowrap font-mono-data">{fmtTs(row.ts)}</td>
                  <td className="px-2 py-1">{row.source}</td>
                  <td className="px-2 py-1">{row.kind}</td>
                  <td className="px-2 py-1">
                    <div className="text-slate-800">{row.message}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[28rem]">{row.path}</div>
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
