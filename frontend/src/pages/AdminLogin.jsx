import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import AuthShell from "@/components/AuthShell";

/**
 * /admin — dedicated admin login page.
 * If already authenticated as admin, redirects to the dashboard.
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("Adeotale");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cardState, setCardState] = useState("idle"); // idle | busy | success | error

  useEffect(() => {
    (async () => {
      try {
        try {
          if (localStorage.getItem("oi_admin_token") && !sessionStorage.getItem("oi_admin_token")) {
            localStorage.removeItem("oi_admin_token");
          }
        } catch (_) {}
        const rememberTok = localStorage.getItem("oi_admin_remember_token");
        if (rememberTok && !sessionStorage.getItem("oi_admin_token")) {
          try {
            const { data } = await api.post("/auth/remember-login", { remember_token: rememberTok });
            if (data?.token) {
              sessionStorage.setItem("oi_admin_token", data.token);
              try { localStorage.removeItem("oi_admin_token"); } catch (_) {}
              toast.success(`Welcome back, ${data.username}`);
              navigate("/", { replace: true });
              return;
            }
          } catch (err) {
            const detail = String(err?.response?.data?.detail || "");
            if (/expired|invalid|missing/i.test(detail)) {
              try { localStorage.removeItem("oi_admin_remember_token"); } catch (_) {}
            }
          }
        }
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
      setCardState("busy");
      const { data } = await api.post("/auth/login", {
        username: username.trim(),
        password,
        remember_me: remember,
      });
      try { sessionStorage.setItem("oi_admin_token", data.token); } catch (_) {}
      try { localStorage.removeItem("oi_admin_token"); } catch (_) {}
      if (remember && data.remember_token) {
        try { localStorage.setItem("oi_admin_remember_token", data.remember_token); } catch (_) {}
      } else if (!remember) {
        try { localStorage.removeItem("oi_admin_remember_token"); } catch (_) {}
      }
      try {
        const { clearGuestAuth } = await import("@/lib/api");
        clearGuestAuth();
      } catch (_) {
        try {
          sessionStorage.removeItem("oi_guest_token");
          sessionStorage.removeItem("oi_guest_name");
        } catch (_) {}
      }

      setCardState("success");
      toast.success(`Welcome back, ${data.username}`);
      setTimeout(() => {
        navigate("/", { replace: true });
        setTimeout(() => window.location.reload(), 100);
      }, 350);
    } catch (err) {
      setCardState("error");
      toast.error(err?.response?.data?.detail || "Login failed — check credentials");
      setTimeout(() => setCardState("idle"), 600);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell mode="admin">
      <div
        className={[
          "w-full max-w-md rounded-2xl border bg-white p-7 text-slate-900 shadow-2xl shadow-black/40 sm:p-8",
          cardState === "error" ? "border-rose-400 ring-2 ring-rose-200" : "border-white/20",
          cardState === "success" ? "ring-2 ring-emerald-300" : "",
        ].join(" ")}
      >
        <div className="mb-6 flex items-center gap-3">
          <OiPulseLogo className="h-11 w-11" />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Admin sign in</h2>
            <p className="text-sm text-slate-500">Manage OI, guests, and desk settings</p>
          </div>
        </div>

        <form onSubmit={doLogin} className="space-y-4" data-testid="admin-login-form">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-slate-500">Login ID</Label>
            <Input
              data-testid="admin-login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Administrator"
              autoComplete="username"
              className="mt-1 h-11"
            />
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-slate-500">Password</Label>
            <div className="relative mt-1">
              <Input
                data-testid="admin-login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="h-11 pr-16"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <label
              className="flex items-center gap-2 text-sm text-slate-600"
              title="Stay signed in on this machine (same IP) for 24 hours"
            >
              <input
                type="checkbox"
                data-testid="admin-remember-me"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Remember me (24h)</span>
            </label>
            <button
              type="button"
              data-testid="continue-as-guest"
              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
              onClick={async () => {
                try {
                  const { data } = await api.get("/auth/state");
                  if (data?.ip_blocked) {
                    toast.error("This network is blocked", {
                      description: "Ask the admin to unblock your IP in Access Control.",
                      duration: 6000,
                    });
                    return;
                  }
                  if (data?.public_access_open) {
                    navigate("/", { replace: true });
                    return;
                  }
                  toast.error("Ask Admin to give access", {
                    description: "Public access is currently off. Ask the admin to turn Public access ON, then try again.",
                    duration: 6000,
                  });
                } catch (_) {
                  toast.error("Ask Admin to give access");
                }
              }}
            >
              Continue as guest
            </button>
          </div>

          <Button
            data-testid="admin-login-submit"
            type="submit"
            className="h-11 w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
            disabled={busy}
          >
            <span className="inline-flex items-center justify-center gap-2">
              <LogIn className="h-4 w-4" />
              {busy ? "Signing in…" : cardState === "success" ? "Welcome!" : "Sign in"}
            </span>
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
