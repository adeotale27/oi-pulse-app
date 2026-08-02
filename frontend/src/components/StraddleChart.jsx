import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { fetchStraddle, fetchStraddleHistory } from "../lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function formatTimeShort(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 text-left text-sm text-slate-900 shadow-xl">
      <div className="font-semibold text-slate-900 mb-2">{formatTimeShort(label)}</div>
      <div className="text-slate-700">Straddle price: <span className="font-semibold text-slate-900">{formatNumber(point.premium)}</span></div>
      <div className="text-slate-700">Index spot: <span className="font-semibold text-slate-900">{formatNumber(point.underlying)}</span></div>
      <div className="text-slate-700">Synthetic future: <span className="font-semibold text-slate-900">{formatNumber(point.synthetic)}</span></div>
      <div className="text-slate-700">Strike / CE / PE: <span className="font-semibold text-slate-900">{point.strike || "—"} / {formatNumber(point.ce_ltp)} / {formatNumber(point.pe_ltp)}</span></div>
    </div>
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

export default function StraddleChart({ index = "SENSEX", expiry = null, position = "long", qty = 1, pollMs = 60000, maxPoints = 7200, useWs = true }) {
  const [points, setPoints] = useState([]); // {ts, premium, underlying}
  const [meta, setMeta] = useState(null);
  const wsRef = useRef(null);

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
      // Only connect WS when market isn't quiescent. If quiescent, allow the
      // wrapper to watch for reopen and auto-connect while we continue to
      // run fallback history/polling logic below.
      let conn = null;
      try {
        const closed = isMarketQuiescent();
        // lazy import to avoid SSR issues
        const { connectStraddleWS } = require("../lib/straddleWs");
        conn = connectStraddleWS(index, { expiry, position, qty }, (msg) => {
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

        // If the wrapper returned a connection that is already started, we can
        // short-circuit and cleanup on unmount. If it deferred (isStarted false)
        // then allow fallback polling/history load below.
        if (conn && typeof conn.isStarted === "function" && conn.isStarted()) {
          wsRef.current = conn;
          return () => { stopped = true; wsRef.current && wsRef.current.stop && wsRef.current.stop(); };
        }
      } catch (e) {
        // fall back to polling
      }
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
    // If market quiescent (weekend/holiday), skip recurring polling to avoid unnecessary fetches
    try {
      const closed = isMarketQuiescent();
      if (closed) return () => { running = false; stopped = true; };
    } catch (e) {
      // on error fall back to original behavior
    }

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
      label: "09:15 – 15:30 IST",
    };
  }, [points]);

  const xAxisTickFormatter = (ts) => {
    const date = new Date(ts);
    const minutes = date.getMinutes();
    // Show label only if minutes is close to 0, 45
    if (Math.abs(minutes - 0) < 2 || Math.abs(minutes - 45) < 2) {
      return formatTimeShort(ts);
    }
    return "";
  };

  return (
    <div className="w-full" data-testid="straddle-chart">
      <div className="w-full rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{index}</div>
            <h2 className="text-xl font-bold text-slate-900">Straddle Premium</h2>
          </div>
          <div className="text-xs font-mono text-slate-600">
            {meta ? new Date(meta.ts || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "Loading…"}
          </div>
        </div>

        {/* Chart */}
        <div className="px-6 py-4 h-[350px] bg-white">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[chartDate.start, chartDate.end]}
                tickFormatter={xAxisTickFormatter}
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                axisLine={false}
                tickLine={false}
                tickCount={5}
                interval="preserveStartEnd"
                label={{ value: chartDate.label, position: "insideBottomRight", offset: -10, fill: "#64748b", fontSize: 12 }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                axisLine={false}
                tickLine={false}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={<StraddleTooltip />}
                cursor={{ stroke: "rgba(15, 23, 42, 0.1)", strokeWidth: 2 }}
              />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6 py-4 border-t border-slate-200 bg-white">
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
