import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  X,
  LineChart,
  ChevronDown,
  ChevronRight,
  Target,
  Clock3,
  RotateCcw,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  computeIndexPayoff,
  groupPositionsByIndex,
  buildOiBars,
  sigmaBands,
  resolvePositionSpot,
  positionExpiryISO,
} from "@/lib/positionPayoff";
import { dailyThetaRupees, yearsToExpiry } from "@/lib/blackScholes";
import { DESK_IDS } from "@/lib/universe";

function fmt(v, dp = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

function fmtLakh(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(abs >= 1e6 ? 1 : 2)} L`;
  return Math.round(n).toLocaleString("en-IN");
}

function expiryShort(leg) {
  const iso = positionExpiryISO(leg);
  if (!iso || iso.length < 10) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase();
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

function shiftSeries(arr, offset) {
  if (!offset) return arr;
  return (arr || []).map((v) => v + offset);
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
  height = 320,
  onPickSpot = null,
  projectedLabel = null,
}) {
  const svgRef = useRef(null);
  const [inspect, setInspect] = useState(null);
  const gid = useId().replace(/:/g, "");

  const pad = { l: 52, r: 36, t: 28, b: 36 };
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
    const padY = (yMax - yMin) * 0.08;
    return { yMin: yMin - padY, yMax: yMax + padY, xMin: spots[0], xMax: spots[spots.length - 1] };
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
  const barMaxH = h * 0.28;
  const barW = Math.max(2, Math.min(8, w / Math.max(oiBars.length * 2.2, 1)));

  const areaNow = `${pathOf(targetPnl)} L${xScale(spots[spots.length - 1]).toFixed(1)},${zeroY.toFixed(1)} L${xScale(spots[0]).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const sdLines = sd
    ? [
        { x: sd.m2, label: "−2SD" },
        { x: sd.m1, label: "−1SD" },
        { x: sd.p1, label: "+1SD" },
        { x: sd.p2, label: "+2SD" },
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
    return { spot: sx, expiry: exp, scenario: sce, x: xScale(sx), y: yScale(sce ?? exp ?? 0) };
  };

  const onPointer = (clientX) => {
    const next = readAt(clientX);
    if (next) setInspect(next);
  };

  const active = inspect;
  const showTgt = tgtX != null && Math.abs((targetSpot || 0) - spot) > 0.5;

  return (
    <div className="relative" data-testid="payoff-chart-wrap">
      <div
        className="pointer-events-none absolute z-[2] -translate-x-1/2 rounded-full bg-slate-950 text-white text-[10px] font-semibold px-2.5 py-0.5 shadow-md whitespace-nowrap"
        style={{ left: `${(spotX / width) * 100}%`, top: 2 }}
      >
        Current {Number(spot).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </div>
      {projected != null ? (
        <div
          className={`pointer-events-none absolute z-[2] left-1/2 -translate-x-1/2 rounded-full text-[11px] font-semibold px-3 py-0.5 shadow-md ${
            projected >= 0 ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
          }`}
          style={{ bottom: 22 }}
          data-testid="analyze-projected"
        >
          Projected {projectedLabel ?? fmt(projected, 0)}
        </div>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto cursor-crosshair select-none touch-none"
        data-testid="payoff-svg"
        onMouseMove={(e) => onPointer(e.clientX)}
        onMouseLeave={() => setInspect(null)}
        onClick={(e) => {
          const next = readAt(e.clientX);
          if (!next) return;
          setInspect(next);
          if (typeof onPickSpot === "function") onPickSpot(Math.round(next.spot));
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches?.[0];
          if (!t) return;
          const next = readAt(t.clientX);
          if (!next) return;
          setInspect(next);
          if (typeof onPickSpot === "function") onPickSpot(Math.round(next.spot));
        }}
      >
        <defs>
          <linearGradient id={`${gid}-oiPut`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id={`${gid}-oiCall`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id={`${gid}-pnlFill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {oiBars.map((b) => {
          const cx = xScale(b.strike);
          if (cx < pad.l || cx > width - pad.r) return null;
          return (
            <g key={`oi-${b.strike}`}>
              <rect x={cx - barW - 0.5} y={height - pad.b - b.ce * barMaxH} width={barW} height={b.ce * barMaxH} fill={`url(#${gid}-oiCall)`} />
              <rect x={cx + 0.5} y={height - pad.b - b.pe * barMaxH} width={barW} height={b.pe * barMaxH} fill={`url(#${gid}-oiPut)`} />
            </g>
          );
        })}

        <path d={areaNow} fill={`url(#${gid}-pnlFill)`} />
        <line x1={pad.l} x2={width - pad.r} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth="1" />

        {sdLines.map((d) => (
          <g key={d.label}>
            <line x1={xScale(d.x)} x2={xScale(d.x)} y1={pad.t} y2={height - pad.b} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 5" />
            <text x={xScale(d.x)} y={pad.t + 11} fill="#64748b" textAnchor="middle" style={{ fontSize: 9, fontWeight: 600 }}>
              {d.label}
            </text>
          </g>
        ))}

        <line x1={spotX} x2={spotX} y1={pad.t} y2={height - pad.b} stroke="#10b981" strokeWidth="2" />
        {showTgt ? (
          <line x1={tgtX} x2={tgtX} y1={pad.t} y2={height - pad.b} stroke="#0369a1" strokeWidth="1.5" strokeDasharray="4 3" />
        ) : null}
        <path d={pathOf(expiryPnl)} fill="none" stroke="#e11d48" strokeWidth="2.4" />
        <path d={pathOf(targetPnl)} fill="none" stroke="#2563eb" strokeWidth="2.5" />

        {active && (
          <g data-testid="payoff-cursor">
            <line x1={active.x} x2={active.x} y1={pad.t} y2={height - pad.b} stroke="#0f172a" strokeWidth="1.15" strokeDasharray="3 3" opacity="0.5" />
            <circle cx={active.x} cy={yScale(active.scenario ?? 0)} r="4.5" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
            <circle cx={active.x} cy={yScale(active.expiry ?? 0)} r="3.5" fill="#e11d48" stroke="#fff" strokeWidth="1.25" />
          </g>
        )}

        <text x={8} y={pad.t + 4} fill="#94a3b8" style={{ fontSize: 9 }}>P&amp;L</text>
        <text x={8} y={pad.t + 16} fill="#64748b" style={{ fontSize: 10, fontWeight: 600 }}>{fmt(yMax, 0)}</text>
        <text x={8} y={height - pad.b} fill="#64748b" style={{ fontSize: 10, fontWeight: 600 }}>{fmt(yMin, 0)}</text>
        <text x={width - 6} y={pad.t + 4} fill="#94a3b8" textAnchor="end" style={{ fontSize: 9 }}>OI</text>
        <text x={pad.l} y={height - 10} fill="#94a3b8" style={{ fontSize: 10 }}>{Math.round(xMin).toLocaleString("en-IN")}</text>
        <text x={width / 2} y={height - 10} fill="#94a3b8" textAnchor="middle" style={{ fontSize: 10 }}>
          {Math.round((xMin + xMax) / 2).toLocaleString("en-IN")}
        </text>
        <text x={width - pad.r} y={height - 10} fill="#94a3b8" textAnchor="end" style={{ fontSize: 10 }}>
          {Math.round(xMax).toLocaleString("en-IN")}
        </text>
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute z-10 w-[160px] rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-2.5 py-2 shadow-lg"
          style={{
            left: `clamp(6px, calc(${(active.x / width) * 100}% + 8px), calc(100% - 168px))`,
            top: 36,
          }}
          data-testid="payoff-tooltip"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            At {Math.round(active.spot).toLocaleString("en-IN")}
          </div>
          <div className="mt-1 space-y-0.5 font-mono-data text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-rose-600">Expiry</span>
              <span className={`font-semibold ${active.expiry >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(active.expiry, 0)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-blue-600">Now / date</span>
              <span className={`font-semibold ${active.scenario >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmt(active.scenario, 0)}</span>
            </div>
          </div>
          {typeof onPickSpot === "function" ? (
            <button
              type="button"
              className="pointer-events-auto mt-1.5 text-[10px] font-semibold text-sky-700 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onPickSpot(Math.round(active.spot));
              }}
            >
              Use as target
            </button>
          ) : null}
        </div>
      ) : (
        <p className="px-1 pt-0.5 text-[10px] text-slate-400" data-testid="payoff-hover-hint">
          Drag to read P&amp;L. Tap a level to set the target.
        </p>
      )}
    </div>
  );
}

function CompactSlider({
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
  numeric = false,
  onReset = null,
}) {
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" data-testid={testId ? `${testId}-wrap` : undefined}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 text-[12px] font-semibold text-slate-800">
          {Icon ? <Icon className="w-3.5 h-3.5 text-slate-500" /> : null}
          <span className="truncate">{label}</span>
          {hint ? <span className="text-[10px] font-medium text-slate-400 truncate">{hint}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono-data text-[12px] font-semibold text-slate-900 tabular-nums">{valueLabel}</span>
          {typeof onReset === "function" ? (
            <button type="button" className="text-[10px] font-semibold text-sky-700 hover:underline" onClick={onReset} disabled={disabled}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
      {numeric ? (
        <div className="flex items-center gap-1.5 mb-2">
          <button type="button" disabled={disabled} className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 inline-flex items-center justify-center" onClick={() => onChange(clamp(value - step))} data-testid={testId ? `${testId}-minus` : undefined}>
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="number"
            disabled={disabled}
            value={Number.isFinite(value) ? Math.round(value) : ""}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(clamp(n));
            }}
            className="h-8 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 font-mono-data text-[13px] font-semibold tabular-nums"
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <button type="button" disabled={disabled} className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 inline-flex items-center justify-center" onClick={() => onChange(clamp(value + step))} data-testid={testId ? `${testId}-plus` : undefined}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={(vals) => onChange(vals[0])} data-testid={testId} />
      {presets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.value)}
              className={`h-6 px-2 rounded-full text-[10px] font-semibold border ${
                Math.abs(value - p.value) <= (step || 1) * 0.6
                  ? "border-sky-500 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-slate-50 text-slate-600"
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
  const [activeIndex, setActiveIndex] = useState(indices[0] || DESK_IDS[0]);
  const [expanded, setExpanded] = useState(() => new Set(indices.slice(0, 1)));
  const [selected, setSelected] = useState(() => new Set());
  const [targetFrac, setTargetFrac] = useState(0);
  const [targetSpot, setTargetSpot] = useState(null);
  const [addBooked, setAddBooked] = useState(false);
  const [pane, setPane] = useState("chart");
  const [chartMode, setChartMode] = useState("chart");
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

  useEffect(() => {
    if (!open) return;
    const key = String(activeIndex);
    const legs = byIndex.get(activeIndex) || [];
    const openSyms = legs.filter((l) => !l.exited && Number(l.quantity) !== 0).map((l) => l.tradingsymbol);
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

  const legs = byIndex.get(activeIndex) || [];
  const activeLegs = useMemo(
    () => legs.filter((l) => selected.has(l.tradingsymbol) && !l.exited && Number(l.quantity) !== 0),
    [legs, selected],
  );

  const bookedPnl = useMemo(
    () =>
      legs
        .filter((l) => l.exited || Number(l.quantity) === 0)
        .reduce((a, l) => a + (Number(l.booked_pnl ?? l.realised ?? l.pnl) || 0), 0),
    [legs],
  );
  const offset = addBooked ? bookedPnl : 0;

  const oiPack = oiByIndex?.[activeIndex] || null;
  const oiBars = useMemo(() => buildOiBars(oiPack?.strikes || []), [oiPack]);
  const oiTot = useMemo(() => {
    const strikes = oiPack?.strikes || [];
    const atmHint = Number(oiPack?.atm ?? spot);
    let closest = null;
    let best = Infinity;
    for (const s of strikes) {
      const k = Number(s.strike);
      if (!Number.isFinite(k)) continue;
      const d = Number.isFinite(atmHint) ? Math.abs(k - atmHint) : Infinity;
      if (d < best) {
        best = d;
        closest = s;
      }
    }
    return {
      ce: closest ? Number(closest.ce_oi) || 0 : 0,
      pe: closest ? Number(closest.pe_oi) || 0 : 0,
      atm: closest ? Number(closest.strike) : (Number.isFinite(atmHint) ? atmHint : null),
    };
  }, [oiPack, spot]);

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

  const expiryPnl = useMemo(() => shiftSeries(payoff.expiryPnl, offset), [payoff.expiryPnl, offset]);
  const targetPnl = useMemo(() => shiftSeries(payoff.targetPnl, offset), [payoff.targetPnl, offset]);

  const livePnl = useMemo(
    () => activeLegs.reduce((a, l) => a + (Number(l.pnl) || 0), 0) + offset,
    [activeLegs, offset],
  );

  const projected = useMemo(() => {
    if (targetSpot == null) return null;
    return interpAt(payoff.spots, targetPnl, targetSpot);
  }, [payoff.spots, targetPnl, targetSpot]);

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

  const spotChg = (() => {
    const explicit = Number(oiPack?.change_pct);
    if (Number.isFinite(explicit)) return explicit;
    const prev = Number(oiPack?.prev_close || oiPack?.day_open);
    if (spot > 0 && prev > 0) return ((spot - prev) / prev) * 100;
    return NaN;
  })();
  const daysLeft = Math.max(0, dteDays * (1 - targetFrac));
  const timeHint = daysLeft < 1 ? `${Math.max(0, Math.round(daysLeft * 24))}h to expiry` : `${daysLeft.toFixed(daysLeft >= 10 ? 0 : 1)}D to expiry`;

  const tableRows = useMemo(() => {
    if (!spot || !payoff.spots?.length) return [];
    const levels = [
      { id: "m2", label: "−2%", x: spot * 0.98 },
      { id: "m1", label: "−1%", x: spot * 0.99 },
      { id: "spot", label: "Spot", x: spot },
      { id: "p1", label: "+1%", x: spot * 1.01 },
      { id: "p2", label: "+2%", x: spot * 1.02 },
    ];
    (payoff.summary.breakevens || []).slice(0, 3).forEach((b, i) => {
      levels.push({ id: `be${i}`, label: "BE", x: b });
    });
    return levels.map((row) => ({
      ...row,
      x: Math.round(row.x),
      now: interpAt(payoff.spots, targetPnl, row.x),
      expiry: interpAt(payoff.spots, expiryPnl, row.x),
    }));
  }, [spot, payoff, targetPnl, expiryPnl]);

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
    setExpanded((prev) => new Set(prev).add(idx));
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
    setSelected(new Set(legs.filter((l) => !l.exited && Number(l.quantity) !== 0).map((l) => l.tradingsymbol)));
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

  const beLines = (payoff.summary.breakevens || []).map((b) => {
    const pct = spot ? (((b - spot) / spot) * 100).toFixed(1) : null;
    return { level: Math.round(b), pct };
  });

  const tabBtn = (id, label, testId) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => setPane(id)}
      className={`h-8 px-3 rounded-full text-[12px] font-semibold ${
        pane === id ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 bg-white border border-slate-200"
      }`}
    >
      {label}
    </button>
  );

  const legsPanel = (
    <div className="flex flex-col min-h-0 h-full bg-white" data-testid="analyze-leg-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">F&amp;O legs</span>
        <div className="flex gap-2">
          <button type="button" className="text-[10px] font-semibold text-sky-700" onClick={selectAllOpen} data-testid="analyze-select-all">
            All open
          </button>
          <button type="button" className="text-[10px] text-slate-500" onClick={selectNone} data-testid="analyze-select-none">
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {indices.length === 0 ? (
          <div className="text-[11px] text-slate-400 p-3">No option legs</div>
        ) : (
          indices.map((idx) => {
            const list = byIndex.get(idx) || [];
            const openLegs = list.filter((l) => !l.exited && Number(l.quantity) !== 0);
            const isOpen = expanded.has(idx);
            const isActive = activeIndex === idx;
            const idxSpot = resolvePositionSpot({ index: idx }, spotByIndex, oiByIndex?.[idx]?.price ?? fallbackSpot);
            const idxPnl =
              list
                .filter((l) => selected.has(l.tradingsymbol) && !l.exited)
                .reduce((a, l) => a + (Number(l.pnl) || 0), 0) + (isActive ? offset : 0);
            return (
              <div key={idx} className={isActive ? "bg-sky-50/40" : ""}>
                <button
                  type="button"
                  onClick={() => toggleExpand(idx)}
                  data-testid={`analyze-index-${idx}`}
                  className="w-full flex items-center gap-1.5 px-3 py-2.5 text-left"
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span className={`text-[13px] font-bold ${isActive ? "text-sky-900" : "text-slate-800"}`}>{idx}</span>
                      <span className={`text-[12px] font-mono-data font-semibold ${idxPnl >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {money(idxPnl, 0)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono-data">
                      {idxSpot != null ? Number(idxSpot).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"} · {openLegs.length} open
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="pb-1">
                    {!isActive ? (
                      <button type="button" className="text-[10px] font-semibold text-sky-700 px-3 pb-1" onClick={() => selectIndex(idx)}>
                        Analyze this index
                      </button>
                    ) : null}
                    {list.map((l) => {
                      const exited = !!l.exited || Number(l.quantity) === 0;
                      const checked = selected.has(l.tradingsymbol);
                      const sold = l.quantity < 0;
                      const title = `${privacyMode ? "··" : Math.abs(l.quantity)} × ${expiryShort(l)} ${l.strike} ${l.side}`.replace(/\s+/g, " ");
                      return (
                        <label
                          key={l.tradingsymbol}
                          className={`flex items-center gap-2 px-3 py-2 border-t border-slate-50 ${exited ? "opacity-45" : "hover:bg-white"} ${!checked && !exited ? "opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked && !exited}
                            disabled={exited || !isActive}
                            onChange={() => {
                              if (!isActive) selectIndex(idx);
                              toggle(l.tradingsymbol);
                            }}
                            className="accent-sky-600"
                            data-testid={`analyze-leg-${l.tradingsymbol}`}
                          />
                          <span
                            className={`h-5 w-5 rounded-md text-[10px] font-bold inline-flex items-center justify-center shrink-0 ${
                              exited ? "bg-slate-100 text-slate-400" : sold ? "bg-rose-500 text-white" : "bg-sky-500 text-white"
                            }`}
                          >
                            {exited ? "X" : sold ? "S" : "B"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-medium text-slate-800 truncate">{title}</span>
                            <span className={`block text-[11px] font-mono-data ${l.pnl >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                              {money(l.pnl, 0)}
                              {exited ? " · closed" : ""}
                            </span>
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
      </div>
      <div className="shrink-0 border-t border-slate-200 px-3 py-2.5 flex justify-between text-[13px] font-semibold bg-white">
        <span className="text-slate-500">Total</span>
        <span className={`font-mono-data ${livePnl >= 0 ? "text-emerald-700" : "text-rose-600"}`} data-testid="analyze-total-selected">
          {money(livePnl, 0)}
        </span>
      </div>
    </div>
  );

  const statsStrip = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Stat k="Chance in band" v={`${payoff.summary.popHint ?? "—"}%`} />
      <Stat k="Spot now" v={spot != null ? Number(spot).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"} />
      <Stat k="Your target" v={tgt ? Number(tgt).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"} />
      <Stat k="Live P&L" v={money(livePnl, 0)} tone={livePnl >= 0 ? "up" : "down"} />
      <Stat k="Tilt (Δ)" v={payoff.greeks.delta?.toFixed?.(2) ?? "—"} />
      <Stat k="Time ₹/day" v={bookThetaInr != null ? money(bookThetaInr, 0) : "—"} />
      <Stat k="Best / worst" v={`${money(payoff.summary.maxProfit, 0)} / ${payoff.summary.unlimitedLoss ? "open" : money(payoff.summary.maxLoss, 0)}`} />
      <Stat k="Breakevens" v={beLines.length ? beLines.map((b) => b.level).join(" · ") : "—"} />
    </div>
  );

  const chartBlock = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-slate-100 p-0.5">
          <button
            type="button"
            className={`h-7 px-3 rounded-full text-[11px] font-semibold ${chartMode === "chart" ? "bg-sky-600 text-white" : "text-slate-600"}`}
            onClick={() => setChartMode("chart")}
            data-testid="analyze-mode-chart"
          >
            Payoff chart
          </button>
          <button
            type="button"
            className={`h-7 px-3 rounded-full text-[11px] font-semibold ${chartMode === "table" ? "bg-sky-600 text-white" : "text-slate-600"}`}
            onClick={() => setChartMode("table")}
            data-testid="analyze-mode-table"
          >
            Payoff table
          </button>
        </div>
        <div className="text-[11px] text-slate-500" data-testid="analyze-oi-summary">
          OI at {oiTot.atm != null ? oiTot.atm.toLocaleString("en-IN") : "—"}
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Call {fmtLakh(oiTot.ce)}
          </span>
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Put {fmtLakh(oiTot.pe)}
          </span>
        </div>
      </div>

      {chartMode === "chart" ? (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[10px] text-slate-500 border-b border-slate-100">
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 bg-blue-600 inline-block" /> Now / date</span>
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 bg-rose-600 inline-block" /> Expiry</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-rose-300 inline-block rounded-[2px]" /> Call OI</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-300 inline-block rounded-[2px]" /> Put OI</span>
          </div>
          <div className="px-1 sm:px-2 pb-1">
            <PayoffSvg
              key={activeIndex}
              spots={payoff.spots}
              expiryPnl={expiryPnl}
              targetPnl={targetPnl}
              spot={payoff.spot || spot || 0}
              targetSpot={tgt}
              projected={projected}
              projectedLabel={privacyMode ? MASK : undefined}
              oiBars={oiBars}
              sd={sd}
              onPickSpot={setTargetFromUser}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Level</th>
                <th className="text-right px-3 py-2 font-semibold">Spot</th>
                <th className="text-right px-3 py-2 font-semibold">Now</th>
                <th className="text-right px-3 py-2 font-semibold">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{r.label}</td>
                  <td className="px-3 py-2 text-right font-mono-data">{r.x.toLocaleString("en-IN")}</td>
                  <td className={`px-3 py-2 text-right font-mono-data font-semibold ${r.now >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{money(r.now, 0)}</td>
                  <td className={`px-3 py-2 text-right font-mono-data font-semibold ${r.expiry >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{money(r.expiry, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <CompactSlider
          icon={Target}
          label={`${activeIndex} target`}
          hint={`${tgtPct >= 0 ? "+" : ""}${tgtPct.toFixed(2)}%`}
          valueLabel={tgt ? Math.round(tgt).toLocaleString("en-IN") : "—"}
          value={tgt}
          min={spotLo}
          max={spotHi}
          step={spotStep}
          disabled={spot == null}
          onChange={setTargetFromUser}
          numeric
          onReset={spot == null ? null : () => setTargetFromUser(Math.round(spot))}
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
        <CompactSlider
          icon={Clock3}
          label="Date"
          hint={timeHint}
          valueLabel={`${timePct}%`}
          value={timePct}
          min={0}
          max={100}
          step={1}
          onChange={(v) => setTargetFrac(v / 100)}
          testId="analyze-time-slider"
          onReset={() => setTargetFrac(0)}
          presets={[
            { id: "now", label: "Now", value: 0, testId: "time-preset-now" },
            { id: "mid", label: "Halfway", value: 50, testId: "time-preset-mid" },
            { id: "exp", label: "Expiry", value: 100, testId: "time-preset-exp" },
          ]}
        />
      </div>
      {statsStrip}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent
        hideClose
        className="max-w-[min(96vw,76rem)] max-h-[94vh] p-0 gap-0 overflow-hidden flex flex-col sm:rounded-2xl max-md:left-0 max-md:top-0 max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:max-w-none max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none"
        data-testid="positions-analyze-modal"
      >
        <DialogTitle className="sr-only">Analyze</DialogTitle>
        <div className="bg-[#f7f8fa] w-full h-full min-h-0 overflow-hidden flex flex-col">
          <header className="shrink-0 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2 px-2 sm:px-3 h-11">
              <button type="button" className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-slate-100" onClick={onClose} data-testid="analyze-close" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
              <div className="flex-1 text-center text-[15px] font-semibold text-slate-900">Analyze</div>
              <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={resetScenario} data-testid="analyze-reset-scenario">
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Reset
              </Button>
            </div>
            <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <LineChart className="w-4 h-4 text-sky-600 shrink-0" />
                {indices.length > 1 ? (
                  <select
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold"
                    value={activeIndex}
                    onChange={(e) => selectIndex(e.target.value)}
                    data-testid="analyze-index-select"
                  >
                    {indices.map((idx) => (
                      <option key={idx} value={idx}>{idx}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[13px] font-bold text-slate-900">{activeIndex}</span>
                )}
                <span className="font-mono-data text-[13px] font-semibold text-slate-800">
                  {spot != null ? Number(spot).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                </span>
                {Number.isFinite(spotChg) ? (
                  <span className={`text-[12px] font-semibold ${spotChg >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {spotChg >= 0 ? "+" : ""}{spotChg.toFixed(2)}%
                  </span>
                ) : null}
              </div>
              <span
                className={`ml-auto text-[12px] font-mono-data font-bold ${livePnl >= 0 ? "text-emerald-700" : "text-rose-600"}`}
                data-testid="analyze-selected-pnl"
              >
                Live {money(livePnl, 0)}
              </span>
              <span className="text-[11px] text-slate-500">{activeLegs.length} legs</span>
            </div>
            <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 md:hidden">
                {tabBtn("chart", "Chart", "analyze-tab-chart")}
                {tabBtn("legs", "Legs", "analyze-tab-legs")}
              </div>
              <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600" title="Add realised P&L from closed legs on this index to the curve and totals">
                Add booked P&amp;L
                <Switch checked={addBooked} onCheckedChange={setAddBooked} className="scale-90" data-testid="analyze-add-booked" />
              </label>
            </div>
          </header>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[min(18rem,38%)_minmax(0,1fr)]">
            <div className={`${pane === "legs" ? "flex" : "hidden"} md:flex min-h-0 border-r border-slate-200`}>
              {legsPanel}
            </div>
            <div className={`${pane === "chart" ? "block" : "hidden"} md:block overflow-auto p-3 sm:p-4`}>
              {chartBlock}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ k, v, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">{k}</div>
      <div className={`mt-0.5 text-[13px] font-semibold font-mono-data leading-tight ${
        tone === "up" ? "text-emerald-700" : tone === "down" ? "text-rose-600" : "text-slate-900"
      }`}>
        {v}
      </div>
    </div>
  );
}
