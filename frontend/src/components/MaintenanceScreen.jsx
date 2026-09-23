import React from "react";
import { motion } from "framer-motion";
import { RefreshCw, Coffee } from "lucide-react";
import "@/styles/landing.css";
import OiPulseLogo from "@/components/OiPulseLogo";
import useLiveDemo from "@/hooks/useLiveDemo";

function TickerChip({ label, d }) {
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 slz-mono text-xs text-slate-200">
      <b className="font-semibold text-white">{label}</b>
      {Number(d?.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      <em className={`not-italic font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "▲" : "▼"}{Math.abs(d?.changePct ?? 0).toFixed(2)}%</em>
    </span>
  );
}

export default function MaintenanceScreen({ onRetry, retrying = false }) {
  const snap = useLiveDemo(1600);
  return (
    <div className="slz relative flex min-h-screen items-center overflow-hidden bg-slate-950 px-5 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(50rem 30rem at 78% 10%, rgba(16,185,129,0.28), transparent), radial-gradient(44rem 28rem at 5% 100%, rgba(16,185,129,0.14), transparent)" }} />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1.05fr]">
        <div className="text-center lg:text-left">
          <div className="mb-6 flex items-center justify-center gap-2 lg:justify-start">
            <OiPulseLogo className="h-9 w-9" pulse={false} />
            <span className="text-xl font-bold tracking-tight">Strik<span className="text-emerald-400">lenz</span></span>
          </div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300">
            Taking a short break
          </div>
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
            Striklenz is <span className="slz-underline-accent">brewing</span> <Coffee className="inline h-8 w-8 text-emerald-400" />
          </h1>
          <p className="mx-auto mt-5 max-w-md text-base leading-7 text-slate-300 lg:mx-0">
            We're tuning the market engine to make it faster and sharper. No action is required — the desk will be back in a moment.
          </p>
          <button type="button" onClick={onRetry} disabled={retrying}
            className="slz-btn-primary mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60">
            <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {retrying ? "Checking…" : "Try again"}
          </button>
          <div className="mt-6 hidden flex-wrap items-center gap-2 sm:flex">
            <TickerChip label="NIFTY" d={snap.indices.NIFTY} />
            <TickerChip label="BANKNIFTY" d={snap.indices.BANKNIFTY} />
            <TickerChip label="SENSEX" d={snap.indices.SENSEX} />
          </div>
          <div className="mt-6 text-xs text-slate-400">Need help? <a href="mailto:support@striklenz.com" className="font-semibold text-emerald-400 hover:underline">support@striklenz.com</a></div>
        </div>

        <div className="slz-scene relative mx-auto w-full max-w-xl">
          <motion.div className="slz-tilt" animate={{ y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <div className="slz-browser">
              <div className="slz-browser-bar">
                <span className="slz-dot" style={{ background: "#ff5f57" }} /><span className="slz-dot" style={{ background: "#febc2e" }} /><span className="slz-dot" style={{ background: "#28c840" }} />
                <span className="slz-url slz-mono">striklenz.com</span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-300"><span className="h-2 w-2 rounded-full bg-amber-400" /> MAINTENANCE</span>
              </div>
              <div className="relative">
                <img src="/shots/maint-scene.jpg" alt="Striklenz is brewing" className="block w-full" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                    <motion.div className="h-full bg-emerald-400" animate={{ x: ["-100%", "260%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} style={{ width: "38%" }} />
                  </div>
                  <div className="mt-1.5 slz-mono text-[11px] text-emerald-200">recalibrating OI feed…</div>
                </div>
              </div>
            </div>
          </motion.div>
          <motion.div className="absolute -left-4 top-6 hidden rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 shadow-xl backdrop-blur md:block"
            animate={{ y: [0, 9, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="text-[9px] font-semibold text-slate-400">STATUS</div>
            <div className="flex items-center gap-1.5 slz-mono text-xs font-bold text-emerald-400"><span className="slz-live-dot" /> Back soon</div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
