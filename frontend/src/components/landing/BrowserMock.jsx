import React from "react";
import ProductScreen from "@/components/landing/ProductScreen";

// Light Striklenz terminal frame (mirrors the real product UI) with a floating
// live SENSEX chip overlay for that "live terminal" feel.
export default function BrowserMock({ id = "dashboard", snap, title = "Striklenz Terminal", className = "", showChip = true, chipIndex = "SENSEX", marketOpen = true }) {
  const d = snap?.indices?.[chipIndex];
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <div className={`slz-browser ${className}`}>
      <div className="slz-browser-bar">
        <span className="slz-dot" style={{ background: "#ff5f57" }} />
        <span className="slz-dot" style={{ background: "#febc2e" }} />
        <span className="slz-dot" style={{ background: "#28c840" }} />
        <span className="slz-url slz-mono">🔒 striklenz.com/dashboard</span>
        <span className={`flex items-center gap-1 text-[10px] font-semibold ${marketOpen ? "text-emerald-400" : "text-slate-400"}`}><span className={marketOpen ? "slz-live-dot" : "h-1.5 w-1.5 rounded-full bg-slate-500"} /> {marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span>
      </div>
      <div className="relative bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500">{title}</span>
          <span className="slz-mono text-[10px] text-slate-400">Auto-refresh · 15s</span>
        </div>
        <ProductScreen id={id} snap={snap} />
        {showChip && d && (
          <div className="pointer-events-none absolute right-3 top-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-500 text-[10px] font-bold text-white">S</span>
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
