import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  LineChart,
  ChevronDown,
  ChevronRight,
  Target,
  Clock3,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  computeIndexPayoff,
  groupPositionsByIndex,
  buildOiBars,
  sigmaBands,
  resolvePositionSpot,
  positionExpiryISO,
} from "@/lib/positionPayoff";
import { dailyThetaRupees, yearsToExpiry } from "@/lib/blackScholes";

function fmt(v, dp = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

function interpAt(spots, ys, x) {
  if (!spots?.length || !ys?.length || x == null) return null;
  if (x <= spots[0]) return ys[0];
  if (x >= spots[spots.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < spots.length; i++) {
    if (x <= spots[i]) {
      const t = (x - spots[i - 1]) / (spots[i] - spots[i - 1] || 1);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

function PayoffSvg({
  spots,
  expiryPnl,
  targetPnl,
  spot,
  targetSpot = null,
  projected = null,
  oiBars = [],
  sd = null,
  width = 640,
  height = 300,
  onPickSpot = null,
}) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null); // { spot, expiry, scenario, x, y }

  const pad = { l: 52, r: 18, t: 20, b: 30 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const scales = useMemo(() => {
    if (!spots?.length) return null;
    const allY = [...expiryPnl, ...targetPnl, 0];
    let yMin = Math.min(...allY);
    let yMax = Math.max(...allY);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const xMin = spots[0];
    const xMax = spots[spots.length - 1];
    return { yMin, yMax, xMin, xMax };
  }, [spots, expiryPnl, targetPnl]);

  if (!spots?.length || !scales) {
    return (
      <div className="h-[280px] flex items-center justify-center text-xs text-slate-400">
        Select open legs to draw the book payoff
      </div>
    );
  }

  const { yMin, yMax, xMin, xMax } = scales;
  const xScale = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * w;
  const yScale = (y) => pad.t + ((yMax - y) / (yMax - yMin || 1)) * h;
  const pathOf = (ys) =>
    ys.map((y, i) => `${i === 0 ? "M" : "L"}${xScale(spots[i]).toFixed(1)},${yScale(y).toFixed(1)}`).join(" ");
  const zeroY = yScale(0);
  const spotX = xScale(spot);
  const tgtX = targetSpot != null ? xScale(targetSpot) : null;
  const barMaxH = h * 0.32;
  const barW = Math.max(2, Math.min(9, w / Math.max(oiBars.length * 2.2, 1)));

  const sdLines = sd
    ? [
        { x: sd.m2, label: "-2σ", color: "#94a3b8" },
        { x: sd.m1, label: "-1σ", color: "#64748b" },
        { x: sd.p1, label: "+1σ", color: "#64748b" },
        { x: sd.p2, label: "+2σ", color: "#94a3b8" },
      ].filter((d) => d.x >= xMin && d.x <= xMax)
    : [];

  const readAt = (clientX) => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * width;
    if (svgX < pad.l || svgX > width - pad.r) return null;
    const t = (svgX - pad.l) / (w || 1);
    const sx = xMin + t * (xMax - xMin);
    const exp = interpAt(spots, expiryPnl, sx);
    const sce = interpAt(spots, targetPnl, sx);
    return {
      spot: sx,
      expiry: exp,
      scenario: sce,
      x: xScale(sx),
      y: yScale(sce ?? exp ?? 0),
    };
  };

  const pinnedRead =
    targetSpot != null && Number.isFinite(targetSpot)
      ? {
          spot: targetSpot,
          expiry: interpAt(spots, expiryPnl, targetSpot),
          scenario: interpAt(spots, targetPnl, targetSpot),
          x: xScale(targetSpot),
          y: yScale(interpAt(spots, targetPnl, targetSpot) ?? 0),
        }
      : null;
  const active = hover || pinnedRead;

  const onPointer = (clientX, { pin = false } = {}) => {
    const next = readAt(clientX);
    if (!next) return;
    if (pin) {
      if (typeof onPickSpot === "function") onPickSpot(Math.round(next.spot));
    } else {
      setHover(next);
    }
  };

  return (
    <div className="relative" data-testid="payoff-chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto cursor-crosshair select-none touch-none"
        data-testid="payoff-svg"
        onMouseMove={(e) => onPointer(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onPointer(e.clientX, { pin: true })}
        onTouchStart={(e) => {
          const t = e.touches?.[0];
          if (t) onPointer(t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches?.[0];
          if (t) onPointer(t.clientX);
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches?.[0];
          if (t) onPointer(t.clientX, { pin: true });
          setHover(null);
        }}
      >
        <defs>
          <linearGradient id="oiPut" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="oiCall" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {oiBars.map((b) => {
          const cx = xScale(b.strike);
          if (cx < pad.l || cx > width - pad.r) return null;
          const ceH = b.ce * barMaxH;
          const peH = b.pe * barMaxH;
          return (
            <g key={`oi-${b.strike}`}>
              <rect x={cx - barW - 0.5} y={height - pad.b - ceH} width={barW} height={ceH} fill="url(#oiCall)" />
              <rect x={cx + 0.5} y={height - pad.b - peH} width={barW} height={peH} fill="url(#oiPut)" />
            </g>
          );
        })}

        <line x1={pad.l} x2={width - pad.r} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth="1.25" />

        {sdLines.map((d) => (
          <g key={d.label}>
            <line
              x1={xScale(d.x)}
              x2={xScale(d.x)}
              y1={pad.t}
              y2={height - pad.b}
              stroke={d.color}
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <text x={xScale(d.x) + 3} y={pad.t + 10} fill={d.color} style={{ fontSize: 9 }}>
              {d.label}
            </text>
          </g>
        ))}

        <line
          x1={spotX}
          x2={spotX}
          y1={pad.t}
          y2={height - pad.b}
          stroke="#059669"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        {tgtX != null && Math.abs((targetSpot || 0) - spot) > 0.5 && (
          <line x1={tgtX} x2={tgtX} y1={pad.t} y2={height - pad.b} stroke="#0f766e" strokeWidth="1.75" />
        )}
        <path d={pathOf(expiryPnl)} fill="none" stroke="#be123c" strokeWidth="2.25" />
        <path d={pathOf(targetPnl)} fill="none" stroke="#0f766e" strokeWidth="2.25" />
        <text x={spotX + 5} y={pad.t + 12} fill="#047857" style={{ fontSize: 10, fontWeight: 600 }}>
          Spot {Math.round(spot)}
        </text>
        {projected != null && tgtX != null && (
          <g>
            <rect
              x={Math.min(tgtX + 6, width - pad.r - 128)}
              y={yScale(projected) - 20}
              width={122}
              height={18}
              rx="3"
              fill="#ecfdf5"
              stroke="#059669"
            />
            <text
              x={Math.min(tgtX + 10, width - pad.r - 124)}
              y={yScale(projected) - 7}
              fill="#065f46"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              At target {fmt(projected, 0)}
            </text>
          </g>
        )}

        {active && (
          <g data-testid="payoff-cursor">
            <line
              x1={active.x}
              x2={active.x}
              y1={pad.t}
              y2={height - pad.b}
              stroke="#0f172a"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              opacity="0.55"
            />
            <circle
              cx={active.x}
              cy={yScale(active.scenario ?? 0)}
              r="4"
              fill="#0f766e"
              stroke="#fff"
              strokeWidth="1.5"
            />
            <circle
              cx={active.x}
              cy={yScale(active.expiry ?? 0)}
              r="3.5"
              fill="#be123c"
              stroke="#fff"
              strokeWidth="1.25"
            />
          </g>
        )}

        <text x={pad.l} y={height - 8} fill="#94a3b8" style={{ fontSize: 10 }}>
          {Math.round(xMin)}
        </text>
        <text x={width - pad.r - 40} y={height - 8} fill="#94a3b8" style={{ fontSize: 10 }}>
          {Math.round(xMax)}
        </text>
        <text x={8} y={pad.t + 8} fill="#94a3b8" style={{ fontSize: 10 }}>
          {fmt(yMax, 0)}
        </text>
        <text x={8} y={height - pad.b} fill="#94a3b8" style={{ fontSize: 10 }}>
          {fmt(yMin, 0)}
        </text>
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[148px] rounded-md border border-slate-200 bg-white/95 px-2.5 py-2 shadow-md backdrop-blur-sm"
          style={{
            left: `min(max(${(active.x / width) * 100}% - 74px, 8px), calc(100% - 156px))`,
            top: 8,
          }}
          data-testid="payoff-tooltip"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Spot {Math.round(active.spot)}
            {!hover && pinnedRead ? " · pinned" : ""}
          </div>
          <div className="mt-1 space-y-0.5 font-mono-data text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-rose-700">Expiry P&L</span>
              <span className={`font-semibold ${active.expiry >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {fmt(active.expiry, 0)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-teal-800">Scenario P&L</span>
              <span className={`font-semibold ${active.scenario >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {fmt(active.scenario, 0)}
              </span>
            </div>
          </div>
          <div className="mt-1 text-[9px] text-slate-400">Tap / click to set target</div>
        </div>
      ) : (
        <div className="px-1 pt-1 text-[10px] text-slate-400" data-testid="payoff-hover-hint">
          Hover or drag for P&amp;L at any spot · tap/click to pin as target
        </div>
      )}
    </div>
  );
}

function ScenarioSlider({
  icon: Icon,
  label,
  hint,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
  presets = [],
  testId,
  disabled = false,
}) {
  return (
    <div
      className="rounded-lg border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/40 to-emerald-50/30 px-3 py-3 shadow-sm"
      data-testid={testId ? `${testId}-wrap` : undefined}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
            {Icon ? <Icon className="w-3.5 h-3.5 text-emerald-700" /> : null}
            {label}
          </div>
          {hint ? <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{hint}</div> : null}
        </div>
        <div className="shrink-0 rounded-md border border-emerald-200/80 bg-white px-2 py-1 font-mono-data text-[12px] font-semibold text-emerald-900 tabular-nums">
          {valueLabel}
        </div>
      </div>

      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(vals) => onChange(vals[0])}
        data-testid={testId}
      />

      {presets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.value)}
              className={`h-6 px-2 rounded-md text-[10px] font-semibold border transition-colors ${
                Math.abs(value - p.value) <= (step || 1) * 0.6
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
              data-testid={p.testId}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Positions Analyze — desk payoff studio for the selected book.
 * Index groups on the left, scenario chart in the center, book read on the right.
 */
export default function PositionsAnalyzeModal({
  open,
  onClose,
  rows = [],
  spotByIndex = {},
  fallbackSpot = null,
  oiByIndex = null,
  vix = null,
  privacyMode = false,
}) {
  const MASK = "••••";
  const money = (v, dp = 0) => (privacyMode ? MASK : fmt(v, dp));
  const byIndex = useMemo(() => groupPositionsByIndex(rows), [rows]);
  const indices = useMemo(() => Array.from(byIndex.keys()), [byIndex]);
  const [activeIndex, setActiveIndex] = useState(indices[0] || "NIFTY");
  const [expanded, setExpanded] = useState(() => new Set(indices.slice(0, 1)));
  const [selected, setSelected] = useState(() => new Set());
  const [targetFrac, setTargetFrac] = useState(0);
  const [targetSpot, setTargetSpot] = useState(null);
  const selectionKeyRef = useRef(null);
  const targetDirtyRef = useRef(false);

  useEffect(() => {
    if (!open) {
      selectionKeyRef.current = null;
      targetDirtyRef.current = false;
      return;
    }
    const first = indices[0];
    if (first && !indices.includes(activeIndex)) {
      setActiveIndex(first);
      setExpanded(new Set([first]));
    } else if (first && selectionKeyRef.current == null) {
      setActiveIndex(first);
      setExpanded(new Set([first]));
    }
  }, [open, indices, activeIndex]);

  // Seed / prune selection — full reset only when modal opens or index changes,
  // never on every positions poll (byIndex identity churn).
  useEffect(() => {
    if (!open) return;
    const key = String(activeIndex);
    const legs = byIndex.get(activeIndex) || [];
    const openSyms = legs
      .filter((l) => !l.exited && Number(l.quantity) !== 0)
      .map((l) => l.tradingsymbol);
    if (selectionKeyRef.current !== key) {
      selectionKeyRef.current = key;
      targetDirtyRef.current = false;
      setSelected(new Set(openSyms));
      return;
    }
    setSelected((prev) => {
      const alive = new Set(openSyms);
      let changed = false;
      const next = new Set();
      for (const s of prev) {
        if (alive.has(s)) next.add(s);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [open, activeIndex, byIndex]);

  const spot = resolvePositionSpot(
    { index: activeIndex },
    spotByIndex,
    oiByIndex?.[activeIndex]?.price ?? fallbackSpot,
  );

  useEffect(() => {
    if (!open) return;
    if (targetDirtyRef.current) return;
    if (spot != null && Number.isFinite(spot)) setTargetSpot(spot);
  }, [spot, activeIndex, open]);

  const setTargetFromUser = (v) => {
    targetDirtyRef.current = true;
    setTargetSpot(v);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const legs = byIndex.get(activeIndex) || [];
  const activeLegs = useMemo(
    () => legs.filter((l) => selected.has(l.tradingsymbol) && !l.exited && Number(l.quantity) !== 0),
    [legs, selected],
  );

  const oiPack = oiByIndex?.[activeIndex] || null;
  const oiBars = useMemo(() => buildOiBars(oiPack?.strikes || []), [oiPack]);

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

  const selectedPnl = useMemo(
    () => activeLegs.reduce((a, l) => a + (Number(l.pnl) || 0), 0),
    [activeLegs],
  );

  const projected = useMemo(() => {
    if (targetSpot == null) return null;
    return interpAt(payoff.spots, payoff.targetPnl, targetSpot);
  }, [payoff, targetSpot]);

  const bookThetaInr = useMemo(() => {
    let total = 0;
    let n = 0;
    for (const leg of activeLegs) {
      let capped = Number.isFinite(leg.thetaInr) ? leg.thetaInr : null;
      if (capped == null) {
        const T = yearsToExpiry(positionExpiryISO(leg), Date.now());
        capped = dailyThetaRupees({
          thetaPerUnit: leg.theta,
          quantity: leg.quantity,
          marketPrice: Number(leg.last_price || leg.average_price),
          S: spot,
          K: leg.strike,
          isCall: leg.side === "CE",
          T,
        });
      }
      if (capped != null && Number.isFinite(capped)) {
        total += capped;
        n += 1;
      }
    }
    return n ? total : null;
  }, [activeLegs, spot]);

  if (!open) return null;

  const toggle = (sym) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  const selectIndex = (idx) => {
    setActiveIndex(idx);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const toggleExpand = (idx) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    setActiveIndex(idx);
  };

  const selectAllOpen = () => {
    setSelected(
      new Set(legs.filter((l) => !l.exited && Number(l.quantity) !== 0).map((l) => l.tradingsymbol)),
    );
  };
  const selectNone = () => setSelected(new Set());

  const spotLo = spot != null ? Math.round(spot * 0.94) : 0;
  const spotHi = spot != null ? Math.round(spot * 1.06) : 1;
  const spotStep = Math.max(1, Math.round((spotHi - spotLo) / 200));
  const tgt = targetSpot ?? spot ?? 0;
  const tgtPct = spot ? ((tgt - spot) / spot) * 100 : 0;
  const timePct = Math.round(targetFrac * 100);

  const resetScenario = () => {
    targetDirtyRef.current = false;
    if (spot != null) setTargetSpot(spot);
    setTargetFrac(0);
  };

  const beLines = payoff.summary.breakevens?.length
    ? payoff.summary.breakevens.map((b) => {
        const pct = spot ? (((b - spot) / spot) * 100).toFixed(1) : null;
        return { level: Math.round(b), pct };
      })
    : [];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4 backdrop-blur-[2px]"
      data-testid="positions-analyze-modal"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-6xl max-h-[100dvh] sm:max-h-[92vh] overflow-hidden flex flex-col border border-slate-200">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ecfdf5_55%,#fff_100%)] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm">
                <LineChart className="w-3.5 h-3.5" />
              </span>
              <span className="truncate">Book Analyze</span>
              <span className="hidden sm:inline text-[11px] font-medium text-slate-500 truncate">
                {activeIndex}
                {spot != null ? ` · ${Number(spot).toFixed(2)}` : ""}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono-data font-semibold ${
                  selectedPnl >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                }`}
                data-testid="analyze-selected-pnl"
              >
                Live {money(selectedPnl, 0)}
              </span>
              <span className="text-slate-500">
                {activeLegs.length} leg{activeLegs.length === 1 ? "" : "s"} in scenario
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-md text-[11px] inline-flex"
              onClick={resetScenario}
              data-testid="analyze-reset-scenario"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose} data-testid="analyze-close">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)_210px]">
          {/* Legs */}
          <div className="border-b lg:border-b-0 lg:border-r border-slate-200 overflow-auto bg-white max-h-[40vh] lg:max-h-none" data-testid="analyze-leg-panel">
            {indices.length === 0 ? (
              <div className="text-[11px] text-slate-400 p-3">No option legs</div>
            ) : (
              indices.map((idx) => {
                const list = byIndex.get(idx) || [];
                const openLegs = list.filter((l) => !l.exited && Number(l.quantity) !== 0);
                const isOpen = expanded.has(idx);
                const isActive = activeIndex === idx;
                const idxSpot = resolvePositionSpot(
                  { index: idx },
                  spotByIndex,
                  oiByIndex?.[idx]?.price ?? fallbackSpot,
                );
                const idxSelectedPnl = list
                  .filter((l) => selected.has(l.tradingsymbol) && !l.exited)
                  .reduce((a, l) => a + (Number(l.pnl) || 0), 0);
                return (
                  <div key={idx} className={`border-b border-slate-100 ${isActive ? "bg-emerald-50/50" : ""}`}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(idx)}
                      onDoubleClick={() => selectIndex(idx)}
                      data-testid={`analyze-index-${idx}`}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2.5 text-left hover:bg-slate-50"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs font-bold ${isActive ? "text-emerald-900" : "text-slate-800"}`}>
                            {idx}
                          </span>
                          <span
                            className={`text-[11px] font-mono-data ${
                              idxSelectedPnl >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {money(idxSelectedPnl, 0)}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono-data">
                          {idxSpot != null ? Number(idxSpot).toFixed(2) : "—"} · {openLegs.length} open
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-2.5 pb-2.5 space-y-0.5">
                        {isActive ? (
                          <div className="flex gap-2 px-1 pb-1.5">
                            <button
                              type="button"
                              className="text-[10px] font-medium text-emerald-700 hover:underline"
                              onClick={selectAllOpen}
                              data-testid="analyze-select-all"
                            >
                              All open
                            </button>
                            <button
                              type="button"
                              className="text-[10px] text-slate-500 hover:underline"
                              onClick={selectNone}
                              data-testid="analyze-select-none"
                            >
                              Clear
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-[10px] font-medium text-emerald-700 px-1 pb-1 hover:underline"
                            onClick={() => selectIndex(idx)}
                          >
                            Analyze this index →
                          </button>
                        )}
                        {list.map((l) => {
                          const exited = !!l.exited || Number(l.quantity) === 0;
                          const checked = selected.has(l.tradingsymbol);
                          return (
                            <label
                              key={l.tradingsymbol}
                              className={`flex items-start gap-2 px-1.5 py-1.5 text-[11px] rounded-md ${
                                exited
                                  ? "text-slate-400 opacity-60 cursor-default"
                                  : "cursor-pointer hover:bg-white"
                              } ${!checked && !exited ? "opacity-55" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked && !exited}
                                disabled={exited || !isActive}
                                onChange={() => {
                                  if (!isActive) selectIndex(idx);
                                  toggle(l.tradingsymbol);
                                }}
                                className="mt-0.5 accent-emerald-600"
                                data-testid={`analyze-leg-${l.tradingsymbol}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-[3px] px-0.5 text-[9px] font-bold ${
                                    exited
                                      ? "bg-slate-100 text-slate-400"
                                      : l.quantity < 0
                                        ? "bg-rose-100 text-rose-700"
                                        : "bg-sky-100 text-sky-700"
                                  }`}
                                >
                                  {exited ? "X" : l.quantity < 0 ? "S" : "B"}
                                </span>{" "}
                                <span className="font-mono-data">{privacyMode ? MASK : (exited ? 0 : Math.abs(l.quantity))}×</span>{" "}
                                <span className="font-medium">
                                  {l.strike}
                                  {l.side}
                                </span>
                                <div
                                  className={`font-mono-data ${
                                    privacyMode
                                      ? "text-slate-500"
                                      : exited
                                        ? "text-slate-400"
                                        : l.pnl >= 0
                                          ? "text-emerald-700"
                                          : "text-rose-700"
                                  }`}
                                >
                                  {money(l.pnl, 0)}
                                  {exited ? " · closed" : ""}
                                </div>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 px-3 py-2.5 flex justify-between text-xs font-semibold">
              <span className="text-slate-500">Selected</span>
              <span
                className={`font-mono-data ${selectedPnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                data-testid="analyze-total-selected"
              >
                {money(selectedPnl, 0)}
              </span>
            </div>
          </div>

          {/* Chart + scenario */}
          <div className="overflow-auto p-3 sm:p-4 space-y-3 bg-[#fbfcfd]">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              <Metric
                label="Best case"
                sub="Max profit on path"
                value={money(payoff.summary.maxProfit, 0)}
                tone="emerald"
              />
              <Metric
                label="Room left"
                sub="Premium still to earn"
                value={payoff.summary.profitLeft != null ? money(payoff.summary.profitLeft, 0) : "—"}
                tone="slate"
              />
              <Metric
                label="Worst case"
                sub="Max loss on path"
                value={payoff.summary.unlimitedLoss ? "Open-ended" : money(payoff.summary.maxLoss, 0)}
                tone="rose"
              />
              <Metric
                label="At target"
                sub="Scenario P&L"
                value={projected != null ? money(projected, 0) : money(selectedPnl, 0)}
                tone={privacyMode ? "slate" : ((projected ?? selectedPnl) >= 0 ? "emerald" : "rose")}
              />
            </div>

            {beLines.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-700">Breakevens</span>
                {beLines.map((b) => (
                  <span key={b.level} className="font-mono-data rounded-md bg-white border border-slate-200 px-1.5 py-0.5">
                    {b.level}
                    {b.pct != null ? (
                      <span className="text-slate-400"> ({Number(b.pct) >= 0 ? "+" : ""}{b.pct}%)</span>
                    ) : null}
                  </span>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/70">
                <div className="text-[11px] font-semibold text-slate-700">Payoff vs spot</div>
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 bg-rose-700 inline-block rounded-full" /> Expiry
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 bg-teal-700 inline-block rounded-full" /> Scenario date
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[2px] bg-rose-300/80 inline-block" /> Call OI
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[2px] bg-emerald-300/80 inline-block" /> Put OI
                  </span>
                </div>
              </div>
              <div className="p-2 sm:p-3">
                <PayoffSvg
                  key={activeIndex}
                  spots={payoff.spots}
                  expiryPnl={payoff.expiryPnl}
                  targetPnl={payoff.targetPnl}
                  spot={payoff.spot || spot || 0}
                  targetSpot={tgt}
                  projected={projected}
                  oiBars={oiBars}
                  sd={sd}
                  onPickSpot={setTargetFromUser}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              <ScenarioSlider
                icon={Target}
                label={`${activeIndex} target`}
                hint="Where do you think spot settles for this scenario?"
                valueLabel={`${Math.round(tgt)} · ${tgtPct >= 0 ? "+" : ""}${tgtPct.toFixed(1)}%`}
                value={tgt}
                min={spotLo}
                max={spotHi}
                step={spotStep}
                disabled={spot == null}
                onChange={setTargetFromUser}
                testId="analyze-spot-slider"
                presets={
                  spot == null
                    ? []
                    : [
                        { id: "m2", label: "−2%", value: Math.round(spot * 0.98), testId: "spot-preset-m2" },
                        { id: "m1", label: "−1%", value: Math.round(spot * 0.99), testId: "spot-preset-m1" },
                        { id: "now", label: "Spot", value: Math.round(spot), testId: "spot-preset-now" },
                        { id: "p1", label: "+1%", value: Math.round(spot * 1.01), testId: "spot-preset-p1" },
                        { id: "p2", label: "+2%", value: Math.round(spot * 1.02), testId: "spot-preset-p2" },
                      ]
                }
              />
              <ScenarioSlider
                icon={Clock3}
                label="Time to expiry"
                hint="0% = now · 100% = full time decay to expiry"
                valueLabel={`${timePct}%`}
                value={timePct}
                min={0}
                max={100}
                step={1}
                onChange={(v) => setTargetFrac(v / 100)}
                testId="analyze-time-slider"
                presets={[
                  { id: "now", label: "Now", value: 0, testId: "time-preset-now" },
                  { id: "mid", label: "Halfway", value: 50, testId: "time-preset-mid" },
                  { id: "exp", label: "Expiry", value: 100, testId: "time-preset-exp" },
                ]}
              />
            </div>
          </div>

          {/* Book read */}
          <div className="border-t lg:border-t-0 lg:border-l border-slate-200 p-3 sm:p-4 space-y-4 overflow-auto bg-white">
            <section>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 font-semibold mb-2">
                Scenario
              </div>
              <div className="space-y-2 text-[12px]">
                <Row
                  k="Chance in band"
                  v={`${payoff.summary.popHint ?? "—"}%`}
                  tip="Rough share of the ±6% expiry curve that finishes ≥ 0 (not a true σ POP)"
                />
                <Row k="Spot now" v={spot != null ? Number(spot).toFixed(2) : "—"} />
                <Row k="Your target" v={tgt ? Number(tgt).toFixed(2) : "—"} />
                <Row k="Live P&L" v={money(selectedPnl, 0)} strong />
              </div>
            </section>

            <section>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 font-semibold mb-2">
                Book pulse
              </div>
              <div className="space-y-2 text-[12px] font-mono-data">
                <Row
                  k="Tilt (Δ)"
                  v={payoff.greeks.delta?.toFixed?.(2) ?? "—"}
                  tip="Direction lean — sellers usually want near 0"
                />
                <Row
                  k="Curve (Γ)"
                  v={payoff.greeks.gamma != null ? `${(payoff.greeks.gamma * 1e4).toFixed(2)}e-4` : "—"}
                />
                <Row
                  k="Time ₹/day (Θ)"
                  v={bookThetaInr != null ? money(bookThetaInr, 0) : "—"}
                  tip="Capped to premium left — same desk-safe θ as Positions ₹/day (not raw BS)"
                />
                <Row k="Vega" v={payoff.greeks.vega?.toFixed?.(1) ?? "—"} />
              </div>
            </section>

            <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
              Tick the legs you want in the scenario. The chart and book pulse update live. Use target
              and time controls to stress the book — not a broker clone, just a clear desk read.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, sub, value, tone }) {
  const cls =
    tone === "emerald"
      ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-950"
      : tone === "rose"
        ? "border-rose-200/80 bg-rose-50/70 text-rose-950"
        : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`rounded-lg border px-2.5 py-2 shadow-sm ${cls}`}>
      <div className="text-[9px] uppercase tracking-[0.14em] opacity-70 font-semibold">{label}</div>
      <div className="font-mono-data font-semibold text-[15px] leading-tight mt-0.5">{value}</div>
      {sub ? <div className="text-[10px] opacity-60 mt-0.5">{sub}</div> : null}
    </div>
  );
}

function Row({ k, v, tip, strong = false }) {
  return (
    <div className="flex justify-between gap-2 items-baseline" title={tip || undefined}>
      <span className="text-slate-500 text-[11px]">{k}</span>
      <span className={`${strong ? "font-bold" : "font-semibold"} text-slate-900 tabular-nums`}>{v}</span>
    </div>
  );
}
