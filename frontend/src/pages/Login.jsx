import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, TrendingUp, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import "@/styles/landing.css";
import { api, persistGuestAuth } from "@/lib/api";
import useLiveDemo from "@/hooks/useLiveDemo";
import BrowserMock from "@/components/landing/BrowserMock";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 5.1 29.3 3 24 3 15.9 3 8.9 7.6 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-3.6-11.3-8.4l-6.6 5.1C8.8 40.3 15.8 45 24 45z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C41.3 36.8 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function Login() {
  const nav = useNavigate();
  const snap = useLiveDemo(1600);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [exchanging, setExchanging] = useState(false);

  const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/login` : "";

  // Handle Google OAuth redirect back (?code=...)
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const code = qs.get("code");
    if (!code) return;
    setExchanging(true);
    (async () => {
      try {
        const { data } = await api.post("/auth/google/exchange", { code, redirect_uri: redirectUri });
        if (data?.token) {
          persistGuestAuth({ token: data.token, name: data.name, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
          toast.success(`Welcome, ${data.name || "trader"}`);
          window.history.replaceState({}, "", "/login");
          nav("/terminal");
          return;
        }
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Google sign-in failed");
      } finally {
        setExchanging(false);
        window.history.replaceState({}, "", "/login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doGoogle = async () => {
    try {
      const { data } = await api.get("/auth/google/login-url", { params: { redirect_uri: redirectUri } });
      if (data?.configured && data?.url) {
        window.location.assign(data.url);
        return;
      }
      toast.message("Google sign-in coming soon", { description: "An admin needs to finish connecting Google. Continue as guest for now." });
    } catch (_) {
      toast.error("Could not start Google sign-in");
    }
  };

  const doGuest = async (e) => {
    e?.preventDefault();
    const full = name.trim();
    if (full.length < 2 || !full.includes(" ")) {
      toast.error("Please enter your full name (first + last).");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/guest", { name: full });
      if (data?.token) {
        persistGuestAuth({ token: data.token, name: data.name || full, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
        toast.success(`Welcome, ${data.name || full}`);
        nav("/terminal");
        return;
      }
      if (data?.status === "pending" && data.request_id) {
        setPending({ id: data.request_id, name: data.name || full });
        toast.message("Request sent", { description: "Waiting for admin approval…" });
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  // Poll pending approval
  useEffect(() => {
    if (!pending?.id) return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/auth/access-request/${pending.id}`);
        if ((data.status === "approved" || data.status === "consumed") && data.token) {
          clearInterval(t);
          persistGuestAuth({ token: data.token, name: data.name || pending.name, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
          toast.success("Approved — entering…");
          nav("/terminal");
        } else if (data.status === "rejected") {
          clearInterval(t);
          setPending(null);
          toast.error("Access request was rejected.");
        }
      } catch (_) { /* keep waiting */ }
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  return (
    <div className="slz relative flex min-h-screen items-stretch overflow-hidden">
      <div className="slz-aurora" />
      {/* Left brand / product */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: "radial-gradient(40rem 24rem at 70% 0%, rgba(16,185,129,0.35), transparent), radial-gradient(36rem 24rem at 10% 100%, rgba(79,70,229,0.35), transparent)" }} />
        <Link to="/" className="relative flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-indigo-600"><TrendingUp className="h-5 w-5 text-white" strokeWidth={2.5} /></div>
          <span className="text-xl font-bold">Strik<span className="text-emerald-400">lenz</span></span>
        </Link>
        <div className="relative">
          <h2 className="text-3xl font-black leading-tight">Read the market.<br />Then read your book.</h2>
          <p className="mt-3 max-w-md text-slate-300">Live OI, Strike Pressure and your positions on the OI wall — the moment you sign in.</p>
          <motion.div className="mt-8 max-w-md" animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <BrowserMock id="dashboard" snap={snap} title="Market Dashboard" />
          </motion.div>
        </div>
        <div className="relative text-xs text-slate-400">Official broker OAuth · we never store your broker password.</div>
      </div>

      {/* Right auth card */}
      <div className="relative flex w-full items-center justify-center px-5 py-10 lg:w-1/2">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
          <div className="lg:hidden mb-6 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-indigo-600"><TrendingUp className="h-5 w-5 text-white" strokeWidth={2.5} /></div>
            <span className="text-xl font-bold text-slate-900">Strik<span className="text-emerald-600">lenz</span></span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome to Striklenz</h1>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to open your desk. It takes seconds.</p>

          <button
            onClick={doGoogle}
            disabled={exchanging}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-emerald-400 hover:shadow-sm disabled:opacity-60"
          >
            {exchanging ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
            {exchanging ? "Signing you in…" : "Continue with Google"}
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" /> or continue as guest <div className="h-px flex-1 bg-slate-200" />
          </div>

          {pending ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for admin approval…</div>
              <p className="mt-1 text-xs opacity-80">Requested as <b>{pending.name}</b>. Keep this page open — you'll enter automatically.</p>
              <button onClick={() => setPending(null)} className="mt-2 text-xs underline opacity-70 hover:opacity-100">Cancel</button>
            </div>
          ) : (
            <form onSubmit={doGuest} className="space-y-3">
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name (e.g. Rahul Sharma)"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={busy} className="slz-btn-primary flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {busy ? "Entering…" : "Enter the desk"}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-slate-400">By continuing you agree this is information only and not investment advice.</p>
        </div>
      </div>
    </div>
  );
}
