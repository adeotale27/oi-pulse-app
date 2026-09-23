import React from "react";

// Long/Short markers overlaid on the OI wall chart — the flagship Premium view.
export default function LongShortOI({ snap }) {
  const rows = (snap?.chain?.rows || []).slice().reverse();
  const maxOi = Math.max(1, ...rows.map((r) => Math.max(r.ce_oi, r.pe_oi)));
  const atm = snap?.chain?.atm;
  // Demo markers tied to the two NIFTY positions.
  const shortStrike = atm ? atm + 50 : null;
  const longStrike = atm ? atm - 50 : null;

  return (
    <div className="slz-browser">
      <div className="slz-browser-bar">
        <span className="slz-dot" style={{ background: "#ff5f57" }} />
        <span className="slz-dot" style={{ background: "#febc2e" }} />
        <span className="slz-dot" style={{ background: "#28c840" }} />
        <span className="slz-url slz-mono">🔒 striklenz.com/dashboard · positions on OI</span>
      </div>
      <div className="slz-screen-body">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">NIFTY · Your positions on the OI wall</span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> LONG</span>
            <span className="flex items-center gap-1 text-rose-300"><span className="h-2 w-2 rounded-full bg-rose-400" /> SHORT</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {rows.map((r) => {
            const isShort = r.strike === shortStrike;
            const isLong = r.strike === longStrike;
            return (
              <div key={r.strike} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex items-center justify-end">
                  <div className="slz-bar h-3" style={{ width: `${(r.ce_oi / maxOi) * 100}%`, background: "linear-gradient(90deg,#fb7185,#f43f5e)", opacity: 0.85 }} />
                </div>
                <div className={`slz-mono relative w-16 text-center text-[11px] ${r.atm ? "font-bold text-white" : "text-slate-300"}`}>
                  {r.strike}
                  {isShort && <span className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full whitespace-nowrap rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">SHORT ·50</span>}
                  {isLong && <span className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full whitespace-nowrap rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">LONG ·50</span>}
                </div>
                <div className="flex items-center">
                  <div className="slz-bar h-3" style={{ width: `${(r.pe_oi / maxOi) * 100}%`, background: "linear-gradient(90deg,#34d399,#10b981)", opacity: 0.85 }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[["Entry", "₹142", "#cbd5e1"], ["LTP", `₹${snap?.positions?.[0]?.ltp ?? 96}`, "#e5edf7"], ["P&L", `${(snap?.positions?.[0]?.pnl ?? 2300) >= 0 ? "+" : ""}₹${Math.abs(snap?.positions?.[0]?.pnl ?? 2300).toLocaleString("en-IN")}`, "#34d399"]].map(([t, v, c]) => (
            <div key={t} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] text-slate-400">{t}</div>
              <div className="slz-mono text-sm font-bold" style={{ color: c }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
