import { useState } from "react";
import { api } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, Users, ShieldBan, UserCheck, LogOut } from "lucide-react";
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

/**
 * AccessControlModal — admin security console:
 *   Pending requests (approve/reject)
 *   Active / recent guests (kick + block IP)
 *   Blocked IPs (unblock)
 */
export default function AccessControlModal({ open, onOpenChange }) {
  const [tab, setTab] = useState("pending"); // pending | guests | blocked
  const [requests, setRequests] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [guests, setGuests] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sinceHours, setSinceHours] = useState(24);
  const [busyId, setBusyId] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [reqRes, guestRes, blockRes] = await Promise.all([
        api.get("/auth/access-requests"),
        api.get(`/auth/guests?since_hours=${sinceHours}`),
        api.get("/auth/blocked-ips"),
      ]);
      setRequests(reqRes.data.requests || []);
      setPendingCount(reqRes.data.pending_count || 0);
      setGuests(guestRes.data.guests || []);
      setBlocked(blockRes.data.blocked || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load access control");
    } finally {
      setLoading(false);
    }
  };

  useQuiescentAwarePolling(
    () => { if (open) return loadAll(); },
    8_000,
    [open, sinceHours],
    { immediate: true, dedupeKey: "access-control" },
  );

  const approve = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/auth/access-requests/${id}/approve`);
      toast.success("Access approved — guest can enter now");
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Approve failed");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/auth/access-requests/${id}/reject`);
      toast.info("Request rejected");
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reject failed");
    } finally {
      setBusyId(null);
    }
  };

  const kick = async (token, name) => {
    setBusyId(token);
    try {
      await api.post(`/auth/guests/${encodeURIComponent(token)}/revoke`);
      toast.success(`Removed ${name || "guest"}`);
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kick failed");
    } finally {
      setBusyId(null);
    }
  };

  const blockIp = async (ip, name) => {
    if (!ip) {
      toast.error("No IP on this session");
      return;
    }
    setBusyId(ip);
    try {
      const { data } = await api.post("/auth/blocked-ips", {
        ip,
        reason: name ? `Blocked after session: ${name}` : "admin_block",
      });
      toast.success(`Blocked ${ip} · ${data.sessions_revoked || 0} session(s) removed`);
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Block failed");
    } finally {
      setBusyId(null);
    }
  };

  const unblockIp = async (ip) => {
    setBusyId(ip);
    try {
      await api.delete(`/auth/blocked-ips/${encodeURIComponent(ip)}`);
      toast.success(`Unblocked ${ip}`);
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unblock failed");
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = guests.filter((r) => r.active).length;
  const pendingRows = requests.filter((r) => r.status === "pending");

  const tabs = [
    { id: "pending", label: "Requests", count: pendingCount },
    { id: "guests", label: "In app", count: activeCount },
    { id: "blocked", label: "Blocked", count: blocked.length },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="access-control-modal" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-4 h-4" /> Access Control
          </DialogTitle>
          <DialogDescription>
            Approve guest requests, remove anyone currently in the app, and block IPs. Public Access must be ON to approve.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 pb-2 flex-wrap">
          <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`access-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === t.id
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1 text-[10px] ${
                    t.id === "pending" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button
            data-testid="access-control-refresh"
            variant="outline"
            size="sm"
            onClick={loadAll}
            disabled={loading}
            className="h-7 rounded-sm"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {tab === "pending" && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Requested</th>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400 text-xs">
                      {loading ? "Loading…" : "No pending access requests."}
                    </td>
                  </tr>
                ) : pendingRows.map((r) => (
                  <tr key={r.request_id} className="bg-amber-50/40">
                    <td className="px-3 py-2.5 font-medium">{r.name}</td>
                    <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                      <span className="text-slate-400">{dateIST(r.created_at)}</span> {timeIST(r.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 font-mono text-xs">{r.ip || "—"}</td>
                    <td className="px-3 py-2.5 text-right space-x-1.5">
                      <Button
                        data-testid={`access-approve-${r.request_id}`}
                        size="sm"
                        className="h-7 bg-emerald-600 hover:bg-emerald-700"
                        disabled={busyId === r.request_id}
                        onClick={() => approve(r.request_id)}
                      >
                        Approve
                      </Button>
                      <Button
                        data-testid={`access-reject-${r.request_id}`}
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busyId === r.request_id}
                        onClick={() => reject(r.request_id)}
                      >
                        Reject
                      </Button>
                      {r.ip && (
                        <Button
                          data-testid={`access-block-req-${r.request_id}`}
                          size="sm"
                          variant="outline"
                          className="h-7 text-rose-700 border-rose-200 hover:bg-rose-50"
                          disabled={busyId === r.ip}
                          onClick={() => blockIp(r.ip, r.name)}
                        >
                          Block IP
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "guests" && (
          <>
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
                    type="button"
                    data-testid={`guest-dir-since-${o.h}h`}
                    onClick={() => setSinceHours(o.h)}
                    className={`px-2 py-0.5 rounded-sm border ${sinceHours === o.h ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500">
                <b className="text-emerald-700">{activeCount}</b> online · <b>{guests.length}</b> total
              </span>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Time In</th>
                    <th className="text-left px-3 py-2">Idle</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">IP</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {guests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-xs">
                        {loading ? "Loading…" : "No guests in the selected window."}
                      </td>
                    </tr>
                  ) : guests.map((g) => (
                    <tr key={g.token || `${g.started_at}:${g.name}`} className={g.active ? "bg-emerald-50/50" : g.revoked_at ? "opacity-60" : ""}>
                      <td className="px-3 py-2 font-medium">{g.name}</td>
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">
                        <span className="text-slate-400">{dateIST(g.started_at)}</span> {timeIST(g.started_at)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">{fmtIdle(g.idle_seconds)}</td>
                      <td className="px-3 py-2">
                        {g.revoked_at ? (
                          <span className="text-[11px] text-rose-600">Removed</span>
                        ) : g.active ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Online
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Idle</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-xs">{g.ip || "—"}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        {!g.revoked_at && g.token && (
                          <Button
                            data-testid={`guest-kick-${g.token.slice(0, 8)}`}
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={busyId === g.token}
                            onClick={() => kick(g.token, g.name)}
                          >
                            <LogOut className="w-3 h-3 mr-1" /> Remove
                          </Button>
                        )}
                        {g.ip && (
                          <Button
                            data-testid={`guest-block-${g.ip}`}
                            size="sm"
                            variant="outline"
                            className="h-7 text-rose-700 border-rose-200 hover:bg-rose-50"
                            disabled={busyId === g.ip}
                            onClick={() => blockIp(g.ip, g.name)}
                          >
                            <ShieldBan className="w-3 h-3 mr-1" /> Block
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "blocked" && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">Name hint</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Blocked</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {blocked.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400 text-xs">
                      {loading ? "Loading…" : "No blocked IPs."}
                    </td>
                  </tr>
                ) : blocked.map((b) => (
                  <tr key={b.ip}>
                    <td className="px-3 py-2 font-mono text-xs">{b.ip}</td>
                    <td className="px-3 py-2 text-sm">{b.name_hint || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{b.reason || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {dateIST(b.blocked_at)} {timeIST(b.blocked_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        data-testid={`unblock-ip-${b.ip}`}
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busyId === b.ip}
                        onClick={() => unblockIp(b.ip)}
                      >
                        Unblock
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Keep old name as alias for any lingering imports
export { AccessControlModal as GuestDirectoryModal };
