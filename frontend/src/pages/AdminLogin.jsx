import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";

/**
 * /admin — dedicated admin login page.
 * If already authenticated as admin, redirects to the dashboard.
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("Adeotale");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/state");
        if (data?.is_admin) {
          navigate("/", { replace: true });
        }
      } catch (_) { /* ignore */ }
    })();
  }, [navigate]);

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Enter both username and password.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { username: username.trim(), password });
      sessionStorage.setItem("oi_admin_token", data.token);
      // Also wipe any lingering guest token — admin route means admin session only.
      sessionStorage.removeItem("oi_guest_token");
      sessionStorage.removeItem("oi_guest_name");
      toast.success(`Welcome, ${data.username}`);
      navigate("/", { replace: true });
      // Reload so AuthGate + auth-state re-fetches with the new token.
      setTimeout(() => window.location.reload(), 100);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-2">
          <OiPulseLogo className="w-7 h-7" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">OI-Pulse Admin</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Administrator sign-in</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-5 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Restricted — admin credentials required.
        </p>

        <form onSubmit={doLogin} className="space-y-3" data-testid="admin-login-form">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Login ID</Label>
            <Input
              data-testid="admin-login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Adeotale"
              autoComplete="username"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Password</Label>
            <Input
              data-testid="admin-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <Button
            data-testid="admin-login-submit"
            type="submit"
            className="w-full rounded-md bg-slate-900 hover:bg-slate-800 py-2.5"
            disabled={busy}
          >
            <LogIn className="w-4 h-4 mr-1.5" />
            {busy ? "Signing in…" : "Sign in as Admin"}
          </Button>
        </form>

        <p className="text-[11px] text-slate-400 mt-4 text-center">
          Not an admin?{" "}
          <a
            href="/"
            className="text-slate-600 hover:text-slate-900 underline underline-offset-2"
          >
            Go to the public dashboard
          </a>
        </p>
      </div>
    </div>
  );
}
