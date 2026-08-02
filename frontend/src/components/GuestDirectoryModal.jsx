import { useState } from "react";
import { api } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

const IST = "Asia/Kolkata";
const timeIST = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) { return "—"; }
};
const dateIST = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short" });
  } catch (_) { return "—"; }
};

const fmtIdle = (s) => {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export default function GuestDirectoryModal({ open, onOpenChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sinceHours, setSinceHours] = useState(24);

  const load = async (hours = sinceHours) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/auth/guests?since_hours=${hours}`);
      setRows(data.guests || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load guest directory");
    } finally { setLoading(false); }
  };

  // Quiescent-aware guest directory refresh
  useQuiescentAwarePolling(() => load(sinceHours), 15_000, [open, sinceHours], { immediate: true });

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="guest-directory-modal" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" /> Guest Directory
          </DialogTitle>
          <DialogDescription>
            Everyone who&apos;s accessed the app via Public Access. Auto-refreshes every 15 seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Show last:</span>
            {[
              { h: 6, l: "6h" },
              { h: 24, l: "24h" },
              { h: 72, l: "3d" },
              { h: 168, l: "7d" },
            ].map((o) => (
              <button
                key={o.h}
                data-testid={`guest-dir-since-${o.h}h`}
                onClick={() => setSinceHours(o.h)}
                className={`px-2 py-0.5 rounded-sm border ${sinceHours === o.h ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              <b className="text-emerald-700">{activeCount}</b> active · <b>{rows.length}</b> total
            </span>
            <Button
              data-testid="guest-dir-refresh"
              variant="outline" size="sm"
              onClick={() => load(sinceHours)} disabled={loading}
              className="h-7 rounded-sm"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Time In (IST)</th>
                <th className="text-left px-3 py-2">Last Seen (IST)</th>
                <th className="text-left px-3 py-2">Idle</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-xs">
                  {loading ? "Loading…" : "No guests in the selected window."}
                </td></tr>
              ) : rows.map((g, i) => (
                <tr key={g.started_at + ":" + i} className={g.active ? "bg-emerald-50/50" : ""}>
                  <td className="px-3 py-2 font-medium">{g.name}</td>
                  <td className="px-3 py-2 text-slate-600 font-mono-data text-xs">
                    <span className="text-slate-400">{dateIST(g.started_at)}</span> {timeIST(g.started_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-600 font-mono-data text-xs">
                    <span className="text-slate-400">{dateIST(g.last_seen_at || g.started_at)}</span> {timeIST(g.last_seen_at || g.started_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-600 font-mono-data text-xs">{fmtIdle(g.idle_seconds)}</td>
                  <td className="px-3 py-2">
                    {g.active ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Online
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">Idle</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono-data text-xs">{g.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
