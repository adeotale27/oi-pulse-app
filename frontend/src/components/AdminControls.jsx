import { useEffect, useState, useCallback, useRef, useId } from "react";
import { api, clearAdminAuth } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut, KeyRound, UserCheck, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import AccessControlModal from "@/components/AccessControlModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Shared across inline + panel instances so we don't double-toast / double-open.
let sharedPrevPending = null;
let lastPendingAlertKey = null;
let lastPendingAlertAt = 0;

function openAccessControlEverywhere() {
  try {
    if (typeof window !== "undefined") window.__oi_access_open_pending = true;
    window.dispatchEvent(new CustomEvent("oi-admin-open-access"));
  } catch (_) { /* noop */ }
}

function broadcastAdminState(data) {
  try {
    window.dispatchEvent(new CustomEvent("oi-admin-auth-state", { detail: data }));
  } catch (_) { /* noop */ }
}

/**
 * AdminControls — Public Access toggle (+ account actions in panel variant).
 *
 * Inline header: compact one-line Public toggle only (no second "Admin" button —
 * Fresh Pull / Access Control / etc. live under Header's single Admin menu).
 *
 * Multiple instances share one /auth/state poller and one Access Control dialog.
 */
export default function AdminControls({
  variant = "inline",
  assumedAdmin = false,
  publicAccessOpen = null,
}) {
  const instanceId = useId();
  const [ownsModals, setOwnsModals] = useState(false);
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
  const [guestPages, setGuestPages] = useState([]);
  const prevPendingRef = useRef(null);
  const publicAccessOpenRef = useRef(publicAccessOpen);
  useEffect(() => {
    publicAccessOpenRef.current = publicAccessOpen;
  }, [publicAccessOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const claim = () => {
      if (!window.__oi_admin_modal_owner) {
        window.__oi_admin_modal_owner = instanceId;
      }
      setOwnsModals(window.__oi_admin_modal_owner === instanceId);
    };
    claim();
    const onVacate = () => claim();
    window.addEventListener("oi-admin-modal-vacate", onVacate);
    return () => {
      window.removeEventListener("oi-admin-modal-vacate", onVacate);
      if (window.__oi_admin_modal_owner === instanceId) {
        delete window.__oi_admin_modal_owner;
        try {
          window.dispatchEvent(new CustomEvent("oi-admin-modal-vacate"));
        } catch (_) { /* noop */ }
      }
    };
  }, [instanceId]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
      broadcastAdminState(data);
    } catch (_) {
      if (assumedAdmin) {
        const fallback = {
          is_admin: true,
          public_access_open: !!publicAccessOpenRef.current,
          pending_access_count: 0,
        };
        setState((prev) => prev || fallback);
      }
    }
  }, [assumedAdmin]);

  // Pending guests: poll a bit faster. Otherwise 15s — was 3s and spammed /auth/state
  // (3 AdminControls mounts share one owner, but still ~20 calls/min in Network).
  const pendingCount = Number(state?.pending_access_count || 0);
  const authPollMs = pendingCount > 0 || accessOpen ? 5_000 : 15_000;

  // One shared poller; every instance also listens for broadcasts.
  useQuiescentAwarePolling(refresh, authPollMs, [refresh, authPollMs], {
    immediate: true,
    allowDuringQuiescent: true,
    dedupeKey: "admin-controls-auth-state",
  });

  useEffect(() => {
    const onState = (e) => {
      if (e?.detail && typeof e.detail === "object") setState(e.detail);
    };
    window.addEventListener("oi-admin-auth-state", onState);
    return () => window.removeEventListener("oi-admin-auth-state", onState);
  }, []);

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
          description: "Approve or reject in Access Control — guest enters automatically when approved.",
          duration: 14_000,
          action: {
            label: "Review",
            onClick: () => openAccessControlEverywhere(),
          },
        });
        openAccessControlEverywhere();
      }
    }
    sharedPrevPending = pending;
    prevPendingRef.current = pending;
  }, [state?.is_admin, state?.pending_access_count, assumedAdmin]);

  useEffect(() => {
    const onQueue = (e) => {
      const n = Number(e?.detail?.pending_count);
      if (!Number.isFinite(n)) return;
      setState((prev) => {
        if (!prev) return prev;
        if (Number(prev.pending_access_count || 0) === n) return prev;
        return { ...prev, pending_access_count: n };
      });
      sharedPrevPending = n;
      prevPendingRef.current = n;
    };
    window.addEventListener("oi-access-queue-updated", onQueue);
    return () => window.removeEventListener("oi-access-queue-updated", onQueue);
  }, []);

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

  // Header Admin menu / toast "Review" open the single owned modal.
  useEffect(() => {
    if (!ownsModals) return undefined;
    if (typeof window !== "undefined" && window.__oi_access_open_pending) {
      window.__oi_access_open_pending = false;
      setAccessOpen(true);
    }
    if (typeof window !== "undefined" && window.__oi_password_open_pending) {
      window.__oi_password_open_pending = false;
      setPwOpen(true);
    }
    const onAccess = () => setAccessOpen(true);
    const onPassword = () => setPwOpen(true);
    window.addEventListener("oi-admin-open-access", onAccess);
    window.addEventListener("oi-admin-open-password", onPassword);
    return () => {
      window.removeEventListener("oi-admin-open-access", onAccess);
      window.removeEventListener("oi-admin-open-password", onPassword);
    };
  }, [ownsModals]);

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
  const openAccess = () => openAccessControlEverywhere();

  const loadGuestPages = async () => {
    try {
      const { data } = await api.get("/settings");
      setGuestPages(Array.isArray(data?.visible_pages) ? data.visible_pages : []);
    } catch (_) { /* ignore */ }
  };

  const toggleGuestPage = async (id, on) => {
    try {
      const current = await api.get("/settings");
      const cur = new Set(Array.isArray(current.data?.visible_pages) ? current.data.visible_pages : guestPages);
      if (on) cur.add(id);
      else cur.delete(id);
      cur.add("index-events");
      const { data } = await api.post("/settings", { visible_pages: Array.from(cur) });
      const pages = Array.isArray(data?.visible_pages) ? data.visible_pages : Array.from(cur);
      setGuestPages(pages);
      window.dispatchEvent(new CustomEvent("oi-settings-saved", { detail: data || { visible_pages: pages } }));
      toast.success(on ? "Shown to guests" : "Admin-only for now");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update guest pages");
    }
  };

  const publicToggle = (
    <div
      className={
        isPanel
          ? "flex flex-row flex-nowrap items-center justify-between w-full gap-2"
          : "inline-flex flex-row flex-nowrap items-center gap-2 h-8 shrink-0 whitespace-nowrap"
      }
      data-testid="admin-public-row"
    >
      <Popover onOpenChange={(open) => { if (open) loadGuestPages(); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex flex-row flex-nowrap items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-800"
            data-testid="admin-public-pages-trigger"
            title="Guest pages: Positions connect, Sell Candidates"
          >
            <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            Public
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3 space-y-2" data-testid="admin-public-pages-menu">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Show to guests</div>
          <p className="text-[11px] text-slate-600 leading-snug">
            Public access ON/OFF stays on this row. These switches only choose extra pages.
          </p>
          {[
            { id: "positions", label: "Positions · Connect Zerodha" },
            { id: "sell-candidates", label: "Sell Candidates" },
          ].map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 text-[12px] text-slate-800">
              <span>{p.label}</span>
              <Switch
                checked={guestPages.includes(p.id)}
                onCheckedChange={(on) => toggleGuestPage(p.id, on)}
                data-testid={`guest-page-${p.id}`}
                className="scale-90"
              />
            </label>
          ))}
          <div className="text-[10px] text-slate-500">Index Risk is always on. Upload stamps stay admin-only.</div>
        </PopoverContent>
      </Popover>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${publicOn ? "text-emerald-600" : "text-slate-400"}`}>
        {publicOn ? "ON" : "OFF"}
      </span>
      <Switch
        data-testid="admin-public-toggle"
        checked={publicOn}
        onCheckedChange={togglePublic}
        disabled={busy}
      />
      {pending > 0 && (
        <button
          type="button"
          data-testid="admin-pending-badge"
          onClick={openAccess}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-200 animate-pulse"
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
            onClick={openAccess}
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
            onClick={() => {
              try {
                if (typeof window !== "undefined") window.__oi_password_open_pending = true;
                window.dispatchEvent(new CustomEvent("oi-admin-open-password"));
              } catch (_) {
                setPwOpen(true);
              }
            }}
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

      {ownsModals && (
        <>
          <AccessControlModal open={accessOpen} onOpenChange={setAccessOpen} />
          <ChangePasswordModal open={pwOpen} onOpenChange={setPwOpen} />
        </>
      )}
    </div>
  );
}
