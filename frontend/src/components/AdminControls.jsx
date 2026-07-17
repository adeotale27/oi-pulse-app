import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut } from "lucide-react";
import { toast } from "sonner";

/**
 * AdminControls — compact widget shown in the header.
 * Visible only when the client is signed in as admin.
 *  - Public Access toggle (auto-off at 3:30 PM IST — enforced server-side).
 *  - Logout button.
 */
export default function AdminControls() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (!state?.is_admin) return null;

  const togglePublic = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/public-access", { open: !state.public_access_open });
      toast.success(
        data.open
          ? `Public access ON — expires at 3:30 PM IST`
          : `Public access OFF`,
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (_) { /* ignore */ }
    localStorage.removeItem("oi_admin_token");
    toast.success("Signed out");
    // Hard reload so AuthGate re-evaluates cleanly.
    window.location.reload();
  };

  return (
    <div
      className="flex items-center gap-2 pr-2 mr-1 border-r border-slate-200 dark:border-slate-700"
      data-testid="admin-controls"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <Users className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-slate-500">Public</span>
        <Switch
          data-testid="admin-public-toggle"
          checked={!!state.public_access_open}
          onCheckedChange={togglePublic}
          disabled={busy}
        />
      </div>
      <Button
        data-testid="admin-logout"
        variant="ghost"
        size="sm"
        onClick={logout}
        className="h-7 px-2 text-slate-500 hover:text-rose-600"
        title="Sign out"
      >
        <LogOut className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
