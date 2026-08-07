import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { motion } from 'framer-motion';

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
  const [cardState, setCardState] = useState('idle'); // 'idle' | 'busy' | 'success' | 'error'

  useEffect(() => {
    (async () => {
      try {
        // Try 24h remember-me auto-login first (IP-bound on server).
        const rememberTok = localStorage.getItem("oi_admin_remember_token");
        if (rememberTok && !sessionStorage.getItem("oi_admin_token") && !localStorage.getItem("oi_admin_token")) {
          try {
            const { data } = await api.post("/auth/remember-login", { remember_token: rememberTok });
            if (data?.token) {
              sessionStorage.setItem("oi_admin_token", data.token);
              toast.success(`Welcome back, ${data.username}`);
              navigate("/", { replace: true });
              return;
            }
          } catch (_) {
            try { localStorage.removeItem("oi_admin_remember_token"); } catch (_) {}
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
      setCardState('busy');
      const { data } = await api.post("/auth/login", {
        username: username.trim(),
        password,
        remember_me: remember,
      });
      // Session token stays in sessionStorage only. Remember-me uses a separate
      // 24h IP-bound token so a stale session cookie cannot block auto-login.
      try { sessionStorage.setItem("oi_admin_token", data.token); } catch(_) {}
      try { localStorage.removeItem("oi_admin_token"); } catch(_) {}
      if (remember && data.remember_token) {
        try { localStorage.setItem("oi_admin_remember_token", data.remember_token); } catch(_) {}
      } else {
        try { localStorage.removeItem("oi_admin_remember_token"); } catch(_) {}
      }
      try {
        const { clearGuestAuth } = await import("@/lib/api");
        clearGuestAuth();
      } catch (_) {
        try { sessionStorage.removeItem("oi_guest_token"); sessionStorage.removeItem("oi_guest_name"); } catch(_) {}
      }

      setCardState('success');
      toast.success(`Welcome back, ${data.username}`);
      setTimeout(() => {
        navigate("/", { replace: true });
        setTimeout(() => window.location.reload(), 100);
      }, 350);
    } catch (err) {
      setCardState('error');
      toast.error(err?.response?.data?.detail || "Login failed — check credentials");
      setTimeout(() => setCardState('idle'), 600);
    } finally {
      setBusy(false);
    }
  };

  // compute password strength: 0-4
  const pwScore = (() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">

          {/* Left marketing panel */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }} className="hidden lg:flex flex-col gap-6">
            <div className="text-white">
              <div className="flex items-center gap-3 mb-4">
                <OiPulseLogo className="w-12 h-12 bg-white/5 rounded-full p-1" />
                <div>
                  <h2 className="text-4xl font-extrabold tracking-tight">OI Pulse</h2>
                  <p className="mt-1 text-slate-200">Professional OI insights · real-time & reliable</p>
                </div>
              </div>

              <div className="mt-6 bg-white/5 p-4 rounded-xl border border-white/6 shadow-sm">
                <div className="flex items-center justify-between text-sm text-slate-200 mb-2">
                  <div>Realtime OI</div>
                  <div className="font-semibold">Live</div>
                </div>
                <div className="h-44 flex items-end">
                  {/* Simple SVG sparkline animated */}
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
                  <h3 className="text-sm font-semibold text-white">Admin Controls</h3>
                  <p className="text-xs text-slate-200 mt-1">Full-featured admin settings: credentials, telegram alerts, uploads.</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: login card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="flex justify-center">
            <div className={`w-full max-w-md bg-white/95 backdrop-blur-sm border ${cardState === 'error' ? 'border-rose-500' : 'border-slate-200'} ${cardState === 'success' ? 'ring-2 ring-emerald-200' : ''} rounded-2xl shadow-2xl p-8`}> 

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <OiPulseLogo className="w-10 h-10" />
                  <div>
                    <h1 className="text-xl font-semibold">Welcome back</h1>
                    <p className="text-sm text-slate-500">Sign in to manage OI snapshots</p>
                  </div>
                </div>
              </div>

              <form onSubmit={doLogin} className="space-y-4" data-testid="admin-login-form">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Login ID</Label>
                  <Input data-testid="admin-login-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Administrator" autoComplete="username" />
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Password</Label>
                  <div className="relative">
                    <Input data-testid="admin-login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{showPassword ? 'Hide' : 'Show'}</button>
                  </div>

                  <div className="mt-2">
                    <div className="h-2 w-full bg-slate-100 rounded overflow-hidden">
                      <div className={`h-full ${pwScore >= 1 ? 'bg-rose-400' : 'bg-transparent'} transition-all`} style={{ width: `${(pwScore/4)*100}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">Strength: {['Empty','Weak','Fair','Good','Strong'][pwScore]}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-slate-600" title="Stay signed in on this machine (same IP) for 24 hours">
                    <input type="checkbox" data-testid="admin-remember-me" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    <span>Remember me (this device, 24h)</span>
                  </label>
                  <button
                    type="button"
                    data-testid="continue-as-guest"
                    className="text-sm text-slate-600 underline hover:text-slate-900"
                    onClick={async () => {
                      try {
                        const { data } = await api.get("/auth/state");
                        if (data?.public_access_open) {
                          navigate("/", { replace: true });
                          return;
                        }
                        toast.error("Ask Admin to give access", {
                          description: "Public access is currently off. Contact the admin to open access for guests.",
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

                <Button data-testid="admin-login-submit" type="submit" className={`w-full rounded-lg py-3 ${cardState === 'busy' ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`} disabled={busy}>
                  <div className="flex items-center justify-center gap-2"><LogIn className="w-4 h-4" /> <span>{busy ? 'Signing in…' : (cardState === 'success' ? 'Welcome!' : 'Sign in')}</span></div>
                </Button>

                <div className="mt-2 text-center text-xs text-slate-500">By signing in you agree to the terms of use.</div>
              </form>

              <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                <div className="text-[11px] text-slate-600">
                  <div className="text-2xl">⚡</div>
                  <div className="mt-1">Real-time OI</div>
                </div>
                <div className="text-[11px] text-slate-600">
                  <div className="text-2xl">📊</div>
                  <div className="mt-1">Custom timeframes</div>
                </div>
                <div className="text-[11px] text-slate-600">
                  <div className="text-2xl">🔐</div>
                  <div className="mt-1">Admin controls</div>
                </div>
              </div>

            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
