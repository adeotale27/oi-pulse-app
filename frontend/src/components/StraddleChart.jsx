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
import { fetchStraddleTick, fetchStraddleHistory } from "../lib/api";
import { isMarketQuiescent, getMarketOpenMinute, getMarketCloseMinute, getMarketOpenHm, getMarketCloseHm } from "@/lib/marketTimes";
import { sessionAnchorDateIST } from "@/lib/holidays";
import PageBrandTitle from "@/components/PageBrandTitle";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Chart display resolution — denser than admin persistence when live ticks arrive. */
const CHART_BUCKET_MS = 15_000;
/** Live REST poll when WS is unavailable — keep the line moving like FinanceDeft. */
const LIVE_POLL_MS = 15_000;

function formatTimeShort(ts) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ts));
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
    const expiryCloseMin = getMarketCloseMinute();
    const hh = Math.floor(expiryCloseMin / 60);
    const mm = expiryCloseMin % 60;
    // Convert IST close to approximate UTC for day-count (IST = UTC+5:30)
    const utcH = hh - 5;
    const utcM = mm - 30;
    let adjH = utcH;
    let adjM = utcM;
    if (adjM < 0) { adjM += 60; adjH -= 1; }
    const expiryMs = Date.UTC(y, m - 1, d, adjH, adjM);
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

/** Keep one point per sample bucket — last write wins inside the bucket. */
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

function mergePointSeries(base, extra, bucketMs, maxPoints) {
  const merged = downsampleToBuckets(
    [...(base || []), ...(extra || [])]
      .filter((p) => Number.isFinite(p?.ts) && p.premium != null)
      .sort((a, b) => a.ts - b.ts),
    bucketMs,
  );
  if (merged.length > maxPoints) return merged.slice(merged.length - maxPoints);
  return merged;
}

function StraddleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 p-3 text-left text-sm text-slate-900 shadow-lg">
      <div className="font-semibold text-slate-900 mb-2">{formatTimeShort(label)}</div>
      <div className="text-slate-700">Straddle price: <span className="font-semibold text-teal-600">{formatNumber(point.premium)}</span></div>
      <div className="text-slate-700">Index spot: <span className="font-semibold text-slate-900">{formatNumber(point.underlying)}</span></div>
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
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
}

/** Session window from admin market_open_ist / market_close_ist for a trade date. */
function sessionWindowMs(tradeDate) {
  const openMin = getMarketOpenMinute();
  const closeMin = getMarketCloseMinute();
  const start = istDateToUtcMs(tradeDate, Math.floor(openMin / 60), openMin % 60);
  const end = istDateToUtcMs(tradeDate, Math.floor(closeMin / 60), closeMin % 60);
  if (start == null || end == null) return null;
  return { start, end };
}

/** Keep only samples inside the NSE cash/F&O session for `tradeDate`. */
function filterSessionPoints(arr, tradeDate) {
  const win = sessionWindowMs(tradeDate);
  if (!win || !arr?.length) return [];
  // Allow 1m pre-open poll tick through to first open bucket.
  const lo = win.start - 60_000;
  return arr
    .filter((p) => Number.isFinite(p.ts) && p.ts >= lo && p.ts <= win.end)
    .map((p) => (p.ts < win.start ? { ...p, ts: win.start } : p))
    .sort((a, b) => a.ts - b.ts);
}

function buildSessionTicks(start, end) {
  if (start == null || end == null || end <= start) return [start].filter(Boolean);
  const span = end - start;
  const step =
    span <= 10 * 60_000 ? 1 * 60_000
      : span <= 45 * 60_000 ? 5 * 60_000
        : span <= 90 * 60_000 ? 15 * 60_000
          : 45 * 60_000;
  const ticks = [start];
  for (let t = start + step; t < end - step / 2; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== end) ticks.push(end);
  return ticks;
}

/** Drop session outliers that create comb spikes (near-zero drops or 3× jumps). */
function filterPremiumOutliers(points) {
  if (!points?.length) return points || [];
  const vals = points.map((p) => Number(p.premium)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (vals.length < 5) return points;
  const mid = vals[Math.floor(vals.length / 2)];
  const lo = Math.max(1, mid * 0.35);
  const hi = Math.max(mid * 2.5, mid + 200);
  return points.filter((p) => {
    const v = Number(p.premium);
    return Number.isFinite(v) && v >= lo && v <= hi;
  });
}

function normalizePoint(raw, winStart) {
  const now = raw.ts ? (typeof raw.ts === "number" ? raw.ts : Date.parse(raw.ts)) : Date.now();
  if (!Number.isFinite(now)) return null;
  const underlying = raw.underlying ?? raw.price ?? null;
  const ce = raw.ce_ltp;
  const pe = raw.pe_ltp;
  const premium =
    raw.premium != null
      ? Number(raw.premium)
      : ce != null && pe != null
        ? Number(ce) + Number(pe)
        : null;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  // Hard reject obviously broken quotes (wrong-leg / stale LTP → 1000+ spikes).
  if (premium > 2500) return null;
  if (ce != null && pe != null) {
    const c = Number(ce);
    const p = Number(pe);
    if (!(c > 0) || !(p > 0)) return null;
  }
  return {
    ts: winStart != null ? Math.max(now, winStart) : now,
    premium,
    underlying: underlying != null ? Number(underlying) : null,
    strike: raw.atm ?? raw.strike ?? null,
    atm: raw.atm ?? raw.strike ?? null,
    ce_ltp: ce != null ? Number(ce) : null,
    pe_ltp: pe != null ? Number(pe) : null,
  };
}

/** Robust Y domain — ignore extreme outliers so one bad tick cannot break the chart. */
function robustPremiumDomain(points) {
  const vals = points
    .map((p) => Number(p.premium))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!vals.length) return [0, 1];
  const mid = vals[Math.floor(vals.length / 2)];
  const filtered = vals.filter((v) => v <= Math.max(mid * 2.5, mid + 150));
  const use = filtered.length >= Math.max(3, Math.floor(vals.length * 0.7)) ? filtered : vals;
  const lo = use[0];
  const hi = use[use.length - 1];
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  return [Math.max(0, lo - pad), hi + pad];
}

export default function StraddleChart({
  index = "SENSEX",
  expiry = null,
  position = "long",
  qty = 1,
  pollMs = 15000,
  maxPoints = 7200,
  useWs = true,
}) {
  const [points, setPoints] = useState([]);
  const [meta, setMeta] = useState(null);
  const [tradeDate, setTradeDate] = useState(() => sessionAnchorDateIST(new Date(), getMarketOpenMinute()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const wsRef = useRef(null);
  const tradeDateRef = useRef(tradeDate);
  // Display bucket stays dense; admin pollMs only hints persistence / REST cadence.
  const bucketMs = CHART_BUCKET_MS;
  const livePollMs = Math.max(5_000, Math.min(LIVE_POLL_MS, Number(pollMs) || LIVE_POLL_MS));

  useEffect(() => {
    tradeDateRef.current = tradeDate;
  }, [tradeDate]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const nextAnchor = sessionAnchorDateIST(new Date(now), getMarketOpenMinute());
      setTradeDate((prev) => (prev === nextAnchor ? prev : nextAnchor));
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const day = istTime.getDay();
    if (day === 0 || day === 6) return false;
    const nowMin = hours * 60 + minutes;
    return nowMin >= getMarketOpenMinute() && nowMin <= getMarketCloseMinute();
  };

  const applyMeta = (point, ts) => {
    setMeta({
      ts: ts || point.ts,
      atm: point.atm ?? point.strike,
      underlying: point.underlying,
      strike: point.atm ?? point.strike,
      ce_ltp: point.ce_ltp,
      pe_ltp: point.pe_ltp,
      premium: point.premium,
    });
  };

  const pushLivePoint = (raw) => {
    const activeDate = tradeDateRef.current;
    const pointDate = toIstDateString(raw.ts ? (typeof raw.ts === "number" ? raw.ts : Date.parse(raw.ts)) : Date.now());
    if (pointDate !== activeDate) return;

    const win = sessionWindowMs(activeDate);
    if (!win) return;
    const point = normalizePoint(raw, win.start);
    if (!point) return;
    if (point.ts < win.start - 60_000 || point.ts > win.end) return;

    applyMeta(point, point.ts);
    setPoints((prev) => {
      const sessionPrev = filterSessionPoints(prev, activeDate);
      const last = sessionPrev.length ? sessionPrev[sessionPrev.length - 1] : null;
      if (last?.premium > 0) {
        // Reject both explosive spikes and near-zero drops that create comb charts.
        if (point.premium > Math.max(last.premium * 3, last.premium + 200)) return prev;
        if (point.premium < Math.min(last.premium * 0.35, last.premium - 50) && last.premium > 40) {
          return prev;
        }
      }
      const next = upsertBucketed(sessionPrev, point, bucketMs);
      if (next.length > maxPoints) return next.slice(next.length - maxPoints);
      return next;
    });
  };

  // Hard reset chart state when index/expiry changes so we never blend
  // NIFTY (~100) premiums into a SENSEX (~700) series (or vice versa).
  useEffect(() => {
    setPoints([]);
    setMeta(null);
  }, [index, expiry]);

  // History — replace series for this index (do not merge foreign ticks).
  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const h = await fetchStraddleHistory(index, null, { expiry, date: tradeDate });
        if (cancelled) return;
        const resolvedDate = h.trade_date || tradeDate;
        if (resolvedDate && resolvedDate !== tradeDate) {
          setTradeDate(resolvedDate);
        }
        const sessionDate = resolvedDate || tradeDate;
        const arr = (h.history || [])
          .map((s) => normalizePoint(s, null))
          .filter(Boolean);
        // Drop residual outliers vs session median before plotting.
        const cleaned = filterPremiumOutliers(arr);
        const sliced = downsampleToBuckets(
          filterSessionPoints(cleaned, sessionDate),
          bucketMs,
        ).slice(-maxPoints);
        // Replace — never merge previous index's live points into the new series.
        setPoints(filterSessionPoints(sliced, sessionDate));
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
            index,
          });
        }
      } catch (_e) { /* ignore */ }
    };
    loadHistory();
    // Soft refresh history every 2 min so reopened tabs catch sampler density.
    const refreshId = setInterval(loadHistory, 120_000);
    return () => {
      cancelled = true;
      clearInterval(refreshId);
    };
  }, [index, expiry, maxPoints, bucketMs, tradeDate]);

  // Live feed — public WS + REST tick safety net (15s).
  useEffect(() => {
    let stopped = false;
    let conn = null;
    let pollId = null;
    let running = true;
    let wsAlive = false;

    const tick = async () => {
      try {
        if (!isMarketOpen()) return;
        // Prefer WS when connected — avoid double Kite quote load.
        if (wsAlive) return;
        const res = await fetchStraddleTick(index, { expiry });
        if (stopped) return;
        pushLivePoint(res);
      } catch (_e) { /* ignore */ }
    };

    const startPolling = () => {
      if (pollId) return;
      tick();
      pollId = setInterval(() => {
        if (running) tick();
      }, livePollMs);
    };

    try {
      if (isMarketQuiescent()) {
        return () => {
          running = false;
          stopped = true;
        };
      }
    } catch (_e) { /* fall through */ }

    if (useWs && typeof window !== "undefined") {
      try {
        const { connectStraddleWS } = require("../lib/straddleWs");
        conn = connectStraddleWS(
          index,
          { expiry, position, qty },
          (msg) => {
            if (stopped) return;
            if (msg?.status === "market_closed") return;
            if (msg && msg.premium != null) {
              wsAlive = true;
              pushLivePoint(msg);
            }
          },
          () => { wsAlive = true; },
          () => { wsAlive = false; },
        );
        wsRef.current = conn;
        startPolling();
      } catch (_e) {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      running = false;
      stopped = true;
      if (pollId) clearInterval(pollId);
      try { conn && conn.stop && conn.stop(); } catch (_) { /* noop */ }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, expiry, position, qty, livePollMs, maxPoints, useWs, bucketMs, tradeDate]);

  const chartWindow = useMemo(() => {
    const openMin = getMarketOpenMinute();
    const closeMin = getMarketCloseMinute();
    const openH = Math.floor(openMin / 60);
    const openM = openMin % 60;
    const closeH = Math.floor(closeMin / 60);
    const closeM = closeMin % 60;
    const win = sessionWindowMs(tradeDate) || {
      start: istDateToUtcMs(sessionAnchorDateIST(), openH, openM),
      end: istDateToUtcMs(sessionAnchorDateIST(), closeH, closeM),
    };
    const liveToday = toIstDateString(nowMs) === tradeDate;
    let end = win.end;
    if (liveToday && nowMs >= win.start && nowMs < win.end) {
      // FinanceDeft-style: right edge tracks "now" tightly — no forced 15-min span.
      const lastTs = points.length ? points[points.length - 1].ts : win.start;
      end = Math.min(win.end, Math.max(nowMs + bucketMs, lastTs + bucketMs, win.start + 60_000));
    }
    const start = win.start;
    const ticks = buildSessionTicks(start, end);
    const isLive = liveToday && nowMs >= win.start && nowMs <= win.end + 60_000;
    const openHm = getMarketOpenHm();
    const closeHm = getMarketCloseHm();
    return {
      start,
      end,
      ticks,
      label: isLive ? `${openHm} IST → live` : `${openHm} – ${closeHm} IST · ${tradeDate}`,
    };
  }, [tradeDate, nowMs, bucketMs, points]);

  const sessionPoints = useMemo(
    () => filterSessionPoints(points, tradeDate),
    [points, tradeDate],
  );

  const yDomain = useMemo(() => robustPremiumDomain(sessionPoints), [sessionPoints]);

  const chartPoints = useMemo(() => {
    if (!sessionPoints.length || yDomain[1] <= yDomain[0]) return sessionPoints;
    const hi = yDomain[1] * 1.05;
    // Drop residual outliers from the line so spikes cannot stretch the path.
    return sessionPoints.filter((p) => Number(p.premium) <= hi);
  }, [sessionPoints, yDomain]);

  const lastPoint = chartPoints.length ? chartPoints[chartPoints.length - 1] : null;
  const dte = daysToExpiryLabel(expiry);
  const lastUpdated = meta?.ts
    ? new Date(meta.ts).toLocaleString([], {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="w-full" data-testid="straddle-chart">
      <div className="w-full rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm overflow-hidden">
        <div className="px-3 py-2 md:px-5 md:py-3 border-b border-slate-100 flex items-center justify-between bg-white">
          <PageBrandTitle
            kicker={index}
            title="Straddle Premium"
            titleClassName="text-sm md:text-lg font-bold text-slate-900"
            testId="straddle-page-title"
          />
          <div className="text-right">
            <div className="text-[11px] md:text-xs font-mono text-slate-500">
              {meta
                ? new Date(meta.ts || Date.now()).toLocaleTimeString([], {
                    timeZone: "Asia/Kolkata",
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "Loading…"}
            </div>
            <div className="hidden md:block text-[10px] text-slate-400 mt-0.5">
              <span className="inline-flex items-center rounded-sm bg-white border border-slate-200 px-1.5 py-0.5 text-slate-600">
                {Math.round(bucketMs / 1000)}s chart · live {Math.round(livePollMs / 1000)}s
              </span>
            </div>
          </div>
        </div>

        <div className="px-1 pt-2 pb-1 md:px-4 md:pt-3 md:pb-2 h-[280px] md:h-[460px] bg-white relative">
          <ResponsiveContainer>
            <LineChart data={chartPoints} margin={{ top: 10, right: 12, left: 0, bottom: 18 }}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[chartWindow.start, chartWindow.end]}
                ticks={chartWindow.ticks}
                tickFormatter={formatTimeShort}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                stroke="#e2e8f0"
                axisLine={false}
                tickLine={false}
                allowDataOverflow
                height={28}
              />
              <YAxis
                yAxisId="premium"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                stroke="#e2e8f0"
                axisLine={false}
                tickLine={false}
                domain={yDomain}
                width={44}
                tickFormatter={(v) => Number(v).toFixed(0)}
              />
              <Tooltip content={<StraddleTooltip />} cursor={{ stroke: "rgba(15, 23, 42, 0.08)", strokeWidth: 1 }} />
              <Line
                yAxisId="premium"
                type="monotone"
                dataKey="premium"
                stroke="#14b8a6"
                dot={false}
                strokeWidth={2.25}
                isAnimationActive={false}
                connectNulls={false}
              />
              {lastPoint && lastPoint.premium != null && (
                <ReferenceDot
                  yAxisId="premium"
                  x={lastPoint.ts}
                  y={lastPoint.premium}
                  r={4}
                  fill="#14b8a6"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{
                    value: formatNumber(lastPoint.premium),
                    position: "right",
                    fill: "#0f766e",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* FinanceDeft-style summary strip */}
        <div className="flex flex-wrap gap-x-5 gap-y-3 px-4 py-3 border-t border-slate-200 bg-slate-50/90 text-[12px]">
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Straddle Price</div>
            <div className="font-mono font-bold text-teal-700 text-base tabular-nums">
              {meta?.premium != null ? Number(meta.premium).toFixed(2) : "—"}
            </div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{index} Spot</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums">
              {meta?.underlying != null ? Number(meta.underlying).toFixed(2) : "—"}
            </div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Straddle Strike</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums">{meta?.strike ?? "—"}</div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              {meta?.strike != null ? `${meta.strike}CE` : "CE"}
            </div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums">
              {meta?.ce_ltp != null ? Number(meta.ce_ltp).toFixed(2) : "—"}
            </div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              {meta?.strike != null ? `${meta.strike}PE` : "PE"}
            </div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums">
              {meta?.pe_ltp != null ? Number(meta.pe_ltp).toFixed(2) : "—"}
            </div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Days to Expiry</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums">{dte ?? "—"}</div>
          </div>
          <div className="min-w-[6.5rem] shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Last Updated</div>
            <div className="font-mono font-semibold text-slate-800 text-[11px]">{lastUpdated ?? "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
