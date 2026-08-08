import { useEffect, useState, useCallback, useRef } from "react";
import { api, clearAdminAuth } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut, KeyRound, ChevronDown, UserCheck } from "lucide-react";
import { toast } from "sonner";
import AccessControlModal from "@/components/AccessControlModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";

// Shared across inline + panel instances so we don't double-toast / double-open.
let sharedPrevPending = null;
let lastPendingAlertKey = null;
let lastPendingAlertAt = 0;

/**
 * AdminControls — Public Access toggle + Admin menu.
 *
 * `assumedAdmin` — when parent (Header) already knows the user is admin,
 * render immediately instead of waiting on a second /auth/state fetch.
 * Critical on mobile Tools after market close (quiescent polling / dedupe
 * previously left this widget as null).
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const prevPendingRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
    } catch (_) {
      // keep assumedAdmin seed if the fetch fails while closed
      if (assumedAdmin) {
        setState((prev) => prev || {
          is_admin: true,
          public_access_open: !!publicAccessOpen,
          pending_access_count: 0,
        });
      }
    }
  }, [assumedAdmin, publicAccessOpen]);

  // Poll often while admin is in session so approval popups feel realtime.
  useQuiescentAwarePolling(refresh, 10_000, [refresh], {
    immediate: true,
    allowDuringQuiescent: true,
    dedupeKey: variant === "panel" ? "admin-controls-panel" : "admin-controls-inline",
  });

  // When a new access request arrives, toast + open Access Control for the admin.
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
    // Seed on first admin poll so we don't popup for already-pending on page load.
    sharedPrevPending = pending;
    prevPendingRef.current = pending;
  }, [state?.is_admin, state?.pending_access_count, assumedAdmin]);

  // Sync public flag from parent if we only have the seed state.
  useEffect(() => {
    if (publicAccessOpen == null) return;
    setState((prev) => {
      if (!prev?.is_admin) return prev;
      if (prev.public_access_open === !!publicAccessOpen) return prev;
      // Only seed when parent provided a definite value and we haven't fetched yet
      // or values drifted — prefer server state once refresh lands.
      return { ...prev, public_access_open: !!publicAccessOpen };
    });
  }, [publicAccessOpen]);

  useEffect(() => {
    if (!state?.is_admin) return undefined;
    // Soft client safety-net only — never call /auth/logout (that wipes Remember-me).
    const ttlMs = Math.max(60, Number(state.session_ttl_seconds || 8 * 3600)) * 1000;
    const logoutTimer = setTimeout(() => {
      clearAdminAuth({ clearRemember: false });
      toast.info("Admin session timed out. Signed out.");
      window.location.reload();
    }, ttlMs);
    return () => clearTimeout(logoutTimer);
  }, [state?.is_admin, state?.session_ttl_seconds]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (!e.target.closest?.("[data-admin-menu]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const isAdmin = !!(state?.is_admin || assumedAdmin);
  if (!isAdmin) {
    if (assumedAdmin) {
      // Shouldn't happen — seed above — but never blank the Tools panel.
    } else {
      return null;
    }
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

  const isPanel = variant === "panel";

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
      <div className={`flex items-center gap-2 text-xs ${isPanel ? "justify-between w-full" : ""}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-600 dark:text-slate-300 font-medium truncate">Public access</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
      </div>

      {pending > 0 && (
        <button
          type="button"
          data-testid="admin-pending-badge"
          onClick={() => setAccessOpen(true)}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-200 self-start"
          title="Pending access requests"
        >
          {pending} request{pending === 1 ? "" : "s"}
        </button>
      )}

      <div className={`relative ${isPanel ? "w-full" : ""}`} data-admin-menu>
        <Button
          data-testid="admin-menu-toggle"
          variant={isPanel ? "outline" : "ghost"}
          size="sm"
          onClick={() => setMenuOpen((v) => !v)}
          className={isPanel ? "w-full justify-between h-9" : "h-7 px-2 text-slate-600 hover:text-slate-900"}
          title="Admin menu"
        >
          <span>Admin</span> <ChevronDown className="w-3 h-3 ml-1" />
        </Button>

        {menuOpen && (
          <div
            data-testid="admin-menu"
            className={`absolute ${isPanel ? "left-0 right-0" : "right-0"} top-full mt-1 ${isPanel ? "w-full" : "w-52"} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-sm shadow-md z-[60] text-sm`}
          >
            <button
              data-testid="admin-menu-guests"
              onClick={() => {
                setMenuOpen(false);
                setAccessOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
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
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Change Password
            </button>

            <div className="border-t border-slate-100 dark:border-slate-800" />

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
