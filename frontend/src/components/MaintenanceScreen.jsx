import React from "react";
import { motion } from "framer-motion";
import { RefreshCw, TrendingUp, Wrench, Activity } from "lucide-react";
import "@/styles/landing.css";

export default function MaintenanceScreen({ onRetry, retrying = false }) {
  return (
    <div className="slz relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
      <div className="slz-aurora" />
      <div className="absolute inset-0 slz-grid-dots opacity-60" />
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <div className="mb-6 flex items-center justify-center gap-2 lg:justify-start">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-indigo-600 shadow-lg shadow-emerald-500/30">
              <TrendingUp className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">Strik<span className="text-emerald-600">lenz</span></span>
          </div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-700">
            <Wrench className="h-3.5 w-3.5" /> Temporarily unavailable
          </div>
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl">
            We're tuning the<br /><span className="slz-underline-accent">market engine.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-base leading-7 text-slate-600 lg:mx-0">
            Striklenz is briefly offline while we make it faster and sharper. Hang tight — the desk will be back in a moment.
          </p>
          <button
            type="button" onClick={onRetry} disabled={retrying}
            className="slz-btn-primary mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {retrying ? "Checking…" : "Try again"}
          </button>
          <div className="mt-6 text-xs text-slate-500">Need help? Reach us at <a href="mailto:support@striklenz.com" className="font-semibold text-emerald-600 hover:underline">support@striklenz.com</a></div>
        </div>
        <div className="slz-scene relative mx-auto hidden w-full max-w-md lg:block">
          <motion.div className="slz-tilt" animate={{ y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <div className="slz-browser">
              <div className="slz-browser-bar"><span className="slz-dot" style={{ background: "#ff5f57" }} /><span className="slz-dot" style={{ background: "#febc2e" }} /><span className="slz-dot" style={{ background: "#28c840" }} /><span className="slz-url slz-mono">striklenz.com</span></div>
              <div className="slz-screen-body flex h-56 flex-col items-center justify-center gap-3">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
                  <Activity className="h-8 w-8 text-emerald-400" />
                </motion.div>
                <div className="slz-mono text-sm text-slate-300">recalibrating OI feed…</div>
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full bg-emerald-400" animate={{ x: ["-100%", "250%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} style={{ width: "40%" }} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
