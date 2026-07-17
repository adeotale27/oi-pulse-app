import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Activity, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * AuthGate:
 *  - On mount, GETs /api/auth/state.
 *  - If public access is open OR the caller is admin -> render children.
 *  - Otherwise render a minimal login form.
 *  - Login stores token in localStorage under 'oi_admin_token' (attached to
 *    every axios request via /lib/api.js interceptor).
 */
export default function AuthGate({ children, onAuthResolved }) {
  const [state, setState] = useState({ loading: true, requires_login: true, is_admin: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState({ loading: false, ...data });
      onAuthResolved?.(data);
    } catch (e) {
      setState({ loading: false, requires_login: true, is_admin: false });
    }
  };

  useEffect(() => {
    refresh();
    // Poll every 60s so the 3:30 PM auto-close kicks the user back to login.
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, []);

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Enter both username and password.");
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
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  // Allow through: either public access is open, or the client is an admin.
  if (!state.requires_login) {
    return children;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-md shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-emerald-600" />
          <h1 className="text-lg font-semibold tracking-tight">OI-Pulse</h1>
        </div>
        <p className="text-xs text-slate-500 mb-5 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Admin login required
        </p>

        <form onSubmit={doLogin} className="space-y-3" data-testid="login-form">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Login ID</Label>
            <Input
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Adeotale"
              autoFocus
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

        <p className="text-[11px] text-slate-400 mt-4 text-center">
          Access is limited to the admin. To share with others, sign in and enable
          <b> Public Access</b> in the header.
        </p>
      </div>
    </div>
  );
}
