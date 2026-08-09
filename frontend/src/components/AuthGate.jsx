import { useEffect, useState, useRef } from "react";
import { Navigate, Link } from "react-router-dom";
import { api, clearGuestAuth, clearAdminAuth, persistGuestAuth, persistAdminSession } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import AuthShell from "@/components/AuthShell";

/**
 * AuthGate — three modes:
 *   1. Admin login (default when public access is closed)
 *   2. Guest name prompt (when public access is open but caller has no guest token)
 *   3. Pass-through (admin or guest already authenticated)
 *
 * Returning guests (same IP + previously approved name) are auto-admitted.
 * Admin Remember-me restores via /auth/remember-login. Admin is NOT kicked at
 * market close unless Settings → expire_admin_on_market_close is explicitly ON.
 */
export default function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, requires_login: true, is_admin: false, is_guest: false, needs_guest_name: false });
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(() => {
    try {
      const id = sessionStorage.getItem("oi_access_request_id");
      const name = sessionStorage.getItem("oi_access_request_name");
      return id ? { id, name: name || "" } : null;
    } catch (_) {
      return null;
    }
  });
  const [waitStatus, setWaitStatus] = useState(null); // pending | rejected | null
  const lastActivityRef = useRef(Date.now());
  const pendingPollRef = useRef(null);
  const autoGuestRef = useRef(false);

  const refresh = async () => {
    try {
      // Strip stale localStorage admin tokens — they blocked Remember-me forever.
      try {
        const staleLocal = localStorage.getItem("oi_admin_token");
        const sessTok = sessionStorage.getItem("oi_admin_token");
        if (staleLocal && !sessTok) localStorage.removeItem("oi_admin_token");
      } catch (_) { /* noop */ }

      const rememberTok = (() => {
        try { return localStorage.getItem("oi_admin_remember_token"); } catch (_) { return null; }
      })();
      // Only skip remember when we already have a *session* token.
      const hasSessionAdmin = (() => {
        try { return !!sessionStorage.getItem("oi_admin_token"); } catch (_) { return false; }
      })();
      if (rememberTok && !hasSessionAdmin) {
        try {
          const { data: rem } = await api.post("/auth/remember-login", { remember_token: rememberTok });
          if (rem?.token) {
            persistAdminSession(rem.token);
          }
        } catch (err) {
          // Soft IP/UA mismatch or expired — only drop token on hard expiry/invalid
          const detail = String(err?.response?.data?.detail || "");
          if (/expired|invalid|missing/i.test(detail)) {
            try { localStorage.removeItem("oi_admin_remember_token"); } catch (_) {}
          }
        }
      }

      const { data } = await api.get("/auth/state");

      // Returning guest on same IP — auto-login without a click.
      if (
        data?.auto_guest_token &&
        !data.is_admin &&
        !data.is_guest &&
        !autoGuestRef.current
      ) {
        autoGuestRef.current = true;
        persistGuestAuth({
          token: data.auto_guest_token,
          name: data.auto_guest_name || data.suggested_guest_name || "",
          expiresInSeconds: data.auto_guest_expires_in,
          expiresAt: data.auto_guest_expires_at,
        });
        clearAdminAuth({ clearRemember: false });
        toast.success(`Welcome back, ${data.auto_guest_name || data.suggested_guest_name || "guest"}`);
        // Re-fetch so is_guest is true with the new header token.
        const { data: again } = await api.get("/auth/state");
        setState({ loading: false, ...again });
        return;
      }

      if (data.requires_login && !data.is_admin) {
        clearGuestAuth();
      }
      if (!data.is_guest && !data.is_admin) {
        if (!data.public_access_open) clearGuestAuth();
      }
      if (data.suggested_guest_name) {
        setGuestName((prev) => prev || data.suggested_guest_name);
      }
      setState({ loading: false, ...data });
    } catch (_) {
      setState({ loading: false, requires_login: true, is_admin: false, is_guest: false, needs_guest_name: false });
    }
  };

  // Attach activity listeners for idle-timeout independent of polling
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("mousemove", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("click", bump);
    return () => {
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("click", bump);
    };
  }, []);

  // Auth must keep working after EOD.
  useQuiescentAwarePolling(refresh, 60_000, [], {
    immediate: true,
    allowDuringQuiescent: true,
    dedupeKey: "auth-gate",
  });

  // Absolute session TTL logout for admin (matches backend created_at + ttl).
  // Does NOT call /auth/logout (that would wipe Remember-me for this IP).
  useEffect(() => {
    if (!state.is_admin) return;
    const ttl = (state.session_ttl_seconds || 8 * 3600) * 1000;
    const check = setInterval(() => {
      if (Date.now() - lastActivityRef.current > ttl) {
        toast.info("Signed out — session timed out.");
        clearAdminAuth({ clearRemember: false });
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(check);
  }, [state.is_admin, state.session_ttl_seconds]);

  // Market-close admin logout — ONLY when Settings explicitly enables it.
  useEffect(() => {
    if (!state.is_admin) return;
    if (!state.expire_admin_on_market_close) return;
    if (!state.admin_session_expires_at) return;
    const expMs = Date.parse(state.admin_session_expires_at);
    if (Number.isNaN(expMs)) return;
    const now = Date.now();
    if (expMs <= now) {
      toast.info("Signed out — market closed.");
      clearAdminAuth({ clearRemember: false });
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => {
      toast.info("Signed out — market closed.");
      clearAdminAuth({ clearRemember: false });
      window.location.reload();
    }, Math.min(expMs - now, 2147483000));
    return () => clearTimeout(timer);
  }, [state.is_admin, state.admin_session_expires_at, state.expire_admin_on_market_close]);

  const admitGuest = async (token, name, expiresIn, expiresAt) => {
    clearAdminAuth({ clearRemember: false });
    persistGuestAuth({ token, name: name || "", expiresInSeconds: expiresIn, expiresAt });
    try {
      sessionStorage.removeItem("oi_access_request_id");
      sessionStorage.removeItem("oi_access_request_name");
    } catch (_) {}
    setPendingRequest(null);
    setWaitStatus(null);
    toast.success(`Welcome, ${name || "guest"}`);
    await refresh();
  };

  // Poll pending access request until admin decides.
  useEffect(() => {
    if (!pendingRequest?.id || state.is_guest || state.is_admin) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get(`/auth/access-request/${pendingRequest.id}`);
        if (cancelled) return;
        if ((data.status === "approved" || data.status === "consumed") && data.token) {
          await admitGuest(data.token, data.name || pendingRequest.name, data.expires_in_seconds, data.expires_at);
          return;
        }
        if (data.status === "consumed" && !data.token) {
          // Approved earlier but token already claimed — clear wait state.
          try {
            sessionStorage.removeItem("oi_access_request_id");
            sessionStorage.removeItem("oi_access_request_name");
          } catch (_) {}
          setPendingRequest(null);
          setWaitStatus(null);
          toast.message("Already approved — enter your name again if you were signed out.");
          return;
        }
        if (data.status === "rejected") {
          setWaitStatus("rejected");
          try {
            sessionStorage.removeItem("oi_access_request_id");
            sessionStorage.removeItem("oi_access_request_name");
          } catch (_) {}
          toast.error("Access request was rejected by the admin.");
          setPendingRequest(null);
          return;
        }
        setWaitStatus("pending");
      } catch (_) {
        // keep waiting; request may be briefly unavailable
      }
    };
    poll();
    pendingPollRef.current = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      if (pendingPollRef.current) clearInterval(pendingPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequest?.id, state.is_guest, state.is_admin]);

  const doGuest = async (e) => {
    e?.preventDefault();
    const name = guestName.trim();
    if (name.length < 2 || !name.includes(" ")) {
      toast.error("Please enter your FULL name (first name + last name).");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/guest", { name });
      // Returning guest — minted immediately (already approved for this IP + name).
      if (data?.token) {
        await admitGuest(data.token, data.name || name, data.expires_in_seconds, data.expires_at);
        return;
      }
      // New flow: pending until admin approves.
      if (data?.status === "pending" && data.request_id) {
        try {
          sessionStorage.setItem("oi_access_request_id", data.request_id);
          sessionStorage.setItem("oi_access_request_name", data.name || name);
        } catch (_) {}
        setPendingRequest({ id: data.request_id, name: data.name || name });
        setWaitStatus("pending");
        toast.message("Request sent", { description: "Waiting for admin approval…" });
        return;
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "Could not request access";
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#061018]">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (state.ip_blocked && !state.is_admin) {
    return (
      <AuthShell mode="guest">
        <div
          data-testid="guest-ip-blocked"
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-900 shadow-2xl"
        >
          <OiPulseLogo className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-xl font-semibold">Unable to process request</h1>
          <p className="mt-2 text-sm text-slate-600">
            Unable to process request at this moment.
          </p>
        </div>
      </AuthShell>
    );
  }

  // Admin always passes. Guest only while public access remains open.
  if (state.is_admin) return children;
  if (state.is_guest && state.public_access_open) return children;
  // Stale guest token after public access closed → force login/guest prompt
  if (state.is_guest && !state.public_access_open) {
    clearGuestAuth();
  }

  // Public access open → prompt for guest full name
  if (state.needs_guest_name || state.public_access_open) {
    return (
      <AuthShell mode="guest">
        <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-7 text-slate-900 shadow-2xl shadow-black/40 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <OiPulseLogo className="h-11 w-11" />
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Guest access</h2>
              <p className="text-sm text-slate-500">Request read-only entry to the desk</p>
            </div>
          </div>

          <form onSubmit={doGuest} className="space-y-4" data-testid="guest-form">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-slate-500">Full name</Label>
              {state.suggested_guest_name ? (
                <p className="mb-1.5 text-xs text-emerald-700" data-testid="guest-welcome-back">
                  Welcome back — we remembered your name from this device.
                </p>
              ) : null}
              <Input
                data-testid="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                autoFocus
                disabled={!!pendingRequest}
                className="mt-1 h-11"
              />
            </div>

            {pendingRequest || waitStatus === "pending" ? (
              <div
                data-testid="guest-waiting-approval"
                className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"
              >
                <div className="font-semibold">Waiting for admin approval…</div>
                <div className="text-xs opacity-80">
                  Requested as <b>{pendingRequest?.name || guestName}</b>. Keep this window open — you&apos;ll enter automatically when approved.
                </div>
                <button
                  type="button"
                  className="pt-1 text-xs underline opacity-70 hover:opacity-100"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem("oi_access_request_id");
                      sessionStorage.removeItem("oi_access_request_name");
                    } catch (_) {}
                    setPendingRequest(null);
                    setWaitStatus(null);
                  }}
                >
                  Cancel request
                </button>
              </div>
            ) : (
              <Button
                data-testid="guest-submit"
                type="submit"
                className="h-11 w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                disabled={busy}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  {busy ? "Requesting…" : "Request access"}
                </span>
              </Button>
            )}

            <p className="text-center text-xs text-slate-500">
              New guests need admin approval. Returning guests on this network enter immediately when the same name was approved before.
            </p>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
            Admin?{" "}
            <Link to="/admin" className="font-medium text-emerald-700 hover:underline">
              Sign in here
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  // Default → redirect to dedicated admin login page
  return <Navigate to="/admin" replace />;
}