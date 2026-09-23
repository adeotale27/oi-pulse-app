import React, { useMemo } from "react";

const L = (n) => `${(Number(n) / 100000).toFixed(2)}L`;
const fmt = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Dense OI-change bar series that drifts with the live snapshot, styled to match
// the real Striklenz light terminal (green = Put OI, red = Call OI, hollow = change).
function useSeries(snap) {
  const atm = snap?.chain?.atm || 74800;
  const pressure = snap?.pressure ?? 60;
  return useMemo(() => {
    const rows = [];
    for (let i = -13; i <= 12; i++) {
      const strike = atm + i * 100;
      const puttish = i <= 0;
      const dist = Math.abs(i);
      const base = 8 + Math.max(0, 20 - dist * 1.6);
      const jitter = ((strike + pressure) % 7) * 1.3;
      const pe = puttish ? base + jitter : base * 0.35 + jitter * 0.4;
      const ce = !puttish ? base + jitter : base * 0.35 + jitter * 0.4;
      rows.push({
        strike,
        atm: strike === atm,
        pe: Math.max(1.5, pe),
        ce: Math.max(1.5, ce),
        peChg: Math.max(0.5, pe * (0.25 + ((strike % 5) / 12))),
        ceChg: Math.max(0.5, ce * (0.25 + ((strike % 4) / 12))),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atm, Math.round(pressure / 4)]);
}

function OIChart({ snap }) {
  const rows = useSeries(snap);
  const max = Math.max(...rows.map((r) => Math.max(r.pe, r.ce)));
  const spot = snap?.indices?.SENSEX?.price ?? 84928;
  const atm = snap?.chain?.atm || 74800;
  const atmIdx = rows.findIndex((r) => r.atm);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-700">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-500 text-[9px] text-white">S</span>
          OI Change · Live
        </div>
        <span className="slz-mono text-[10px] text-slate-400">ATM {atm} · PCR {snap?.pcr?.toFixed(2)}</span>
      </div>
      <div className="relative flex h-[150px] items-end gap-[3px]">
        {rows.map((r, i) => (
          <div key={i} className="relative flex flex-1 flex-col items-center justify-end">
            {/* change (hollow) cap */}
            <div className="w-full" style={{ height: `${(Math.max(r.peChg, r.ceChg) / max) * 40}px` }}>
              <div className="mx-auto h-full w-[70%] rounded-t-sm border" style={{ borderColor: r.pe >= r.ce ? "#16a34a" : "#ef4444" }} />
            </div>
            {/* filled OI */}
            <div className="slz-bar w-full rounded-t-sm" style={{ height: `${(Math.max(r.pe, r.ce) / max) * 100}px`, background: r.pe >= r.ce ? "#16a34a" : "#ef4444" }} />
            {r.atm && <span className="absolute -top-3 whitespace-nowrap slz-mono text-[8px] font-bold text-slate-500">ATM</span>}
          </div>
        ))}
        {atmIdx >= 0 && (
          <div className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-slate-400" style={{ left: `${(atmIdx / rows.length) * 100}%` }} />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[9px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Put OI</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500" /> Call OI</span>
        <span className="ml-auto slz-mono">Spot {fmt(spot)}</span>
      </div>
    </div>
  );
}

function StatCards({ snap }) {
  const spot = snap?.indices?.SENSEX?.price ?? 84928;
  const res = Math.ceil(spot / 100) * 100 + 100;
  const sup = Math.floor(spot / 100) * 100 - 200;
  const cards = [
    ["BIAS", (snap?.pressure ?? 50) < 50 ? "Bearish" : "Bullish", (snap?.pressure ?? 50) < 50 ? "text-rose-600" : "text-emerald-600"],
    ["PCR", snap?.pcr?.toFixed(2), "text-slate-800"],
    ["MAX PAIN", (Math.round(spot / 100) * 100).toString(), "text-slate-800"],
    ["SUPPORT", sup.toString(), "text-emerald-600"],
    ["RESIST", res.toString(), "text-rose-600"],
  ];
  return (
    <div className="mt-2 grid grid-cols-5 gap-1.5">
      {cards.map(([t, v, c]) => (
        <div key={t} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{t}</div>
          <div className={`slz-mono text-[11px] font-bold ${c}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const POS = [
  ["SENSEX 69500 PE", "PUT", 340, 0.85, 0.70, -238],
  ["SENSEX 73500 PE", "PUT", 280, 9.94, 5.75, 1174],
  ["SENSEX 75800 CE", "CALL", 340, 14.15, 6.30, 2669],
  ["SENSEX 76000 CE", "CALL", 220, 9.48, 4.35, 1129],
  ["SENSEX 78600 CE", "CALL", 200, 0.90, 1.10, 40],
  ["SENSEX 79400 CE", "CALL", 240, 0.83, 0.65, -156],
];

function Positions({ snap }) {
  const drift = Math.round((snap?.pressure ?? 50) - 50) * 3;
  const total = POS.reduce((a, p) => a + p[5], 0) + drift;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-[11px] font-semibold text-slate-700">Live Positions · 6 open</span>
        <span className={`slz-mono text-[11px] font-bold ${total >= 0 ? "text-emerald-600" : "text-rose-600"}`}>P&amp;L {total >= 0 ? "+" : ""}₹{Math.abs(total).toLocaleString("en-IN")}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-3 py-1 text-[8px] font-semibold uppercase text-slate-400">
        <span>Instrument</span><span className="text-right">Avg</span><span className="text-right">LTP</span><span className="text-right">P&amp;L</span>
      </div>
      {POS.map((p, i) => {
        const pnl = p[5] + (i % 2 === 0 ? drift : -drift);
        return (
          <div key={p[0]} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 border-t border-slate-50 px-3 py-1.5">
            <div className="flex items-center gap-1.5 truncate">
              <span className={`rounded px-1 py-0.5 text-[8px] font-bold ${p[1] === "PUT" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{p[1]}</span>
              <span className="truncate text-[10px] text-slate-700">{p[0]}</span>
              <span className="slz-mono text-[8px] text-slate-400">×{p[2]}</span>
            </div>
            <span className="slz-mono text-right text-[10px] text-slate-500">{p[3].toFixed(2)}</span>
            <span className="slz-mono text-right text-[10px] text-slate-700">{p[4].toFixed(2)}</span>
            <span className={`slz-mono text-right text-[10px] font-bold ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{pnl >= 0 ? "+" : ""}{pnl}</span>
          </div>
        );
      })}
    </div>
  );
}

function IndexTiles({ snap }) {
  const items = [["NIFTY", snap?.indices?.NIFTY, "#16a34a"], ["BANKNIFTY", snap?.indices?.BANKNIFTY, "#4f46e5"], ["SENSEX", snap?.indices?.SENSEX, "#f59e0b"]];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([label, d, c]) => {
        const up = (d?.changePct ?? 0) >= 0;
        return (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold text-slate-500">{label}</div>
            <div className="slz-mono text-sm font-bold text-slate-900">{fmt(d?.price)}</div>
            <div className={`slz-mono text-[10px] font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "▲" : "▼"} {Math.abs(d?.changePct ?? 0).toFixed(2)}%</div>
            <div className="mt-1.5 h-1 rounded-full" style={{ background: c }} />
          </div>
        );
      })}
    </div>
  );
}

function Pressure({ snap }) {
  const p = snap?.pressure ?? 50;
  const bull = p >= 50;
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white py-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Strike Pressure</div>
      <div className="mt-2 flex h-20 items-end gap-1">
        {Array.from({ length: 20 }).map((_, i) => {
          const on = i < Math.round((p / 100) * 20);
          return <div key={i} className="slz-bar w-2 rounded-sm" style={{ height: `${18 + (i % 7) * 8}px`, background: on ? (bull ? "#16a34a" : "#ef4444") : "#e2e8f0" }} />;
        })}
      </div>
      <div className={`slz-mono mt-2 text-2xl font-bold ${bull ? "text-emerald-600" : "text-rose-600"}`}>{p}</div>
      <div className="text-[11px] text-slate-500">{bull ? "Put writers in control" : "Call writers in control"}</div>
    </div>
  );
}

function Brain() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-600"><span className="h-2 w-2 rounded-full bg-indigo-500" /> POSITION BRAIN</div>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-relaxed text-slate-700">
        Your <b className="text-slate-900">SENSEX 75800 CE short</b> sits just under the heaviest call wall. OI is <span className="text-emerald-600">building</span> at 75800 — writers defending. The book is <b>seller-friendly</b>; theta is working for you.
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Risk", "Contained", "text-emerald-600"], ["Score", "75 / 100", "text-slate-800"], ["Theta/day", "+₹6,152", "text-emerald-600"]].map(([t, v, c]) => (
          <div key={t} className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[9px] text-slate-400">{t}</div><div className={`slz-mono text-[11px] font-bold ${c}`}>{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function DeskAi() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> DESK AI</div>
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-emerald-500/10 p-2.5 text-xs text-emerald-800">Is my SENSEX book safe into expiry?</div>
      <div className="mr-auto max-w-[88%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-2.5 text-xs leading-relaxed text-slate-700">
        Both wings sit outside the active OI walls (75800 / 76000) and theta earns +₹6,152/day. Hold unless SENSEX closes beyond a wall — then roll the tested side. Want the adjustment?
      </div>
    </div>
  );
}

export default function ProductScreen({ id = "dashboard", snap }) {
  switch (id) {
    case "oi":
    case "chain-nifty":
    case "chain-banknifty":
    case "chain-sensex":
      return <div><OIChart snap={snap} /><StatCards snap={snap} /></div>;
    case "positions":
      return <Positions snap={snap} />;
    case "pressure":
      return <Pressure snap={snap} />;
    case "structure":
      return <div><StatCards snap={snap} /><div className="mt-2"><OIChart snap={snap} /></div></div>;
    case "brain":
      return <Brain />;
    case "deskai":
      return <DeskAi />;
    case "dashboard":
    default:
      return (
        <div className="space-y-2">
          <IndexTiles snap={snap} />
          <div className="grid grid-cols-[1.6fr_1fr] gap-2">
            <OIChart snap={snap} />
            <Pressure snap={snap} />
          </div>
        </div>
      );
  }
}
