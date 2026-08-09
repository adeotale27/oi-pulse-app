import { useEffect, useState, useCallback, useRef } from "react";
import { api, clearAdminAuth } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut, KeyRound, UserCheck } from "lucide-react";
import { toast } from "sonner";
import AccessControlModal from "@/components/AccessControlModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";

// Shared across inline + panel instances so we don't double-toast / double-open.
let sharedPrevPending = null;
let lastPendingAlertKey = null;
let lastPendingAlertAt = 0;

/**
 * AdminControls — Public Access toggle (+ account actions in panel variant).
 *
 * Inline header: compact one-line Public toggle only (no second "Admin" button —
 * Fresh Pull / Access Control / etc. live under Header's single Admin menu).
 */
export default function AdminControls({
  variant = "inline",
  assumedAdmin = false,
  publicAccessOpen = null,
}) {
  const [state, setState] = useState(() => (
    assumedAdmin
      ? {
          is_admin: true,
          public_access_open: !!publicAccessOpen,
          pending_access_count: 0,
        }
      : null
  ));
  const [busy, setBusy] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const prevPendingRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
    } catch (_) {
      if (assumedAdmin) {
        setState((prev) => prev || {
          is_admin: true,
          public_access_open: !!publicAccessOpen,
          pending_access_count: 0,
        });
      }
    }
  }, [assumedAdmin, publicAccessOpen]);

  useQuiescentAwarePolling(refresh, 10_000, [refresh], {
    immediate: true,
    allowDuringQuiescent: true,
    dedupeKey: variant === "panel" ? "admin-controls-panel" : "admin-controls-inline",
  });

  useEffect(() => {
    if (!state?.is_admin && !assumedAdmin) return;
    const pending = Number(state?.pending_access_count || 0);
    const prev = sharedPrevPending ?? prevPendingRef.current;
    if (prev != null && pending > prev) {
      const alertKey = `${prev}->${pending}`;
      const now = Date.now();
      const already =
        lastPendingAlertKey === alertKey && now - lastPendingAlertAt < 4000;
      if (!already) {
        lastPendingAlertKey = alertKey;
        lastPendingAlertAt = now;
        const delta = pending - prev;
        toast.message(delta === 1 ? "New guest access request" : `${delta} new guest access requests`, {
          description: "Open Access Control to approve or reject.",
          duration: 12_000,
          action: {
            label: "Review",
            onClick: () => setAccessOpen(true),
          },
        });
        setAccessOpen(true);
      }
    }
    sharedPrevPending = pending;
    prevPendingRef.current = pending;
  }, [state?.is_admin, state?.pending_access_count, assumedAdmin]);

  useEffect(() => {
    if (publicAccessOpen == null) return;
    setState((prev) => {
      if (!prev?.is_admin) return prev;
      if (prev.public_access_open === !!publicAccessOpen) return prev;
      return { ...prev, public_access_open: !!publicAccessOpen };
    });
  }, [publicAccessOpen]);

  useEffect(() => {
    if (!state?.is_admin) return undefined;
    const ttlMs = Math.max(60, Number(state.session_ttl_seconds || 8 * 3600)) * 1000;
    const logoutTimer = setTimeout(() => {
      clearAdminAuth({ clearRemember: false });
      toast.info("Admin session timed out. Signed out.");
      window.location.reload();
    }, ttlMs);
    return () => clearTimeout(logoutTimer);
  }, [state?.is_admin, state?.session_ttl_seconds]);

  // Header Admin menu can open these modals without a second "Admin" button.
  useEffect(() => {
    const onAccess = () => setAccessOpen(true);
    const onPassword = () => setPwOpen(true);
    window.addEventListener("oi-admin-open-access", onAccess);
    window.addEventListener("oi-admin-open-password", onPassword);
    return () => {
      window.removeEventListener("oi-admin-open-access", onAccess);
      window.removeEventListener("oi-admin-open-password", onPassword);
    };
  }, []);

  const isAdmin = state ? !!state.is_admin : !!assumedAdmin;
  if (!isAdmin) {
    return null;
  }

  const publicOn = !!(state?.public_access_open);
  const pending = Number(state?.pending_access_count || 0);

  const togglePublic = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/public-access", {
        open: !publicOn,
      });
      toast.success(
        data.open
          ? (data.expires_at
              ? `Public access ON — guests must be approved. Expires ${new Date(data.expires_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST`
              : "Public access ON — guests must be approved")
          : "Public access OFF — all guests signed out"
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    try {
      const { clearAdminAuth: clear } = await import("@/lib/api");
      clear({ clearRemember: true });
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

  const isPanel = variant === "panel";

  const publicToggle = (
    <div
      className={
        isPanel
          ? "flex flex-row items-center justify-between w-full gap-2"
          : "flex items-center gap-1.5 h-8 shrink-0"
      }
      data-testid="admin-public-row"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap">
          Public
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${publicOn ? "text-emerald-600" : "text-slate-400"}`}>
          {publicOn ? "ON" : "OFF"}
        </span>
        <Switch
          data-testid="admin-public-toggle"
          checked={publicOn}
          onCheckedChange={togglePublic}
          disabled={busy}
        />
      </div>
      {pending > 0 && (
        <button
          type="button"
          data-testid="admin-pending-badge"
          onClick={() => setAccessOpen(true)}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-200"
          title="Pending access requests"
        >
          {pending}
        </button>
      )}
    </div>
  );

  return (
    <div
      className={
        isPanel
          ? "flex flex-col gap-3 w-full p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
          : "flex items-center gap-2 pr-2 mr-1 border-r border-slate-200 dark:border-slate-700"
      }
      data-testid="admin-controls"
      data-variant={variant}
    >
      {publicToggle}

      {isPanel && (
        <div className="flex flex-col gap-1.5 w-full">
          <Button
            data-testid="admin-menu-guests"
            variant="outline"
            size="sm"
            className="w-full justify-start h-9"
            onClick={() => setAccessOpen(true)}
          >
            <UserCheck className="w-3.5 h-3.5 mr-2" />
            Access Control
            {pending > 0 && (
              <span className="ml-auto text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5">{pending}</span>
            )}
          </Button>
          <Button
            data-testid="admin-menu-change-password"
            variant="outline"
            size="sm"
            className="w-full justify-start h-9"
            onClick={() => setPwOpen(true)}
          >
            <KeyRound className="w-3.5 h-3.5 mr-2" />
            Change Password
          </Button>
          <Button
            data-testid="admin-menu-logout"
            variant="outline"
            size="sm"
            className="w-full justify-start h-9 text-rose-700 hover:text-rose-800"
            onClick={logout}
          >
            <LogOut className="w-3.5 h-3.5 mr-2" />
            Sign out
          </Button>
        </div>
      )}

      <AccessControlModal open={accessOpen} onOpenChange={setAccessOpen} />
      <ChangePasswordModal open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
