import React from "react";

const fmt = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const k = (n) => {
  const s = n < 0 ? "-" : "+";
  const a = Math.abs(n);
  return `${s}${(a / 1000).toFixed(1)}K`;
};

function IndexTile({ label, data, accent }) {
  const up = (data?.changePct ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-slate-300">{label}</span>
        <span className="slz-live-dot" />
      </div>
      <div className="slz-mono mt-1 text-lg font-semibold text-white slz-num-flash">{fmt(data?.price)}</div>
      <div className={`slz-mono text-xs font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
        {up ? "▲" : "▼"} {up ? "+" : ""}{(data?.changePct ?? 0).toFixed(2)}%
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" style={{ background: accent }} />
    </div>
  );
}

function ChainScreen({ snap, index = "NIFTY", accent = "#10b981" }) {
  const chain = snap?.chain;
  const rows = chain?.rows || [];
  const maxOi = Math.max(1, ...rows.map((r) => Math.max(r.ce_oi, r.pe_oi)));
  const px = snap?.indices?.[index]?.price;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="slz-chip" style={{ background: "rgba(16,185,129,0.16)", color: "#6ee7b7" }}>{index}</span>
          <span className="slz-mono text-sm font-semibold text-white">{fmt(px)}</span>
        </div>
        <span className="slz-chip" style={{ background: "rgba(148,163,184,0.12)", color: "#cbd5e1" }}>PCR {snap?.pcr?.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-[10px]">
        <div className="text-right text-rose-300">CALL OI</div>
        <div className="text-center text-slate-400">STRIKE</div>
        <div className="text-left text-emerald-300">PUT OI</div>
        {rows.map((r) => (
          <React.Fragment key={r.strike}>
            <div className="flex items-center justify-end gap-1.5">
              <span className="slz-mono text-[10px] text-rose-200">{k(r.ce_chg)}</span>
              <div className="slz-bar h-2.5" style={{ width: `${(r.ce_oi / maxOi) * 70 + 8}px`, background: "linear-gradient(90deg,#fb7185,#f43f5e)" }} />
            </div>
            <div className={`slz-mono text-center text-[11px] ${r.atm ? "rounded bg-white/10 px-1 font-bold text-white" : "text-slate-300"}`}>{r.strike}</div>
            <div className="flex items-center gap-1.5">
              <div className="slz-bar h-2.5" style={{ width: `${(r.pe_oi / maxOi) * 70 + 8}px`, background: "linear-gradient(90deg,#34d399,#10b981)" }} />
              <span className="slz-mono text-[10px] text-emerald-200">{k(r.pe_chg)}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function DashboardScreen({ snap }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <IndexTile label="NIFTY 50" data={snap?.indices?.NIFTY} accent="linear-gradient(90deg,#10b981,#34d399)" />
        <IndexTile label="BANK NIFTY" data={snap?.indices?.BANKNIFTY} accent="linear-gradient(90deg,#4f46e5,#818cf8)" />
        <IndexTile label="SENSEX" data={snap?.indices?.SENSEX} accent="linear-gradient(90deg,#f59e0b,#fbbf24)" />
      </div>
      <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300"><span>NIFTY · OI Distribution</span><span className="text-emerald-400">LIVE</span></div>
          <div className="flex h-24 items-end gap-1.5">
            {(snap?.chain?.rows || []).map((r, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                <div className="slz-bar w-full" style={{ height: `${(r.ce_oi / 130000) * 100}%`, background: "#f43f5e" }} />
                <div className="slz-bar w-full" style={{ height: `${(r.pe_oi / 130000) * 100}%`, background: "#10b981" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[11px] text-slate-300">Strike Pressure</div>
          <div className="slz-mono mt-1 text-2xl font-bold text-white">{snap?.pressure}</div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="slz-bar h-full" style={{ width: `${snap?.pressure}%`, background: "linear-gradient(90deg,#10b981,#4f46e5)" }} />
          </div>
          <div className="mt-3 text-[11px] text-slate-300">PCR</div>
          <div className="slz-mono text-lg font-semibold text-white">{snap?.pcr?.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function PressureScreen({ snap }) {
  const p = snap?.pressure ?? 50;
  const bull = p >= 50;
  return (
    <div className="flex flex-col items-center py-2">
      <div className="text-[11px] uppercase tracking-widest text-slate-400">Strike Pressure</div>
      <div className="relative mt-3 flex h-28 w-full items-end justify-center gap-1">
        {Array.from({ length: 24 }).map((_, i) => {
          const active = i < Math.round((p / 100) * 24);
          return <div key={i} className="slz-bar w-2 rounded-sm" style={{ height: `${20 + (i % 8) * 9}px`, background: active ? (bull ? "#10b981" : "#f43f5e") : "rgba(148,163,184,0.18)" }} />;
        })}
      </div>
      <div className={`slz-mono mt-3 text-3xl font-bold ${bull ? "text-emerald-400" : "text-rose-400"}`}>{p}</div>
      <div className="text-xs text-slate-400">{bull ? "Put writers in control — bullish tilt" : "Call writers in control — bearish tilt"}</div>
    </div>
  );
}

function StructureScreen({ snap }) {
  const px = snap?.indices?.NIFTY?.price ?? 25800;
  const res = Math.ceil(px / 50) * 50 + 50;
  const sup = Math.floor(px / 50) * 50 - 50;
  return (
    <div className="py-1">
      <div className="mb-2 text-[11px] uppercase tracking-widest text-slate-400">Market Structure · NIFTY</div>
      {[{ t: "Resistance", v: res, c: "#f43f5e" }, { t: "Spot", v: px, c: "#e5edf7" }, { t: "Support", v: sup, c: "#10b981" }].map((r) => (
        <div key={r.t} className="mb-2 flex items-center gap-3">
          <span className="w-20 text-xs text-slate-400">{r.t}</span>
          <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${r.c}, transparent)` }} />
          <span className="slz-mono text-sm font-semibold" style={{ color: r.c }}>{fmt(r.v)}</span>
        </div>
      ))}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-300">Range read: price coiling between support and resistance — OI walls are holding.</div>
    </div>
  );
}

function PositionsScreen({ snap }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
        <span>Your Positions</span>
        <span className={`slz-mono font-bold ${(snap?.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>P&amp;L {(snap?.totalPnl ?? 0) >= 0 ? "+" : ""}₹{Math.abs(snap?.totalPnl ?? 0).toLocaleString("en-IN")}</span>
      </div>
      <div className="space-y-1.5">
        {(snap?.positions || []).map((p) => (
          <div key={p.sym} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className={`slz-chip !px-2 !py-0.5 ${p.side === "SHORT" ? "text-rose-200" : "text-emerald-200"}`} style={{ background: p.side === "SHORT" ? "rgba(244,63,94,0.16)" : "rgba(16,185,129,0.16)" }}>{p.side}</span>
              <span className="text-xs text-slate-200">{p.sym}</span>
            </div>
            <div className="flex items-center gap-3 slz-mono text-[11px]">
              <span className="text-slate-400">{p.ltp}</span>
              <span className={`font-bold ${p.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{p.pnl >= 0 ? "+" : ""}{p.pnl.toLocaleString("en-IN")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrainScreen({ snap }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-indigo-300"><span className="h-2 w-2 rounded-full bg-indigo-400" /> POSITION BRAIN</div>
      <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/[0.06] p-3 text-xs leading-relaxed text-slate-200">
        Your <b className="text-white">NIFTY 25900 CE short</b> sits right under the heaviest call wall. OI is <span className="text-emerald-300">building</span> at 25900 — writers defending. Net delta of the book is <b className="text-white">mildly short</b>; a close above 25900 would pressure the position.
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Risk", "Moderate", "#f59e0b"], ["Max Loss", "₹12,400", "#f43f5e"], ["Theta/day", "+₹3,150", "#10b981"]].map(([t, v, c]) => (
          <div key={t} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[10px] text-slate-400">{t}</div>
            <div className="slz-mono text-xs font-bold" style={{ color: c }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeskAiScreen() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> DESK AI</div>
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-emerald-500/15 p-2.5 text-xs text-emerald-50">Should I hold my NIFTY short strangle into expiry?</div>
      <div className="mr-auto max-w-[88%] rounded-2xl rounded-tl-sm bg-white/[0.05] p-2.5 text-xs leading-relaxed text-slate-200">
        Both wings are outside the current OI walls (25800 / 25900) and theta is working for you (+₹3,150/day). Keep it unless NIFTY closes beyond a wall — then roll the tested side. Want me to draft the adjustment?
      </div>
    </div>
  );
}

export default function ProductScreen({ id = "dashboard", snap }) {
  switch (id) {
    case "chain-nifty": return <ChainScreen snap={snap} index="NIFTY" />;
    case "chain-banknifty": return <ChainScreen snap={snap} index="BANKNIFTY" />;
    case "chain-sensex": return <ChainScreen snap={snap} index="SENSEX" />;
    case "pressure": return <PressureScreen snap={snap} />;
    case "structure": return <StructureScreen snap={snap} />;
    case "positions": return <PositionsScreen snap={snap} />;
    case "brain": return <BrainScreen snap={snap} />;
    case "deskai": return <DeskAiScreen snap={snap} />;
    case "dashboard":
    default: return <DashboardScreen snap={snap} />;
  }
}
