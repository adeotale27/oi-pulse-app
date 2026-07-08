import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
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
      return {
        strike: s.strike,
        pe_now: s.pe_oi,
        pe_prev: p.pe_oi ?? s.pe_oi,
        ce_now: s.ce_oi,
        ce_prev: p.ce_oi ?? s.ce_oi,
        pe_delta: s.pe_oi - (p.pe_oi ?? s.pe_oi),
        ce_delta: s.ce_oi - (p.ce_oi ?? s.ce_oi),
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
          {/* Previous OI as outlined bars */}
          <Bar dataKey="pe_prev" name="Put OI (prev)" fill="transparent" stroke={PUT_GREEN} strokeWidth={1.2} />
          {/* Current PE OI */}
          <Bar dataKey="pe_now" name="Put OI (current)" fill={PUT_GREEN} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={`pe-${i}`} fill={d.pe_delta >= 0 ? PUT_GREEN : "#86EFAC"} />
            ))}
          </Bar>
          <Bar dataKey="ce_prev" name="Call OI (prev)" fill="transparent" stroke={CALL_RED} strokeWidth={1.2} />
          <Bar dataKey="ce_now" name="Call OI (current)" fill={CALL_RED} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={`ce-${i}`} fill={d.ce_delta >= 0 ? CALL_RED : "#FCA5A5"} />
            ))}
          </Bar>
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
