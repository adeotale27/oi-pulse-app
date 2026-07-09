import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const PUT_GREEN = "#16A34A";
const CALL_RED = "#DC2626";

function formatOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default function OIChart({ current, previous, mode, atm, showOI = true, currentTime, prevTime }) {
  // Build merged strike -> { pe_now, pe_prev, ce_now, ce_prev }
  const data = useMemo(() => {
    if (!current) return [];
    const prevMap = new Map();
    (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    return current.strikes.map((s) => {
      const p = prevMap.get(s.strike) || {};
      const peNow = s.pe_oi, peP = p.pe_oi ?? s.pe_oi;
      const ceNow = s.ce_oi, ceP = p.ce_oi ?? s.ce_oi;
      return {
        strike: s.strike,
        pe_now: peNow, pe_prev: peP,
        ce_now: ceNow, ce_prev: ceP,
        pe_base: Math.min(peNow, peP),
        pe_inc: Math.max(0, peNow - peP),   // striped on top => OI increased
        pe_dec: Math.max(0, peP - peNow),   // hollow on top => writers exited
        ce_base: Math.min(ceNow, ceP),
        ce_inc: Math.max(0, ceNow - ceP),
        ce_dec: Math.max(0, ceP - ceNow),
        pe_delta: peNow - peP,
        ce_delta: ceNow - ceP,
      };
    });
  }, [current, previous]);

  if (!current) {
    return (
      <div className="h-96 flex items-center justify-center text-slate-400 text-sm">
        Loading data…
      </div>
    );
  }

  const ct = currentTime || current?.timestamp;
  const pt = prevTime || previous?.timestamp;

  return (
    <div className="w-full h-[440px]" data-testid="oi-chart">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 20 }} barCategoryGap="18%">
          <defs>
            <pattern id="pe-inc-pat" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#86EFAC" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#16A34A" strokeWidth="2" />
            </pattern>
            <pattern id="ce-inc-pat" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#FCA5A5" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#DC2626" strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="strike"
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={{ stroke: "#CBD5E1" }}
            tickLine={false}
            angle={-40}
            textAnchor="end"
            height={60}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={{ stroke: "#CBD5E1" }}
            tickLine={false}
            tickFormatter={formatOI}
            width={64}
            label={{
              value: "Call / Put OI",
              angle: -90,
              position: "insideLeft",
              style: { fill: "#64748B", fontSize: 11, textAnchor: "middle" },
              offset: 10,
            }}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            content={<CustomTooltip mode={mode} atm={atm} currentTime={ct} prevTime={pt} />}
          />
          <Legend
            verticalAlign="bottom"
            content={<CustomLegend showOI={showOI} />}
          />
          {atm && (
            <ReferenceLine
              x={atm}
              stroke="#94A3B8"
              strokeDasharray="4 4"
              label={{
                value: `ATM ${atm}`,
                position: "top",
                fill: "#475569",
                fontSize: 11,
                fontFamily: "JetBrains Mono",
              }}
            />
          )}
          {/* PUT stack: base (previous OI, solid), inc (striped on top), dec (hollow on top) */}
          {showOI && <Bar dataKey="pe_base" stackId="pe" name="Put OI" fill={PUT_GREEN} />}
          <Bar dataKey="pe_inc" stackId="pe" name="Put Increase" fill="url(#pe-inc-pat)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="pe_dec" stackId="pe" name="Put Decrease" fill="transparent" stroke={PUT_GREEN} strokeWidth={1.4} radius={[2, 2, 0, 0]} />
          {/* CALL stack */}
          {showOI && <Bar dataKey="ce_base" stackId="ce" name="Call OI" fill={CALL_RED} />}
          <Bar dataKey="ce_inc" stackId="ce" name="Call Increase" fill="url(#ce-inc-pat)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="ce_dec" stackId="ce" name="Call Decrease" fill="transparent" stroke={CALL_RED} strokeWidth={1.4} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({ active, payload, label, atm, currentTime, prevTime }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isAtm = atm === d.strike;
  const ctLbl = formatTime(currentTime);
  const ptLbl = formatTime(prevTime);
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-xl px-4 py-3 text-xs min-w-[240px]" data-testid="oi-tooltip">
      <div className="font-semibold text-slate-900 mb-2 text-sm">
        Strike {label} {isAtm && <span className="text-[10px] text-amber-600 ml-1">ATM</span>}
      </div>
      <div className="space-y-1.5 font-mono-data">
        <TipRow color={PUT_GREEN} label={`Put OI at ${ptLbl}`} value={formatOI(d.pe_prev)} />
        <TipRow color={PUT_GREEN} label="Put OI chg" value={`${d.pe_delta >= 0 ? "+" : ""}${formatOI(d.pe_delta)}`} deltaPositive={d.pe_delta >= 0} isDelta />
        <TipRow color={PUT_GREEN} label={`Put OI at ${ctLbl}`} value={formatOI(d.pe_now)} muted />
        <div className="h-px bg-slate-100 my-1" />
        <TipRow color={CALL_RED} label={`Call OI at ${ptLbl}`} value={formatOI(d.ce_prev)} />
        <TipRow color={CALL_RED} label="Call OI chg" value={`${d.ce_delta >= 0 ? "+" : ""}${formatOI(d.ce_delta)}`} deltaPositive={d.ce_delta >= 0} isDelta />
        <TipRow color={CALL_RED} label={`Call OI at ${ctLbl}`} value={formatOI(d.ce_now)} muted />
      </div>
    </div>
  );
}

function TipRow({ color, label, value, muted, isDelta, deltaPositive }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
        <span className={muted ? "text-slate-500" : "text-slate-700"}>{label}</span>
      </div>
      <span
        className={
          isDelta
            ? deltaPositive
              ? "text-emerald-600 font-semibold"
              : "text-rose-600 font-semibold"
            : "text-slate-900 font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

function CustomLegend({ showOI }) {
  const items = [
    ...(showOI ? [{ label: "Put OI", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: PUT_GREEN }} /> }] : []),
    { label: "Increase", swatch: <SwatchStripe color={PUT_GREEN} light="#86EFAC" /> },
    { label: "Decrease", swatch: <SwatchOutline color={PUT_GREEN} /> },
    ...(showOI ? [{ label: "Call OI", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: CALL_RED }} /> }] : []),
    { label: "Increase", swatch: <SwatchStripe color={CALL_RED} light="#FCA5A5" /> },
    { label: "Decrease", swatch: <SwatchOutline color={CALL_RED} /> },
  ];
  return (
    <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap pt-3 text-xs text-slate-600" style={{ fontFamily: "Outfit" }} data-testid="oi-legend">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {it.swatch}
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function SwatchStripe({ color, light }) {
  return (
    <span
      className="w-3 h-3 inline-block rounded-sm"
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, ${light} 2px 4px)`,
      }}
    />
  );
}

function SwatchOutline({ color }) {
  return (
    <span
      className="w-3 h-3 inline-block rounded-sm"
      style={{ background: "transparent", border: `1.5px solid ${color}` }}
    />
  );
}
