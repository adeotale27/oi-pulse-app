import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import useLiveDemo from "@/hooks/useLiveDemo";
import "@/styles/landing.css";

/**
 * /admin — dedicated, protected admin login page (separate from the public /login).
 * If already authenticated as admin, redirects to the dashboard (/terminal).
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const snap = useLiveDemo(1600);
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
              navigate("/terminal", { replace: true });
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
          navigate("/terminal", { replace: true });
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
        navigate("/terminal", { replace: true });
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

  const tick = [
    ["NIFTY", snap.indices.NIFTY],
    ["SENSEX", snap.indices.SENSEX],
    ["BANKNIFTY", snap.indices.BANKNIFTY],
  ];

  return (
    <div className="slz relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(48rem 30rem at 20% 0%, rgba(16,185,129,0.22), transparent), radial-gradient(40rem 28rem at 95% 100%, rgba(16,185,129,0.14), transparent)" }} />

      {/* Live ticker */}
      <div className="relative z-10 flex items-center gap-4 overflow-hidden border-b border-white/10 bg-black/30 px-5 py-2 slz-mono text-xs">
        {tick.map(([label, d]) => {
          const up = (d?.changePct ?? 0) >= 0;
          return (
            <span key={label} className="flex items-center gap-1.5 text-slate-200">
              <b className="font-semibold text-white">{label}</b>
              {Number(d?.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              <em className={`not-italic font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "▲" : "▼"}{Math.abs(d?.changePct ?? 0).toFixed(2)}%</em>
            </span>
          );
        })}
        <span className="ml-auto flex items-center gap-1 text-emerald-400"><span className="slz-live-dot" /> LIVE</span>
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 lg:grid-cols-[1.1fr_1fr]">
        {/* Scene */}
        <div className="slz-scene relative hidden lg:block">
          <div className="mb-5 flex items-center gap-2">
            <OiPulseLogo className="h-9 w-9" pulse={false} />
            <div>
              <div className="text-lg font-bold leading-none">Strik<span className="text-emerald-400">lenz</span></div>
              <div className="text-[11px] text-slate-400">Command the desk. Spot bias. Act on OI.</div>
            </div>
          </div>
          <motion.div className="slz-tilt" animate={{ y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <div className="slz-browser">
              <div className="slz-browser-bar"><span className="slz-dot" style={{ background: "#ff5f57" }} /><span className="slz-dot" style={{ background: "#febc2e" }} /><span className="slz-dot" style={{ background: "#28c840" }} /><span className="slz-url slz-mono">striklenz.com/terminal</span></div>
              <img src="/shots/admin-scene.jpg" alt="Striklenz desk" className="block w-full" />
            </div>
          </motion.div>
          <motion.div className="absolute -right-3 top-24 rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2 shadow-xl backdrop-blur"
            animate={{ y: [0, 10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="text-[9px] font-semibold text-slate-400">DESK P&amp;L</div>
            <div className="slz-mono text-sm font-bold text-emerald-400">+₹12.84L</div>
          </motion.div>
          <p className="mt-6 text-sm text-slate-300">Good trades come from <span className="font-semibold text-emerald-300">discipline</span>, not emotion. Plan · Analyze · Execute · Improve.</p>
        </div>

        {/* Login card */}
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <OiPulseLogo className="h-9 w-9" pulse={false} />
            <span className="text-xl font-bold">Strik<span className="text-emerald-400">lenz</span></span>
          </div>
          <div
            className={[
              "w-full rounded-2xl border bg-slate-900/70 p-7 text-white shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-8",
              cardState === "error" ? "border-rose-400/80 ring-2 ring-rose-300/30" : "border-emerald-300/25",
              cardState === "success" ? "ring-2 ring-emerald-300/60" : "",
            ].join(" ")}
          >
            <div className="mb-6 flex items-center gap-3">
              <OiPulseLogo className="h-11 w-11" />
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Admin</div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Welcome back</h2>
                <p className="text-sm text-slate-300">Sign in to the Striklenz control desk</p>
              </div>
            </div>

            <form onSubmit={doLogin} className="space-y-4" data-testid="admin-login-form">
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-slate-300">Login ID</Label>
                <Input
                  data-testid="admin-login-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Administrator"
                  autoComplete="username"
                  className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>

              <div>
                <Label className="text-[11px] uppercase tracking-wider text-slate-300">Password</Label>
                <div className="relative mt-1">
                  <Input
                    data-testid="admin-login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="h-11 border-white/15 bg-white/5 pr-16 text-white placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <label
                  className="flex items-center gap-2 text-sm text-slate-300"
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
                  className="text-sm font-medium text-emerald-300 underline-offset-2 hover:underline"
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
                        navigate("/terminal", { replace: true });
                        return;
                      }
                      toast.message("Ask Admin to give access", {
                        description: "Public access is currently off. Ask the admin to turn Public access ON, then try again.",
                        duration: 6000,
                      });
                    } catch (_) {
                      toast.message("Ask Admin to give access");
                    }
                  }}
                >
                  Continue as guest
                </button>
              </div>

              <Button
                data-testid="admin-login-submit"
                type="submit"
                className="slz-btn-primary h-11 w-full rounded-xl"
                disabled={busy}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <LogIn className="h-4 w-4" />
                  {busy ? "Signing in…" : cardState === "success" ? "Welcome!" : "Sign in"}
                </span>
              </Button>
            </form>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">Protected area · authorised personnel only</p>
        </div>
      </div>
    </div>
  );
}
