import { useEffect, useMemo, useState } from "react";
import { X, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computeIndexPayoff,
  groupPositionsByIndex,
  buildOiBars,
  sigmaBands,
  resolvePositionSpot,
} from "@/lib/positionPayoff";

function fmt(v, dp = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

function PayoffSvg({
  spots,
  expiryPnl,
  targetPnl,
  spot,
  oiBars = [],
  sd = null,
  width = 640,
  height = 280,
}) {
  if (!spots?.length) {
    return <div className="h-[280px] flex items-center justify-center text-xs text-slate-400">No payoff data</div>;
  }
  const pad = { l: 48, r: 16, t: 16, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const allY = [...expiryPnl, ...targetPnl, 0];
  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const xMin = spots[0];
  const xMax = spots[spots.length - 1];
  const xScale = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * w;
  const yScale = (y) => pad.t + ((yMax - y) / (yMax - yMin)) * h;
  const pathOf = (ys) =>
    ys.map((y, i) => `${i === 0 ? "M" : "L"}${xScale(spots[i]).toFixed(1)},${yScale(y).toFixed(1)}`).join(" ");
  const zeroY = yScale(0);
  const spotX = xScale(spot);
  const barMaxH = h * 0.35;
  const barW = Math.max(2, Math.min(10, w / Math.max(oiBars.length * 2.2, 1)));

  const sdLines = sd
    ? [
        { x: sd.m2, label: "-2σ", color: "#94a3b8" },
        { x: sd.m1, label: "-1σ", color: "#64748b" },
        { x: sd.p1, label: "+1σ", color: "#64748b" },
        { x: sd.p2, label: "+2σ", color: "#94a3b8" },
      ].filter((d) => d.x >= xMin && d.x <= xMax)
    : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" data-testid="payoff-svg">
      {/* OI bars behind curves */}
      {oiBars.map((b) => {
        const cx = xScale(b.strike);
        if (cx < pad.l || cx > width - pad.r) return null;
        const ceH = b.ce * barMaxH;
        const peH = b.pe * barMaxH;
        return (
          <g key={`oi-${b.strike}`}>
            <rect
              x={cx - barW - 0.5}
              y={height - pad.b - ceH}
              width={barW}
              height={ceH}
              fill="#fda4af"
              opacity="0.45"
            />
            <rect
              x={cx + 0.5}
              y={height - pad.b - peH}
              width={barW}
              height={peH}
              fill="#6ee7b7"
              opacity="0.45"
            />
          </g>
        );
      })}

      <line x1={pad.l} x2={width - pad.r} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth="1" />

      {sdLines.map((d) => (
        <g key={d.label}>
          <line
            x1={xScale(d.x)}
            x2={xScale(d.x)}
            y1={pad.t}
            y2={height - pad.b}
            stroke={d.color}
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <text x={xScale(d.x) + 2} y={height - pad.b - 4} fill={d.color} style={{ fontSize: 9 }}>
            {d.label}
          </text>
        </g>
      ))}

      <line x1={spotX} x2={spotX} y1={pad.t} y2={height - pad.b} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={pathOf(expiryPnl)} fill="none" stroke="#e11d48" strokeWidth="2" />
      <path d={pathOf(targetPnl)} fill="none" stroke="#2563eb" strokeWidth="2" />
      <text x={spotX + 4} y={pad.t + 12} className="fill-emerald-700" style={{ fontSize: 10 }}>
        Spot {Math.round(spot)}
      </text>
      <text x={pad.l} y={height - 8} className="fill-slate-400" style={{ fontSize: 10 }}>{Math.round(xMin)}</text>
      <text x={width - pad.r - 36} y={height - 8} className="fill-slate-400" style={{ fontSize: 10 }}>{Math.round(xMax)}</text>
      <text x={8} y={pad.t + 8} className="fill-slate-400" style={{ fontSize: 10 }}>{fmt(yMax, 0)}</text>
      <text x={8} y={height - pad.b} className="fill-slate-400" style={{ fontSize: 10 }}>{fmt(yMin, 0)}</text>
    </svg>
  );
}

export default function PositionsAnalyzeModal({
  open,
  onClose,
  rows = [],
  spotByIndex = {},
  fallbackSpot = null,
  oiByIndex = null, // { NIFTY: { strikes, price, vix } }
  vix = null,
}) {
  const byIndex = useMemo(() => groupPositionsByIndex(rows), [rows]);
  const indices = useMemo(() => Array.from(byIndex.keys()), [byIndex]);
  const [activeIndex, setActiveIndex] = useState(indices[0] || "NIFTY");
  const [selected, setSelected] = useState(() => new Set());
  const [targetFrac, setTargetFrac] = useState(0);

  useEffect(() => {
    if (!open) return;
    const first = indices[0];
    if (first) setActiveIndex(first);
  }, [open, indices]);

  useEffect(() => {
    if (!open) return;
    const legs = byIndex.get(activeIndex) || [];
    setSelected(new Set(legs.map((l) => l.tradingsymbol)));
  }, [open, activeIndex, byIndex]);

  const legs = byIndex.get(activeIndex) || [];
  const activeLegs = legs.filter((l) => selected.has(l.tradingsymbol));

  const spot = resolvePositionSpot(
    { index: activeIndex },
    spotByIndex,
    oiByIndex?.[activeIndex]?.price ?? fallbackSpot,
  );

  const oiPack = oiByIndex?.[activeIndex] || null;
  const oiBars = useMemo(
    () => buildOiBars(oiPack?.strikes || []),
    [oiPack],
  );

  // IV for σ bands: median of selected legs with IV, else India VIX
  const bandIv = useMemo(() => {
    const ivs = activeLegs.map((l) => l.iv).filter((x) => Number.isFinite(x) && x > 0);
    if (ivs.length) {
      const sorted = [...ivs].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] / 100;
    }
    const v = Number(oiPack?.vix ?? vix);
    return Number.isFinite(v) && v > 0 ? v / 100 : 0.15;
  }, [activeLegs, oiPack, vix]);

  const dteDays = useMemo(() => {
    const ds = activeLegs.map((l) => l.dte).filter((x) => Number.isFinite(x));
    return ds.length ? Math.max(...ds) : 1;
  }, [activeLegs]);

  const sd = useMemo(
    () => (spot != null ? sigmaBands(spot, bandIv, dteDays) : null),
    [spot, bandIv, dteDays],
  );

  const payoff = useMemo(
    () =>
      computeIndexPayoff({
        legs: activeLegs,
        spot,
        targetFraction: targetFrac,
      }),
    [activeLegs, spot, targetFrac],
  );

  if (!open) return null;

  const toggle = (sym) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  const indexPnl = legs.reduce((a, l) => a + (l.pnl || 0), 0);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-2 sm:p-4"
      data-testid="positions-analyze-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-md shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-200">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <LineChart className="w-4 h-4 text-orange-600" />
            Analyze · Positions
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose} data-testid="analyze-close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr_200px]">
          {/* Left: indices + legs */}
          <div className="border-r border-slate-200 overflow-auto bg-white">
            <div className="p-2 space-y-1 border-b border-slate-100">
              {indices.length === 0 ? (
                <div className="text-[11px] text-slate-400 p-2">No option legs</div>
              ) : (
                indices.map((idx) => {
                  const list = byIndex.get(idx) || [];
                  const pnl = list.reduce((a, l) => a + (l.pnl || 0), 0);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      data-testid={`analyze-index-${idx}`}
                      className={`w-full text-left rounded-sm px-2 py-1.5 text-xs ${
                        activeIndex === idx
                          ? "bg-emerald-50 border border-emerald-200 text-emerald-950"
                          : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <div className="font-semibold">{idx}</div>
                      <div className={`font-mono-data ${pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmt(pnl, 0)} · {list.length} legs
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 px-1">Legs</div>
              {legs.map((l) => (
                <label
                  key={l.tradingsymbol}
                  className="flex items-start gap-2 px-1 py-1 text-[11px] cursor-pointer hover:bg-slate-50 rounded-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(l.tradingsymbol)}
                    onChange={() => toggle(l.tradingsymbol)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`font-bold ${l.quantity < 0 ? "text-rose-600" : "text-sky-700"}`}>
                      {l.quantity < 0 ? "S" : "B"}
                    </span>{" "}
                    <span className="font-mono-data">{Math.abs(l.quantity)}×</span>{" "}
                    <span className="text-slate-800">{l.strike}{l.side}</span>
                    <div className={`font-mono-data ${l.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(l.pnl, 0)}
                    </div>
                  </span>
                </label>
              ))}
              <div className="text-[11px] font-semibold px-1 pt-1 border-t border-slate-100 flex justify-between">
                <span>Total</span>
                <span className={`font-mono-data ${indexPnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmt(indexPnl, 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Center: metrics + chart */}
          <div className="overflow-auto p-3 space-y-3 bg-white">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Metric label="Max profit" value={fmt(payoff.summary.maxProfit, 0)} tone="emerald" />
              <Metric
                label="Profit left"
                value={payoff.summary.profitLeft != null ? fmt(payoff.summary.profitLeft, 0) : "—"}
                tone="slate"
              />
              <Metric
                label="Max loss"
                value={payoff.summary.unlimitedLoss ? "Unlimited" : fmt(payoff.summary.maxLoss, 0)}
                tone="rose"
              />
              <Metric label="Current P&L" value={fmt(payoff.summary.currentPnl, 0)} tone={payoff.summary.currentPnl >= 0 ? "emerald" : "rose"} />
            </div>
            <div className="text-[11px] text-slate-600">
              Breakeven:{" "}
              {payoff.summary.breakevens?.length
                ? payoff.summary.breakevens.map((b) => Math.round(b)).join(", ")
                : "—"}
              {spot != null && payoff.summary.breakevens?.length > 0 && (
                <span className="text-slate-400">
                  {" "}
                  (
                  {payoff.summary.breakevens
                    .map((b) => `${(((b - spot) / spot) * 100).toFixed(1)}%`)
                    .join(", ")}
                  )
                </span>
              )}
              {sd && (
                <span className="text-slate-400 ml-2">
                  · 1σ ≈ ₹{Math.round(sd.oneSigma)} ({(bandIv * 100).toFixed(0)}% IV · {dteDays.toFixed?.(1) ?? dteDays}d)
                </span>
              )}
            </div>
            <div className="rounded-md border border-slate-200 p-2">
              <div className="flex flex-wrap items-center gap-3 text-[10px] mb-1">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-500 inline-block" /> On expiry</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-600 inline-block" /> Target date</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 bg-rose-300/80 inline-block" /> Call OI</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-300/80 inline-block" /> Put OI</span>
                <span className="inline-flex items-center gap-1 text-slate-500">σ bands</span>
              </div>
              <PayoffSvg
                spots={payoff.spots}
                expiryPnl={payoff.expiryPnl}
                targetPnl={payoff.targetPnl}
                spot={payoff.spot || spot || 0}
                oiBars={oiBars}
                sd={sd}
              />
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                <label className="shrink-0">Time → expiry</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(targetFrac * 100)}
                  onChange={(e) => setTargetFrac(Number(e.target.value) / 100)}
                  className="flex-1"
                  data-testid="analyze-time-slider"
                />
                <span className="font-mono-data w-10 text-right">{Math.round(targetFrac * 100)}%</span>
              </div>
              {!oiBars.length && (
                <div className="text-[10px] text-slate-400 mt-1 italic">
                  OI overlay needs a live snapshot for {activeIndex} (open that index tab once to warm cache).
                </div>
              )}
            </div>
          </div>

          {/* Right: greeks */}
          <div className="border-l border-slate-200 p-3 space-y-3 overflow-auto bg-slate-50/50">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Summary</div>
            <div className="text-xs space-y-1.5">
              <Row k="POP (range)" v={`${payoff.summary.popHint ?? "—"}%`} />
              <Row k="Spot" v={spot != null ? Number(spot).toFixed(2) : "—"} />
            </div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 pt-2">Greeks</div>
            <div className="text-xs space-y-1.5 font-mono-data">
              <Row k="Net Δ" v={payoff.greeks.delta?.toFixed?.(2) ?? "—"} />
              <Row k="Net Γ" v={payoff.greeks.gamma != null ? (payoff.greeks.gamma * 1e4).toFixed(2) + "e-4" : "—"} />
              <Row k="Net Θ / day" v={payoff.greeks.theta != null ? fmt(payoff.greeks.theta, 0) : "—"} />
              <Row k="Net Vega" v={payoff.greeks.vega?.toFixed?.(1) ?? "—"} />
            </div>
            <p className="text-[10px] text-slate-400 leading-snug pt-2">
              Read-only analysis from your open Kite legs. No orders are placed. Credentials never leave the server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  const cls =
    tone === "emerald"
      ? "text-emerald-800"
      : tone === "rose"
        ? "text-rose-800"
        : "text-slate-800";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`font-mono-data font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="font-semibold text-slate-800">{v}</span>
    </div>
  );
}
