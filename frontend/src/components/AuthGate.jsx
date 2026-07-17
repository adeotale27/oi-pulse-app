import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
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
      setState({ loading: false, ...data });
    } catch (_) {
      setState({ loading: false, requires_login: true, is_admin: false, is_guest: false, needs_guest_name: false });
    }
  };

  useEffect(() => {
    refresh();
    // Poll every 60s so the 3:30 PM auto-close kicks users back to login.
    const iv = setInterval(refresh, 60_000);
    // Track user activity for idle-timeout
    const bump = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("mousemove", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("click", bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("click", bump);
    };
  }, []);

  // Client-side 8h idle-logout for admin (matches backend TTL).
  useEffect(() => {
    if (!state.is_admin) return;
    const ttl = (state.session_ttl_seconds || 8 * 3600) * 1000;
    const check = setInterval(() => {
      if (Date.now() - lastActivityRef.current > ttl) {
        toast.info("Signed out — session timed out.");
        localStorage.removeItem("oi_admin_token");
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(check);
  }, [state.is_admin, state.session_ttl_seconds]);

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Input credentials only.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { username: username.trim(), password });
      localStorage.setItem("oi_admin_token", data.token);
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
      localStorage.setItem("oi_guest_token", data.token);
      localStorage.setItem("oi_guest_name", data.name);
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

  // If authenticated (admin OR guest), render the app.
  if (state.is_admin || state.is_guest) return children;

  // Public access open → prompt for guest full name
  if (state.needs_guest_name || state.public_access_open) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 p-4">
        <div className="w-full max-w-sm bg-white rounded-md shadow-md border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <OiPulseLogo className="w-6 h-6" />
            <h1 className="text-lg font-semibold tracking-tight">OI-Pulse</h1>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            You&apos;ve been invited by <b>{state.admin_display_name || "the admin"}</b>. Please enter your full name to continue.
          </p>
          <form onSubmit={doGuest} className="space-y-3" data-testid="guest-form">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Full Name</Label>
              <Input
                data-testid="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                autoFocus
              />
            </div>
            <Button
              data-testid="guest-submit"
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-emerald-600 hover:bg-emerald-700 py-2.5"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              {busy ? "Entering…" : "Enter as Guest"}
            </Button>
          </form>
          <p className="text-[11px] text-slate-400 mt-4 text-center">
            This is a read-only view. Configuration is limited to the admin.
          </p>
        </div>
      </div>
    );
  }

  // Default → admin login
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-md shadow-md border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <OiPulseLogo className="w-6 h-6" />
          <h1 className="text-lg font-semibold tracking-tight">OI-Pulse</h1>
        </div>
        <p className="text-xs text-slate-500 mb-5 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Input credentials only
        </p>

        <form onSubmit={doLogin} className="space-y-3" data-testid="login-form">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Login ID</Label>
            <Input
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Adeotale"
              autoComplete="username"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Password</Label>
            <Input
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <Button
            data-testid="login-submit"
            type="submit"
            className="w-full rounded-sm bg-slate-900 hover:bg-slate-800 py-2.5"
            disabled={busy}
          >
            <LogIn className="w-4 h-4 mr-1.5" />
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
