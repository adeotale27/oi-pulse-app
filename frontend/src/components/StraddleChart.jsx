import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { fetchStraddle, fetchStraddleHistory } from "../lib/api";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// Use Intl with explicit IST timezone to avoid manual offset math which caused double-shifting
function formatTimeShort(ts) {
  try {
    const millis = Number(ts);
    if (Number.isNaN(millis)) return "-";
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(millis));
  } catch {
    return "-";
  }
}

function formatNumber(v) {
  return v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(2);
}

function StraddleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const timeStr = (() => {
    try {
      const millis = Number(label);
      if (Number.isNaN(millis)) return "-";
      // Format using explicit Asia/Kolkata timezone so the tooltip always shows IST
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(millis));
    } catch {
      return "-";
    }
  })();

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 text-left text-sm text-slate-900 shadow-xl dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100">
      <div className="font-semibold text-slate-900 mb-2 dark:text-slate-100">{formatTimeShort(label)}</div>
      <div className="text-slate-700 dark:text-slate-200">Straddle price: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(point.premium)}</span></div>
      <div className="text-slate-700 dark:text-slate-200">Index spot: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(point.underlying)}</span></div>
      <div className="text-slate-700 dark:text-slate-200">Synthetic future: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(point.synthetic)}</span></div>
      <div className="text-slate-700 dark:text-slate-200">Strike / CE / PE: <span className="font-semibold text-slate-900 dark:text-slate-100">{point.strike || "—"} / {formatNumber(point.ce_ltp)} / {formatNumber(point.pe_ltp)}</span></div>
      <div className="text-slate-500 mt-2 text-xs">Time: <span className="font-medium text-slate-700 dark:text-slate-300">{timeStr}</span></div>
    </div>
  );
}

// Small SVG badge used for marking current price on the chart
function Badge({ x, y, value }) {
  if (x == null || y == null || value == null) return null;
  const w = 56;
  const h = 22;
  const rx = 6;
  // position slightly to the right
  const tx = x + 8;
  const ty = y - h / 2;
  return (
    <g>
      <rect x={tx} y={ty} rx={rx} ry={rx} width={w} height={h} fill="#06b6d4" stroke="#0b5660" />
      <text x={tx + w / 2} y={ty + h / 2 + 4} textAnchor="middle" fontFamily="sans-serif" fontSize="12" fill="#022" fontWeight={700}>{Number(value).toFixed(2)}</text>
    </g>
  );
}

function toIstDateString(ts) {
  const millis = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(millis)) return null;
  const ist = new Date(millis + IST_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

function istDateToUtcMs(dateStr, hour, minute) {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
}

export default function StraddleChart({ index = "SENSEX", expiry = null, position = "long", qty = 1, pollMs = 30000, maxPoints = 7200, useWs = true }) {
  const [points, setPoints] = useState([]); // {ts, premium, underlying}
  const [meta, setMeta] = useState(null);
  const wsRef = useRef(null);

  // keep a lightweight clock so the chart's right edge can advance even when no
  // new market data arrives. Update every 5s to balance responsiveness and render cost.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const day = istTime.getDay();
    
    // Market open: 9:15 AM - 3:30 PM IST, Monday-Friday
    if (day === 0 || day === 6) return false; // Sunday or Saturday
    if (hours < 9 || (hours === 9 && minutes < 15)) return false;
    if (hours > 15 || (hours === 15 && minutes > 30)) return false;
    return true;
  };

  useEffect(() => {
    let stopped = false;
    setPoints([]);
    setMeta(null);
    if (useWs && typeof window !== "undefined") {
      // lazy import to avoid SSR issues
      const { connectStraddleWS } = require("../lib/straddleWs");
      wsRef.current = connectStraddleWS(index, { expiry, position, qty }, (msg) => {
        if (stopped) return;
        if (msg && msg.premium != null) {
          const now = msg.ts ? Date.parse(msg.ts) : Date.now();
          setMeta({ ts: now, atm: msg.atm, underlying: msg.underlying, strike: msg.atm, ce_ltp: msg.ce_ltp, pe_ltp: msg.pe_ltp, premium: msg.premium });
          setPoints((prev) => {
            const point = {
              ts: now,
              premium: msg.premium,
              underlying: msg.underlying,
              strike: msg.atm,
              ce_ltp: msg.ce_ltp,
              pe_ltp: msg.pe_ltp,
              synthetic: msg.underlying + (msg.ce_ltp - msg.pe_ltp),
            };
            const next = prev.concat(point);
            if (next.length > maxPoints) return next.slice(next.length - maxPoints);
            return next;
          });
        }
      });
      return () => { stopped = true; wsRef.current && wsRef.current.stop && wsRef.current.stop(); };
    }

    // fallback to polling
    let running = true;
    const tick = async () => {
      try {
        // Only fetch new data during market hours
        if (!isMarketOpen()) return;
        
        const res = await fetchStraddle(index, { expiry, position, qty });
        const now = Date.now();
        if (stopped) return;
        setMeta({ ts: now, atm: res.atm, underlying: res.underlying, strike: res.strike, ce_ltp: res.ce_ltp, pe_ltp: res.pe_ltp, premium: res.premium });
        setPoints((prev) => {
          const point = {
            ts: now,
            premium: res.premium,
            underlying: res.underlying,
            strike: res.strike,
            ce_ltp: res.ce_ltp,
            pe_ltp: res.pe_ltp,
            synthetic: res.underlying + (res.ce_ltp - res.pe_ltp),
          };
          const next = prev.concat(point);
          if (next.length > maxPoints) return next.slice(next.length - maxPoints);
          return next;
        });
      } catch (e) { /* ignore */ }
    };
    tick();
    const id = setInterval(() => { if (running) tick(); }, pollMs);
    return () => { running = false; stopped = true; clearInterval(id); };
  }, [index, expiry, position, qty, pollMs, maxPoints, useWs]);

  // On mount fetch recent history from server if available
  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const { fetchStraddleHistory } = require("../lib/api");
        const h = await fetchStraddleHistory(index, null, { expiry });
        if (cancelled) return;
        const arr = (h.history || []).map((s) => ({
          ts: typeof s.ts === "number" ? s.ts : Date.parse(s.ts),
          premium: s.premium,
          underlying: s.underlying,
          atm: s.atm,
          ce_ltp: s.ce_ltp,
          pe_ltp: s.pe_ltp,
          strike: s.atm,
          synthetic: s.underlying + ((s.ce_ltp || 0) - (s.pe_ltp || 0)),
        }));
        const sliced = arr.slice(-maxPoints);
        setPoints(sliced);
        if (sliced.length) {
          const last = sliced[sliced.length - 1];
          setMeta({ ts: last.ts, atm: last.atm || null, underlying: last.underlying || null, premium: last.premium || null, ce_ltp: last.ce_ltp, pe_ltp: last.pe_ltp, strike: last.atm });
        }
      } catch (e) {
        // ignore
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [index, expiry, maxPoints]);

  const chartDate = useMemo(() => {
    const sourceTs = points.length ? points[0].ts : Date.now();
    const tradeDate = toIstDateString(sourceTs) || toIstDateString(Date.now());
    return {
      start: istDateToUtcMs(tradeDate, 9, 15),
      end: istDateToUtcMs(tradeDate, 15, 30),
    };
  }, [points]);

  // Determine the visible chart end: use current time during market hours, otherwise use market close (15:30 IST).
  // Use the lightweight clock (nowMs) to advance even when no new data arrives.
  const viewEnd = useMemo(() => {
    try {
      const now = nowMs || Date.now();
      return now < chartDate.end ? now : chartDate.end;
    } catch {
      return chartDate.end;
    }
  }, [chartDate, meta, points, nowMs]);

  // Chart label that reflects visible range (09:15 to visible end)
  const chartLabel = useMemo(() => {
    try {
      const startLabel = formatTimeShort(istDateToUtcMs(toIstDateString(points.length ? points[0].ts : Date.now()), 9, 15));
      const endLabel = formatTimeShort(viewEnd || istDateToUtcMs(toIstDateString(Date.now()), 15, 30));
      return `${startLabel} – ${endLabel} IST`;
    } catch {
      return "09:15 – 15:30 IST";
    }
  }, [viewEnd, points]);

  // Generate X ticks starting from 09:15 and then every 45 minutes until market close.
  // Only expose a tick after the clock has passed that tick by 30 minutes (to avoid clutter)
  // Always include the 09:15 start tick and the current viewEnd as the last tick.
  const xTicks = useMemo(() => {
    const ticks = [];
    if (!chartDate) return ticks;
    const step = 45 * 60 * 1000; // 45 minutes in ms
    const start = chartDate.start;
    const end = chartDate.end;
    const revealDelay = 30 * 60 * 1000; // 30 minutes in ms
    if (!start || !end) return ticks;

    // always show start
    ticks.push(start);

    for (let t = start + step; t <= end; t += step) {
      // include this tick only if the visible end has progressed past t + revealDelay
      if (viewEnd >= (t + revealDelay)) ticks.push(t);
      if (ticks.length > 100) break;
    }

    // ensure the viewEnd (current time or market close) is visible as the last tick
    if (viewEnd && (ticks.length === 0 || ticks[ticks.length - 1] < viewEnd)) ticks.push(viewEnd);

    return ticks;
  }, [chartDate, viewEnd]);

  // Prepare displayPoints so that the latest meta price is pinned to the chart end (viewEnd)
  const displayPoints = useMemo(() => {
    if (!points || !points.length) return points;
    const arr = points.slice();
    if (meta && meta.premium != null && viewEnd) {
      const last = arr[arr.length - 1];
      // If last point isn't already at viewEnd, append a synthetic point at viewEnd with latest premium
      if (last.ts !== viewEnd) {
        arr.push({
          ts: viewEnd,
          premium: meta.premium,
          underlying: meta.underlying || (last.underlying || null),
          atm: meta.atm || last.atm,
          ce_ltp: meta.ce_ltp || last.ce_ltp,
          pe_ltp: meta.pe_ltp || last.pe_ltp,
          strike: meta.strike || last.strike,
          synthetic: (meta.underlying != null)
            ? meta.underlying + ((meta.ce_ltp || 0) - (meta.pe_ltp || 0))
            : (last.synthetic || null),
        });
      }
    }
    return arr;
  }, [points, meta, viewEnd]);

  const xAxisTickFormatter = (ts) => {
      // Always show a concise time label for ticks so bottom axis is readable
      return formatTimeShort(ts);
    };

  return (
    <div className="w-full" data-testid="straddle-chart">
      <div className="w-full rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:bg-slate-800 dark:border-slate-700">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{index}</div>
            <h2 className="text-xl font-bold text-slate-900">Straddle Premium</h2>
          </div>
          <div className="text-xs font-mono text-slate-600">
            {meta ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(meta.ts || Date.now())) : "Loading…"}
          </div>
        </div>

        {/* Chart */}
        <div className="px-6 py-4 h-[350px] bg-white dark:bg-slate-900">
          <ResponsiveContainer>
            <LineChart data={displayPoints} margin={{ top: 8, right: 72, left: 0, bottom: 20 }}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[chartDate.start, viewEnd || chartDate.end]}
                ticks={xTicks}
                tickFormatter={xAxisTickFormatter}
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                axisLine={false}
                tickLine={false}
                interval={0}
                label={{ value: chartLabel, position: "insideBottomRight", offset: -10, fill: "#64748b", fontSize: 12 }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                axisLine={false}
                tickLine={false}
                // ensure y-axis includes latest price and adds a small padding
                domain={[
                  (dataMin) => {
                    try {
                      const minVal = Math.min(dataMin, (meta && meta.premium != null) ? meta.premium : dataMin);
                      return Number((minVal * 0.98).toFixed(2));
                    } catch {
                      return dataMin;
                    }
                  },
                  (dataMax) => {
                    try {
                      const maxVal = Math.max(dataMax, (meta && meta.premium != null) ? meta.premium : dataMax);
                      return Number((maxVal * 1.02).toFixed(2));
                    } catch {
                      return dataMax;
                    }
                  },
                ]}
              />
              <Tooltip
                content={<StraddleTooltip />}
                              cursor={{ stroke: "rgba(15, 23, 42, 0.08)", strokeWidth: 2 }}
              />

                            {/* Current price marker on latest point */}
                            {meta && meta.premium != null && chartDate && (
                              // place marker at the view end (current time during market hours) so it pins to the extreme right
                              <ReferenceDot
                                x={viewEnd}
                                y={meta.premium}
                                r={4}
                                fill="#06b6d4"
                                stroke="#044"
                                label={(props) => <Badge x={props.x} y={props.y} value={meta.premium} />}
                              />
                            )}
              <Line
                type="monotone"
                dataKey="premium"
                name="Straddle Price"
                stroke="#0ea5e9"
                dot={false}
                strokeWidth={2.5}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6 py-4 border-t border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Straddle</div>
            <div className="text-3xl font-bold text-cyan-600">
              {meta && meta.premium != null ? meta.premium.toFixed(2) : "—"}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">{index} Spot</div>
            <div className="text-3xl font-bold text-slate-900">
              {meta && meta.underlying != null ? meta.underlying.toFixed(2) : "—"}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Synthetic Future</div>
            <div className="text-3xl font-bold text-slate-900">
              {meta && meta.strike != null && meta.ce_ltp != null && meta.pe_ltp != null
                ? (meta.strike + (meta.ce_ltp - meta.pe_ltp)).toFixed(2)
                : "—"}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Strike / CE / PE</div>
            <div className="text-base font-semibold text-slate-700">
              {meta && meta.strike != null && meta.ce_ltp != null && meta.pe_ltp != null
                ? `${meta.strike} · ${meta.ce_ltp.toFixed(2)} / ${meta.pe_ltp.toFixed(2)}`
                : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
