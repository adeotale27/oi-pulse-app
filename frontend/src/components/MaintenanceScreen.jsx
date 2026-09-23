import { Link } from "react-router-dom";
import { Code2, RefreshCw, Wrench } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";
import StrikLenzRobot from "@/components/StrikLenzRobot";
import AuthFeatureFooter from "@/components/AuthFeatureFooter";

export default function MaintenanceScreen({ onRetry, retrying = false }) {
  return (
    <div className="oi-maintenance-screen relative flex min-h-screen items-center justify-center overflow-hidden bg-[#041014] px-4 py-8 text-white sm:px-6">
      <div className="oi-maintenance-grid relative grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div className="oi-maintenance-copy text-center lg:text-left">
          <div className="mb-6 flex items-center justify-center gap-3 lg:justify-start">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.07] p-1.5 shadow-2xl shadow-black/30">
              <OiPulseLogo className="h-full w-full" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">StrikLenz</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Command the desk. Spot bias. Act on OI.</div>
            </div>
          </div>
          <div className="oi-maintenance-status mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em]">
            <Wrench className="h-3.5 w-3.5 oi-maintenance-wrench" />
            System status · Temporarily unavailable
          </div>
          <h1 className="text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl">
            StrikLenz is<br /><span className="text-emerald-400">Brewing.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-slate-300 lg:mx-0">
            Something unexpected happened behind the scenes.
          </p>
          <p className="mt-2 max-w-md text-xs leading-5 text-slate-400 lg:mx-0">
            We&apos;re already looking into it while StrikLenz takes a tiny coffee break.
          </p>
          <button type="button" onClick={onRetry} disabled={retrying} data-testid="maintenance-retry" className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/20 px-6 text-sm font-bold text-emerald-50 shadow-lg shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-400/30 disabled:opacity-60">
            <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {retrying ? "Checking…" : "Try Again"}
          </button>
          <div className="mt-6 text-xs text-slate-500">
            Admin? <Link to="/admin" className="font-semibold text-emerald-300 hover:underline">Sign in here</Link>
          </div>
        </div>
        <div className="oi-brewing-scene relative mx-auto h-[22rem] w-full max-w-[38rem] sm:h-[29rem]" aria-label="Robot brewing coffee and working on a desk repair">
          <div className="oi-data-stream oi-data-stream-one"><i /><i /><i /></div>
          <div className="oi-data-stream oi-data-stream-two"><i /><i /><i /></div>
          <div className="oi-monitor oi-monitor-back"><div className="oi-code-lines"><i /><i /><i /><i /></div><Code2 className="h-5 w-5 text-emerald-300" /></div>
          <div className="oi-monitor oi-monitor-front"><div className="oi-chart-line"><span /><span /><span /><span /></div></div>
          <div className="oi-code-card"><span>STRIKLENZ</span><b>BREWING...</b><small>checking the desk...</small></div>
          <div className="oi-desk" />
          <StrikLenzRobot variant="maintenance" />
        </div>
      </div>
      <AuthFeatureFooter />
      <div className="oi-maintenance-footer">Meanwhile, our admin has been politely asked to stop drinking coffee and fix things. ☕</div>
    </div>
  );
}
