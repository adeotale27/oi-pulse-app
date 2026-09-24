import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, BarChart3, Eye, EyeOff, LogIn, Radio } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import StrikLenzRobot from "@/components/StrikLenzRobot";
import AuthFeatureFooter from "@/components/AuthFeatureFooter";
import { fetchExtras, fetchTickers } from "@/lib/api";
import useLiveDemo, { isMarketOpenNow } from "@/hooks/useLiveDemo";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import "@/styles/landing.css";

/**
 * /admin — dedicated, protected admin login page (separate from the public /login).
 * If already authenticated as admin, redirects to the dashboard (/dashboard).
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const marketOpen = isMarketOpenNow();
  const snap = useLiveDemo(1600, marketOpen);
  const [liveMarket, setLiveMarket] = useState(null);
  const [username, setUsername] = useState("Adeotale");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cardState, setCardState] = useState("idle"); // idle | busy | success | error
  const dedicatedAdminHost = typeof window !== "undefined" && window.location.hostname === "admin.striklenz.com";

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
              navigate("/dashboard", { replace: true });
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
          navigate("/dashboard", { replace: true });
        }
      } catch (_) { /* ignore */ }
    })();
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchTickers(), fetchExtras()]).then(([tickerResult, extrasResult]) => {
      if (cancelled) return;
      setLiveMarket({
        tickers: tickerResult.status === "fulfilled" ? tickerResult.value?.tickers : null,
        extras: extrasResult.status === "fulfilled" ? extrasResult.value : null,
      });
    });
    return () => { cancelled = true; };
  }, []);

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
        navigate("/dashboard", { replace: true });
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
  const liveByName = new Map((liveMarket?.tickers || []).map((item) => [String(item.index || item.label).toUpperCase(), {
    price: Number(item.ltp),
    changePct: Number(item.change_pct),
  }]));
  const displayedTick = tick.map(([label, fallback]) => [label, liveByName.get(label) || fallback]);
  const vix = liveMarket?.extras?.vix;
  const gift = liveMarket?.extras?.gift_nifty;
  const vixData = {
    price: vix?.last ?? vix?.ltp ?? vix?.value ?? 13.2,
    changePct: vix?.change_pct ?? vix?.changePct ?? 0,
  };
  const giftData = {
    price: gift?.last ?? gift?.ltp ?? gift?.value ?? 25880,
    changePct: gift?.change_pct ?? gift?.changePct ?? 0,
  };
  const headerTick = [
    ...displayedTick,
    ["VIX", vixData],
    ["GIFT NIFTY", giftData],
  ];
  const pulseBars = snap.chain.rows.map((row) => Math.max(
    20,
    Math.min(92, Math.round((row.ce_oi + row.pe_oi) / 1400)),
  ));

  return (
    <div className="slz admin-login-page relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(48rem 30rem at 20% 0%, rgba(16,185,129,0.22), transparent), radial-gradient(40rem 28rem at 95% 100%, rgba(16,185,129,0.14), transparent)" }} />

      {/* Live ticker */}
      <div className="admin-login-ticker relative z-10 overflow-hidden border-b border-white/10 bg-black/30 px-5 py-2 slz-mono text-xs">
        <div className="admin-login-ticker-track">
          {[0, 1].map((copy) => <div className="admin-login-ticker-copy" key={copy}>
          {headerTick.map(([label, d]) => {
          const up = (d?.changePct ?? 0) >= 0;
          return (
            <span key={label} className="flex items-center gap-1.5 text-slate-200">
              <b className="font-semibold text-white">{label}</b>
              {Number.isFinite(Number(d?.price)) ? Number(d.price).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
              <em className={`not-italic font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>{Number.isFinite(Number(d?.changePct)) ? `${up ? "▲" : "▼"}${Math.abs(d.changePct).toFixed(2)}%` : "—"}</em>
            </span>
          );
        })}
        <span className={`ml-auto flex items-center gap-1 ${marketOpen ? "text-emerald-400" : "text-slate-400"}`}><span className={marketOpen ? "slz-live-dot" : "h-1.5 w-1.5 rounded-full bg-slate-500"} /> {marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span>
        </div>)}
        </div>
      </div>

      <div className="admin-login-main relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.04fr_.96fr] lg:gap-14 lg:px-10">
        {/* Live market scene */}
        <div className="relative hidden min-h-[35rem] lg:block">
          <div className="mb-5 flex items-center gap-2">
            <OiPulseLogo className="h-9 w-9" pulse={false} />
            <div>
              <div className="text-lg font-bold leading-none">Strik<span className="text-emerald-400">lenz</span></div>
              <div className="text-[11px] text-slate-400">Command the desk. Spot bias. Act on OI.</div>
            </div>
          </div>
          <motion.div
            className="relative h-[27rem] overflow-hidden rounded-[2rem] border border-emerald-300/20 bg-[radial-gradient(circle_at_50%_35%,rgba(16,185,129,.2),transparent_45%),linear-gradient(145deg,#08232a,#020b12)] p-5 shadow-2xl shadow-emerald-950/50"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(52,211,153,.2)_1px,transparent_1px),linear-gradient(90deg,rgba(52,211,153,.2)_1px,transparent_1px)] [background-size:32px_32px]" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-emerald-200">
                <Radio className="h-3.5 w-3.5 animate-pulse" /> Live desk pulse
              </div>
              <span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${marketOpen ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200" : "border-slate-400/25 bg-slate-400/10 text-slate-300"}`}>{marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span>
            </div>
            <div className="relative mt-5 grid grid-cols-3 gap-2">
              {displayedTick.map(([label, data]) => {
                const up = data.changePct >= 0;
                return (
                  <motion.div key={label} className="rounded-xl border border-white/10 bg-black/25 p-3 backdrop-blur" animate={{ opacity: [0.72, 1, 0.72] }} transition={{ duration: 2.4, repeat: Infinity, delay: label === "SENSEX" ? .6 : 0 }}>
                    <div className="text-[9px] font-bold tracking-widest text-slate-400">{label}</div>
                    <div className="mt-1 font-mono text-sm text-white">{Number(data.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                    <div className={`mt-1 text-[10px] font-bold ${up ? "text-emerald-300" : "text-rose-300"}`}>{up ? "▲" : "▼"} {Math.abs(data.changePct).toFixed(2)}%</div>
                  </motion.div>
                );
              })}
            </div>
            <div className="relative mt-4 grid grid-cols-[1.25fr_.75fr] gap-3">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-slate-400"><span>NIFTY live flow</span><Activity className="h-3.5 w-3.5 text-emerald-300" /></div>
                <motion.svg key={snap.oiTick} viewBox="0 0 260 100" className="mt-2 h-28 w-full" aria-hidden animate={{ y: [0, -1.5, 0] }} transition={{ duration: .8, ease: "easeInOut" }}>
                  <path d="M0 82H260M0 50H260M0 18H260" stroke="rgba(148,163,184,.16)" />
                  {[22, 42, 63, 84, 105, 127, 149, 171, 193, 215, 237].map((x, index) => {
                    const top = [58, 46, 52, 34, 42, 27, 37, 21, 30, 18, 24][index];
                    const height = [12, 18, 15, 22, 16, 25, 18, 28, 20, 24, 19][index];
                    const up = index % 4 !== 1;
                    return <g key={x}><path d={`M${x} ${top - 7}V${top + height + 7}`} stroke={up ? "#35e0ac" : "#fb7185"} /><rect x={x - 3.5} y={top} width="7" height={height} rx="1" fill={up ? "#13b889" : "#e05c6d"} /></g>;
                  })}
                  <path d="M0 78 C25 66 34 74 56 58 S91 62 112 44 S151 50 173 31 S212 38 260 22" fill="none" stroke="#32e6b0" strokeWidth="2" opacity=".7" />
                </motion.svg>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-slate-400"><span>OI pressure</span><BarChart3 className="h-3.5 w-3.5 text-emerald-300" /></div>
                <div className="mt-5 flex h-24 items-end gap-1">
                  {pulseBars.map((height, index) => {
                    const positive = index % 3 !== 1;
                    return <motion.i key={index} className={`flex-1 rounded-t shadow-[0_0_10px_rgba(52,211,153,.25)] ${positive ? "bg-gradient-to-t from-emerald-700 to-emerald-300" : "bg-gradient-to-t from-rose-700 to-rose-300"}`} animate={{ height: `${height}%` }} transition={{ duration: .55, ease: "easeOut" }} />;
                  })}
                </div>
                  <div className="mt-2 font-mono text-[9px] text-emerald-300">PCR {snap.pcr.toFixed(2)} · {marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</div>
              </div>
            </div>
            <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between text-[10px] text-slate-400">
              <span>Watching OI so you don&apos;t have to.</span><span className="font-mono text-emerald-300">{marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span>
            </div>
          </motion.div>
          <motion.div className="absolute -right-3 top-24 rounded-xl border border-emerald-300/25 bg-slate-950/90 px-3 py-2 shadow-xl backdrop-blur" animate={{ y: [0, 10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="text-[9px] font-semibold text-slate-400">DESK P&amp;L SIMULATION</div>
            <div className="slz-mono text-sm font-bold text-emerald-400">+₹8,756</div>
          </motion.div>
          <motion.div className="absolute bottom-14 left-[39%] z-10" animate={{ y: [0, -9, 0], rotate: [-1, 1, -1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <div className="scale-[.72]"><StrikLenzRobot variant="maintenance" /></div>
          </motion.div>
          <p className="mt-6 max-w-lg text-sm leading-6 text-slate-300">Good trades come from <span className="font-semibold text-emerald-300">discipline</span>, not emotion. The desk is already watching the pulse.</p>
        </div>

        {/* Login card */}
        <div className="admin-login-card-shell mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <OiPulseLogo className="h-9 w-9" pulse={false} />
            <span className="text-xl font-bold">Strik<span className="text-emerald-400">lenz</span></span>
          </div>
          <div
            className={[
              "admin-login-card relative w-full overflow-hidden rounded-[1.75rem] border bg-slate-900/80 p-6 text-white shadow-[0_30px_90px_-35px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8",
              cardState === "error" ? "border-rose-400/80 ring-2 ring-rose-300/30" : "border-white/15",
              cardState === "success" ? "ring-2 ring-emerald-300/60" : "",
            ].join(" ")}
          >
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative mb-8 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-1.5 shadow-[0_0_24px_rgba(52,211,153,.18)]">
                <OiPulseLogo className="h-10 w-10" />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Admin</div>
                <h2 className="mt-1.5 text-[1.4rem] font-semibold tracking-tight">Welcome back</h2>
                <p className="mt-0.5 text-sm text-slate-300">Sign in to the control desk</p>
              </div>
            </div>
              <span className="hidden rounded-full border border-slate-600/70 bg-slate-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:inline-flex">Secure area</span>
            </div>

            <form onSubmit={doLogin} className="relative space-y-5" data-testid="admin-login-form">
              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Login ID</Label>
                <Input
                  data-testid="admin-login-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Administrator"
                  autoComplete="username"
                  className="mt-2 h-12 rounded-xl border-white/15 bg-slate-950/35 px-4 text-white placeholder:text-slate-500 transition focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-400/15"
                />
              </div>

              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Password</Label>
                <div className="relative mt-1">
                  <Input
                    data-testid="admin-login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="h-12 rounded-xl border-white/15 bg-slate-950/35 px-4 pr-20 text-white placeholder:text-slate-500 transition focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-400/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                <label
                  className="flex items-center gap-2 text-xs text-slate-300"
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
                {!dedicatedAdminHost && <button
                  type="button"
                  data-testid="continue-as-guest"
                  className="text-xs font-semibold text-emerald-300 underline-offset-2 hover:underline"
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
                        navigate("/dashboard", { replace: true });
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
                </button>}
              </div>

              <Button
                data-testid="admin-login-submit"
                type="submit"
                className="admin-login-submit slz-btn-primary h-12 w-full rounded-xl text-sm font-semibold shadow-[0_12px_30px_-10px_rgba(16,185,129,.75)]"
                disabled={busy}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <LogIn className="h-4 w-4" />
                  {busy ? "Signing in…" : cardState === "success" ? "Welcome!" : "Sign in"}
                </span>
              </Button>
            </form>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            <p>Protected area · authorised personnel only</p>
          </div>
        </div>
      </div>
      <AuthFeatureFooter version={APP_VERSION_LABEL} />
    </div>
  );
}
