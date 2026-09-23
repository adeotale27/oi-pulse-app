import React from "react";
import OiPulseLogo from "@/components/OiPulseLogo";

// Wraps a REAL Striklenz screenshot in a browser frame and layers a subtle
// live overlay (moving index chip + LIVE badge) so an authentic snapshot still
// feels alive. The screenshot itself is unaltered product imagery.
export default function ShotFrame({ src, alt = "Striklenz", title = "Striklenz Terminal", snap, chipIndex = "NIFTY", className = "", showChip = true }) {
  const d = snap?.indices?.[chipIndex];
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <div className={`slz-browser ${className}`}>
      <div className="slz-browser-bar">
        <span className="slz-dot" style={{ background: "#ff5f57" }} />
        <span className="slz-dot" style={{ background: "#febc2e" }} />
        <span className="slz-dot" style={{ background: "#28c840" }} />
        <span className="slz-url slz-mono">🔒 striklenz.com/dashboard</span>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><span className="slz-live-dot" /> LIVE</span>
      </div>
      <div className="relative bg-white">
        <img src={src} alt={alt} loading="lazy" className="block w-full select-none" draggable={false} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0) 82%, rgba(15,23,42,0.05) 100%)" }} />
        {showChip && d && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-1.5 shadow-lg backdrop-blur">
            <OiPulseLogo className="h-4 w-4" pulse={false} />
            <div className="leading-none">
              <div className="text-[9px] font-semibold text-slate-500">{chipIndex}</div>
              <div className="slz-mono text-xs font-bold text-slate-900">{Number(d.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
            </div>
            <span className={`slz-mono text-[10px] font-bold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "▲" : "▼"}{Math.abs(d.changePct).toFixed(2)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
