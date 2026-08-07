import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut, KeyRound, ChevronDown, UserCheck } from "lucide-react";
import { toast } from "sonner";
import AccessControlModal from "@/components/AccessControlModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";

/**
 * AdminControls — compact widget shown in the header (admin only).
 *  - Public Access toggle (auto-off at configured market close IST server-side)
 *  - Admin menu: Access Control, Change Password, Sign out
 */
export default function AdminControls() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
    } catch (_) {
      // ignore
    }
  }, []);

  useQuiescentAwarePolling(refresh, 30_000, [refresh], { immediate: true, dedupeKey: "admin-controls" });

  useEffect(() => {
    if (!state?.is_admin) return;
    const logoutTimer = setTimeout(async () => {
      try { await api.post("/auth/logout"); } catch (_) {}
      sessionStorage.removeItem("oi_admin_token");
      toast.info("Admin session expired. Signed out.");
      window.location.reload();
    }, 420 * 60 * 1000);
    return () => clearTimeout(logoutTimer);
  }, [state?.is_admin]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (!e.target.closest?.("[data-admin-menu]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (!state?.is_admin) return null;

  const pending = Number(state.pending_access_count || 0);

  const togglePublic = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/public-access", {
        open: !state.public_access_open,
      });
      toast.success(
        data.open
          ? (data.expires_at
              ? `Public access ON — guests must be approved. Expires ${new Date(data.expires_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST`
              : "Public access ON — guests must be approved")
          : "Public access OFF — all guests signed out"
      );
      await refresh();
      if (data.open && pending === 0) {
        // Nudge admin toward Access Control when turning public on
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    try {
      const { clearAdminAuth } = await import("@/lib/api");
      clearAdminAuth({ clearRemember: true });
    } catch (_) {
      try {
        sessionStorage.removeItem("oi_admin_token");
        localStorage.removeItem("oi_admin_token");
        localStorage.removeItem("oi_admin_remember_token");
      } catch (_) {}
    }
    toast.success("Signed out.");
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

      {pending > 0 && (
        <button
          type="button"
          data-testid="admin-pending-badge"
          onClick={() => setAccessOpen(true)}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-200"
          title="Pending access requests"
        >
          {pending} request{pending === 1 ? "" : "s"}
        </button>
      )}

      <div className="relative" data-admin-menu>
        <Button
          data-testid="admin-menu-toggle"
          variant="ghost"
          size="sm"
          onClick={() => setMenuOpen((v) => !v)}
          className="h-7 px-2 text-slate-600 hover:text-slate-900"
          title="Admin menu"
        >
          Admin <ChevronDown className="w-3 h-3 ml-1" />
        </Button>

        {menuOpen && (
          <div
            data-testid="admin-menu"
            className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-sm shadow-md z-50 text-sm"
          >
            <button
              data-testid="admin-menu-guests"
              onClick={() => {
                setMenuOpen(false);
                setAccessOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Access Control
              {pending > 0 && (
                <span className="ml-auto text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5">{pending}</span>
              )}
            </button>

            <button
              data-testid="admin-menu-change-password"
              onClick={() => {
                setMenuOpen(false);
                setPwOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Change Password
            </button>

            <div className="border-t border-slate-100" />

            <button
              data-testid="admin-menu-logout"
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-rose-50 text-rose-700"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>

      <AccessControlModal open={accessOpen} onOpenChange={setAccessOpen} />
      <ChangePasswordModal open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
