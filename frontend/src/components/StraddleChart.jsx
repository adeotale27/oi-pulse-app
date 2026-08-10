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

function daysToExpiryLabel(expiryISO) {
  if (!expiryISO) return null;
  try {
    const [y, m, d] = String(expiryISO).split("-").map(Number);
    if (!y || !m || !d) return null;
    // Expiry close ~15:30 IST
    const expiryMs = Date.UTC(y, m - 1, d, 10, 0) ; // 15:30 IST = 10:00 UTC
    const now = Date.now();
    const days = (expiryMs - now) / (24 * 60 * 60 * 1000);
    if (!Number.isFinite(days)) return null;
    if (days < 0) return "0";
    if (days < 1) return days < 0.05 ? "0" : days.toFixed(1);
    return String(Math.max(0, Math.ceil(days)));
  } catch {
    return null;
  }
}

/** Keep one point per sample bucket (default 60s) — matches 1-min reference charts. */
function upsertBucketed(prev, point, bucketMs) {
  const bucket = Math.floor(point.ts / bucketMs) * bucketMs;
  const nextPoint = { ...point, ts: bucket };
  if (!prev.length) return [nextPoint];
  const last = prev[prev.length - 1];
  const lastBucket = Math.floor(last.ts / bucketMs) * bucketMs;
  if (lastBucket === bucket) {
    const copy = prev.slice();
    copy[copy.length - 1] = nextPoint;
    return copy;
  }
  return prev.concat(nextPoint);
}

function downsampleToBuckets(arr, bucketMs) {
  if (!arr.length) return arr;
  const out = [];
  for (const p of arr) {
    const bucket = Math.floor(p.ts / bucketMs) * bucketMs;
    const next = { ...p, ts: bucket };
    if (!out.length) {
      out.push(next);
      continue;
    }
    const last = out[out.length - 1];
    if (Math.floor(last.ts / bucketMs) * bucketMs === bucket) {
      out[out.length - 1] = next;
    } else {
      out.push(next);
    }
  }
  return out;
}

function StraddleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 p-3 text-left text-sm text-slate-900 shadow-lg">
      <div className="font-semibold text-slate-900 mb-2">{formatTimeShort(label)}</div>
      <div className="text-slate-700">Straddle price: <span className="font-semibold text-sky-600">{formatNumber(point.premium)}</span></div>
      <div className="text-slate-700">Index spot: <span className="font-semibold text-slate-900">{formatNumber(point.underlying)}</span></div>
      <div className="text-slate-700">Synthetic future: <span className="font-semibold text-slate-900">{formatNumber(point.synthetic)}</span></div>
      <div className="text-slate-700">Strike / CE / PE: <span className="font-semibold text-slate-900">{point.strike || "—"} · {formatNumber(point.ce_ltp)} / {formatNumber(point.pe_ltp)}</span></div>
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

export default function StraddleChart({
  index = "SENSEX",
  expiry = null,
  position = "long",
  qty = 1,
  pollMs = 60000,
  maxPoints = 7200,
  useWs = true,
}) {
  const [points, setPoints] = useState([]);
  const [meta, setMeta] = useState(null);
  const wsRef = useRef(null);
  const bucketMs = Math.max(30_000, Number(pollMs) || 60_000);

  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const day = istTime.getDay();
    if (day === 0 || day === 6) return false;
    if (hours < 9 || (hours === 9 && minutes < 15)) return false;
    if (hours > 15 || (hours === 15 && minutes > 40)) return false;
    return true;
  };

  const pushLivePoint = (raw) => {
    const now = raw.ts ? (typeof raw.ts === "number" ? raw.ts : Date.parse(raw.ts)) : Date.now();
    const point = {
      ts: now,
      premium: raw.premium,
      underlying: raw.underlying,
      strike: raw.atm ?? raw.strike,
      ce_ltp: raw.ce_ltp,
      pe_ltp: raw.pe_ltp,
      synthetic: Number(raw.underlying) + (Number(raw.ce_ltp || 0) - Number(raw.pe_ltp || 0)),
    };
    setMeta({
      ts: now,
      atm: raw.atm ?? raw.strike,
      underlying: raw.underlying,
      strike: raw.atm ?? raw.strike,
      ce_ltp: raw.ce_ltp,
      pe_ltp: raw.pe_ltp,
      premium: raw.premium,
    });
    setPoints((prev) => {
      const next = upsertBucketed(prev, point, bucketMs);
      if (next.length > maxPoints) return next.slice(next.length - maxPoints);
      return next;
    });
  };

  useEffect(() => {
    let stopped = false;
    setPoints([]);
    setMeta(null);
    if (useWs && typeof window !== "undefined") {
      let conn = null;
      try {
        const { connectStraddleWS } = require("../lib/straddleWs");
        conn = connectStraddleWS(index, { expiry, position, qty }, (msg) => {
          if (stopped) return;
          if (msg && msg.premium != null) pushLivePoint(msg);
        });

        if (conn && typeof conn.isStarted === "function" && conn.isStarted()) {
          wsRef.current = conn;
          return () => {
            stopped = true;
            wsRef.current && wsRef.current.stop && wsRef.current.stop();
          };
        }
      } catch (_e) {
        /* fall back to polling */
      }
    }

    let running = true;
    const tick = async () => {
      try {
        if (!isMarketOpen()) return;
        const res = await fetchStraddle(index, { expiry, position, qty });
        if (stopped) return;
        pushLivePoint({ ...res, ts: Date.now() });
      } catch (_e) { /* ignore */ }
    };
    try {
      if (isMarketQuiescent()) {
        return () => {
          running = false;
          stopped = true;
        };
      }
    } catch (_e) { /* fall through */ }

    tick();
    const id = setInterval(() => {
      if (running) tick();
    }, pollMs);
    return () => {
      running = false;
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, expiry, position, qty, pollMs, maxPoints, useWs, bucketMs]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
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
        const sliced = downsampleToBuckets(arr, bucketMs).slice(-maxPoints);
        setPoints(sliced);
        if (sliced.length) {
          const last = sliced[sliced.length - 1];
          setMeta({
            ts: last.ts,
            atm: last.atm || last.strike || null,
            underlying: last.underlying || null,
            premium: last.premium || null,
            ce_ltp: last.ce_ltp,
            pe_ltp: last.pe_ltp,
            strike: last.atm || last.strike,
          });
        }
      } catch (_e) { /* ignore */ }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [index, expiry, maxPoints, bucketMs]);

  const chartDate = useMemo(() => {
    const sourceTs = points.length ? points[0].ts : Date.now();
    const tradeDate = toIstDateString(sourceTs) || toIstDateString(Date.now());
    const dayStart = istDateToUtcMs(tradeDate, 9, 15);
    const dayEnd = istDateToUtcMs(tradeDate, 15, 40);
    let end = dayStart + 15 * 60000;
    if (points.length) {
      end = Math.min(dayEnd, Math.max(end, points[points.length - 1].ts + bucketMs));
    }
    return {
      start: dayStart,
      end,
      label: "09:15 IST → live",
    };
  }, [points, bucketMs]);

  const yDomain = useMemo(() => {
    if (!points.length) return [0, 1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      const v = Number(p.premium);
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    const pad = Math.max(0.5, (hi - lo) * 0.12);
    return [Math.max(0, lo - pad), hi + pad];
  }, [points]);

  const lastPoint = points.length ? points[points.length - 1] : null;
  const dte = daysToExpiryLabel(expiry);
  const lastUpdated = meta?.ts
    ? new Date(meta.ts).toLocaleString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const synthetic =
    meta && meta.strike != null && meta.ce_ltp != null && meta.pe_ltp != null
      ? meta.strike + (meta.ce_ltp - meta.pe_ltp)
      : null;

  return (
    <div className="w-full" data-testid="straddle-chart">
      <div className="w-full rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-white">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{index}</div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">Straddle Premium</h2>
          </div>
          <div className="text-right">
            <div className="text-xs font-mono text-slate-500">
              {meta
                ? new Date(meta.ts || Date.now()).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "Loading…"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {Math.round(bucketMs / 1000)}s samples · 1-min style
            </div>
          </div>
        </div>

        <div className="px-4 py-3 h-[340px] bg-white relative">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 12, right: 28, left: 0, bottom: 22 }}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[chartDate.start, chartDate.end]}
                tickFormatter={formatTimeShort}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                stroke="#e2e8f0"
                axisLine={false}
                tickLine={false}
                tickCount={6}
                interval="preserveStartEnd"
                label={{
                  value: chartDate.label,
                  position: "insideBottomRight",
                  offset: -8,
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                stroke="#e2e8f0"
                axisLine={false}
                tickLine={false}
                domain={yDomain}
                width={56}
                tickFormatter={(v) => Number(v).toFixed(2)}
              />
              <Tooltip content={<StraddleTooltip />} cursor={{ stroke: "rgba(15, 23, 42, 0.08)", strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="premium"
                name="Straddle Price"
                stroke="#0ea5e9"
                dot={false}
                strokeWidth={2.25}
                isAnimationActive={false}
              />
              {lastPoint && lastPoint.premium != null && (
                <ReferenceDot
                  x={lastPoint.ts}
                  y={lastPoint.premium}
                  r={4}
                  fill="#0ea5e9"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{
                    value: formatNumber(lastPoint.premium),
                    position: "right",
                    fill: "#0284c7",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Primary metrics — match white reference */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-5 py-4 border-t border-slate-100 bg-white">
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Straddle</div>
            <div className="text-2xl font-bold text-sky-600 tabular-nums">
              {meta?.premium != null ? Number(meta.premium).toFixed(2) : "—"}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{index} Spot</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {meta?.underlying != null ? Number(meta.underlying).toFixed(2) : "—"}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Synthetic Future</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {synthetic != null ? synthetic.toFixed(2) : "—"}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Strike / CE / PE</div>
            <div className="text-base font-semibold text-slate-800 tabular-nums">
              {meta?.strike != null && meta?.ce_ltp != null && meta?.pe_ltp != null
                ? `${meta.strike} · ${Number(meta.ce_ltp).toFixed(2)} / ${Number(meta.pe_ltp).toFixed(2)}`
                : "—"}
            </div>
          </div>
        </div>

        {/* Secondary row — inspired by reference desk strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-2.5 border-t border-slate-100 bg-slate-50/80 text-[11px]">
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Strike</span>
            <div className="font-mono font-semibold text-slate-800">{meta?.strike ?? "—"}</div>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-wider">Days to expiry</span>
            <div className="font-mono font-semibold text-slate-800">{dte ?? "—"}</div>
          </div>
          <div className="sm:col-span-2">
            <span className="text-slate-500 uppercase tracking-wider">Last updated</span>
            <div className="font-mono font-semibold text-slate-800">{lastUpdated ?? "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
