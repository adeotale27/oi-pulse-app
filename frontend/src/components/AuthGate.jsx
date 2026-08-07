import { useEffect, useState, useRef } from "react";
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, clearGuestAuth, clearAdminAuth } from "@/lib/api";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";

/**
 * AuthGate — three modes:
 *   1. Admin login (default when public access is closed)
 *   2. Guest name prompt (when public access is open but caller has no guest token)
 *   3. Pass-through (admin or guest already authenticated)
 *
 * Also handles 8h admin idle-timeout: on last activity, we don't touch the server;
 * the server rejects expired tokens on next call. Additionally, we schedule a
 * client-side auto-logout after ADMIN_SESSION_TTL_SECONDS of idle to be graceful.
 */
export default function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, requires_login: true, is_admin: false, is_guest: false, needs_guest_name: false });
  const [username, setUsername] = useState("Adeotale");
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);
  const lastActivityRef = useRef(Date.now());

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/state");
      // If public access closed and we're not admin, clear leftover guest tokens.
      if (data.requires_login && !data.is_admin) {
        clearGuestAuth();
      }
      if (!data.is_guest && !data.is_admin) {
        // Ensure stale guest identity isn't kept client-side after revoke.
        if (!data.public_access_open) clearGuestAuth();
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

  // Quiescent-aware refresh of auth state
  useQuiescentAwarePolling(refresh, 60_000, [], { immediate: true, dedupeKey: "auth-gate" });

  // Client-side 8h idle-logout for admin (matches backend TTL).
  useEffect(() => {
    if (!state.is_admin) return;
    const ttl = (state.session_ttl_seconds || 8 * 3600) * 1000;
    const check = setInterval(() => {
      if (Date.now() - lastActivityRef.current > ttl) {
        toast.info("Signed out — session timed out.");
        clearAdminAuth();
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(check);
  }, [state.is_admin, state.session_ttl_seconds]);

  // Hard auto-logout for admin at 3:30 PM IST (backend also enforces this).
  useEffect(() => {
    if (!state.is_admin || !state.admin_session_expires_at) return;
    const expMs = Date.parse(state.admin_session_expires_at);
    if (Number.isNaN(expMs)) return;
    const now = Date.now();
    if (expMs <= now) {
      toast.info("Signed out — market closed (3:30 PM IST).");
      clearAdminAuth();
      window.location.reload();
      return;
    }
    // Schedule + safety-net poll every minute (backend rejects if expired).
    const timer = setTimeout(() => {
      toast.info("Signed out — market closed (3:30 PM IST).");
      clearAdminAuth();
      window.location.reload();
    }, Math.min(expMs - now, 2147483000)); // clamp for 32-bit setTimeout
    return () => clearTimeout(timer);
  }, [state.is_admin, state.admin_session_expires_at]);

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Input credentials only.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { username: username.trim(), password });
      clearGuestAuth(); // mutually exclusive tokens
      sessionStorage.setItem("oi_admin_token", data.token);
      toast.success(`Welcome, ${data.username}`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

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
      clearAdminAuth(); // mutually exclusive tokens
      try { sessionStorage.setItem("oi_guest_token", data.token); } catch (_) {}
      try { sessionStorage.setItem("oi_guest_name", data.name); } catch (_) {}
      try {
        const expiresMs = Date.now() + (Number(data.expires_in_seconds || 0) * 1000);
        sessionStorage.setItem("oi_guest_expires_at", String(expiresMs));
      } catch (_) {}
      toast.success(`Welcome, ${data.name}`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start guest session");
    } finally { setBusy(false); }
  };

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  // Admin always passes. Guest only while public access remains open.
  if (state.is_admin) return children;
  if (state.is_guest && state.public_access_open) return children;
  // Stale guest token after public access closed → force login/guest prompt
  if (state.is_guest && !state.public_access_open) {
    clearGuestAuth();
  }

  // Public access open → prompt for guest full name (polished user-facing UI)
  if (state.needs_guest_name || state.public_access_open) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">

            {/* Left marketing panel (large screens) */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }} className="hidden lg:flex flex-col gap-6">
              <div className="text-white">
                <div className="flex items-center gap-3 mb-4">
                  <OiPulseLogo className="w-12 h-12 bg-white/5 rounded-full p-1" />
                  <div>
                    <h2 className="text-4xl font-extrabold tracking-tight">OI Pulse</h2>
                    <p className="mt-1 text-slate-200">Real-time & reliable</p>
                  </div>
                </div>

                <div className="mt-6 bg-white/5 p-4 rounded-xl border border-white/6 shadow-sm">
                  <div className="flex items-center justify-between text-sm text-slate-200 mb-2">
                    <div>Realtime OI</div>
                    <div className="font-semibold">Live</div>
                  </div>
                  <div className="h-44 flex items-end">
                    <svg viewBox="0 0 200 40" className="w-full">
                      <motion.path d="M0 30 L30 24 L60 14 L90 18 L120 10 L150 6 L180 14 L200 8" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2 }} />
                    </svg>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-slate-200">
                    <div className="text-center">
                      <div className="text-2xl font-bold">18</div>
                      <div className="opacity-80">Strikes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">3.2k</div>
                      <div className="opacity-80">Snapshots</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">60s</div>
                      <div className="opacity-80">Default Poll</div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3">
                  <div className="bg-white/6 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-white">Trusted & Secure</h3>
                    <p className="text-xs text-slate-200 mt-1">Credentials are stored locally and can be cleared at any time.</p>
                  </div>
                  <div className="bg-white/6 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-white">Tailored insights</h3>
                    <p className="text-xs text-slate-200 mt-1">Choose timeframes and strikes to focus on what matters to you.</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right: guest card */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="flex justify-center">
              <div className={`w-full max-w-md bg-white/95 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-2xl p-8`}> 

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <OiPulseLogo className="w-10 h-10" />
                    <div>
                      <h1 className="text-xl font-semibold">Open interest insights</h1>
                      <p className="text-sm text-slate-500">Real-time OI — read-only guest access</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={doGuest} className="space-y-4" data-testid="guest-form">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Full name</Label>
                    <Input data-testid="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="e.g. Rahul Sharma" autoFocus />
                  </div>

                  <Button data-testid="guest-submit" type="submit" className={`w-full rounded-lg py-3 bg-emerald-600 hover:bg-emerald-700`} disabled={busy}>
                    <div className="flex items-center justify-center gap-2"><UserPlus className="w-4 h-4" /> <span>{busy ? 'Entering…' : 'Continue'}</span></div>
                  </Button>

                  <div className="mt-2 text-center text-xs text-slate-500">This view is read-only for guests.</div>
                </form>

                <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                  <div className="text-[11px] text-slate-600">
                    <div className="text-2xl">⚡</div>
                    <div className="mt-1">Real-time OI</div>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    <div className="text-2xl">📈</div>
                    <div className="mt-1">Clean charts</div>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    <div className="text-2xl">🔔</div>
                    <div className="mt-1">Alerts</div>
                  </div>
                </div>

              </div>
            </motion.div>

          </div>
        </div>
      </div>
    );
  }

  // Default → redirect to dedicated admin login page
  return <Navigate to="/admin" replace />;
}