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

export default function OIChart({ current, previous, mode, atm }) {
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
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.1)" }}
            content={<CustomTooltip mode={mode} atm={atm} />}
          />
          <Legend
            verticalAlign="bottom"
            iconType="square"
            wrapperStyle={{ fontSize: 12, paddingTop: 8, fontFamily: "Outfit" }}
            payload={[
              { value: "Put OI", type: "square", color: PUT_GREEN, id: "pe" },
              { value: "Increase", type: "square", color: "#86EFAC", id: "peinc" },
              { value: "Decrease", type: "square", color: "#DCFCE7", id: "pedec" },
              { value: "Call OI", type: "square", color: CALL_RED, id: "ce" },
              { value: "Increase", type: "square", color: "#FCA5A5", id: "ceinc" },
              { value: "Decrease", type: "square", color: "#FEE2E2", id: "cedec" },
            ]}
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
          <Bar dataKey="pe_base" stackId="pe" name="Put OI" fill={PUT_GREEN} />
          <Bar dataKey="pe_inc" stackId="pe" name="Put Increase" fill="url(#pe-inc-pat)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="pe_dec" stackId="pe" name="Put Decrease" fill="transparent" stroke={PUT_GREEN} strokeWidth={1.4} radius={[2, 2, 0, 0]} />
          {/* CALL stack */}
          <Bar dataKey="ce_base" stackId="ce" name="Call OI" fill={CALL_RED} />
          <Bar dataKey="ce_inc" stackId="ce" name="Call Increase" fill="url(#ce-inc-pat)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="ce_dec" stackId="ce" name="Call Decrease" fill="transparent" stroke={CALL_RED} strokeWidth={1.4} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({ active, payload, label, atm }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const peDeltaPct = d.pe_prev ? ((d.pe_delta / d.pe_prev) * 100).toFixed(2) : "0.00";
  const ceDeltaPct = d.ce_prev ? ((d.ce_delta / d.ce_prev) * 100).toFixed(2) : "0.00";
  const isAtm = atm === d.strike;
  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-slate-800 font-mono-data mb-1.5">
        Strike {label} {isAtm && <span className="text-[10px] text-amber-600 ml-1">ATM</span>}
      </div>
      <div className="space-y-1 font-mono-data">
        <Row color="#16A34A" label="Put OI" now={d.pe_now} delta={d.pe_delta} pct={peDeltaPct} />
        <Row color="#DC2626" label="Call OI" now={d.ce_now} delta={d.ce_delta} pct={ceDeltaPct} />
      </div>
    </div>
  );
}

function Row({ color, label, now, delta, pct }) {
  const up = delta >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      <span className="text-slate-500 w-14">{label}</span>
      <span className="text-slate-900">{formatOI(now)}</span>
      <span className={up ? "text-emerald-600" : "text-rose-600"}>
        {up ? "▲" : "▼"} {formatOI(Math.abs(delta))} ({pct}%)
      </span>
    </div>
  );
}
