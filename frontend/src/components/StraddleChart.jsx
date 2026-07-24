import React, { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { fetchStraddle } from "../lib/api";

function formatTimeShort(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  } catch {
    return "-";
  }
}

export default function StraddleChart({ index = "SENSEX", expiry = null, position = "long", qty = 1, pollMs = 30000, maxPoints = 7200, useWs = true }) {
  const [points, setPoints] = useState([]); // {ts, premium, underlying}
  const [meta, setMeta] = useState(null);
  const wsRef = useRef(null);

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
          const now = msg.ts || new Date().toISOString();
          setMeta({ atm: msg.atm, underlying: msg.underlying, strike: msg.atm, ce_ltp: msg.ce_ltp, pe_ltp: msg.pe_ltp, premium: msg.premium });
          setPoints((prev) => {
            const next = prev.concat({ ts: now, premium: msg.premium, underlying: msg.underlying });
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
        const res = await fetchStraddle(index, { expiry, position, qty });
        const now = new Date().toISOString();
        if (stopped) return;
        setMeta({ atm: res.atm, underlying: res.underlying, strike: res.strike, ce_ltp: res.ce_ltp, pe_ltp: res.pe_ltp, premium: res.premium });
        setPoints((prev) => {
          const next = prev.concat({ ts: now, premium: res.premium, underlying: res.underlying });
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
        const h = await fetchStraddleHistory(index, 60, { expiry });
        if (cancelled) return;
        const arr = (h.history || []).map((s) => ({ ts: s.ts, premium: s.premium, underlying: s.underlying }));
        setPoints(arr.slice(-maxPoints));
        if (arr.length) setMeta({ atm: arr[arr.length - 1].atm || null, underlying: arr[arr.length - 1].underlying || null, premium: arr[arr.length - 1].premium || null, ce_ltp: arr[arr.length - 1].ce_ltp, pe_ltp: arr[arr.length - 1].pe_ltp, strike: arr[arr.length - 1].atm });
      } catch (e) {
        // ignore
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [index, expiry, maxPoints]);

  return (
    <div className="w-full" data-testid="straddle-chart">
      <div className="w-full bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-lg font-bold text-slate-900">{index} - Straddle Premium</h2>
          <div className="text-xs font-mono text-slate-500">
            {meta ? new Date().toLocaleTimeString() : "Loading…"}
          </div>
        </div>

        {/* Chart */}
        <div className="px-6 py-4 h-[350px]">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid stroke="rgba(226, 232, 240, 0.8)" />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTimeShort}
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#e2e8f0"
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#e2e8f0"
                domain={["auto", "auto"]}
              />
              <Tooltip
                formatter={(v) => [v?.toFixed(2), "Premium"]}
                labelFormatter={(l) => formatTimeShort(l)}
                contentStyle={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  color: "#1e293b",
                }}
              />
              <Line
                type="monotone"
                dataKey="premium"
                stroke="#06b6d4"
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <div className="flex flex-col">
            <div className="text-xs font-semibold text-slate-600 mb-1">Straddle Price</div>
            <div className="text-2xl font-bold text-cyan-600">
              {meta && meta.premium != null ? meta.premium.toFixed(2) : "—"}
            </div>
          </div>

          <div className="flex flex-col">
            <div className="text-xs font-semibold text-slate-600 mb-1">{index} Spot</div>
            <div className="text-2xl font-bold text-slate-900">
              {meta && meta.underlying != null ? meta.underlying.toFixed(2) : "—"}
            </div>
          </div>

          <div className="flex flex-col">
            <div className="text-xs font-semibold text-slate-600 mb-1">Synthetic Future</div>
            <div className="text-2xl font-bold text-slate-900">
              {meta && meta.strike != null && meta.ce_ltp != null && meta.pe_ltp != null
                ? (meta.strike + (meta.ce_ltp - meta.pe_ltp)).toFixed(2)
                : "—"}
            </div>
          </div>

          <div className="flex flex-col">
            <div className="text-xs font-semibold text-slate-600 mb-1">Strike / CE / PE</div>
            <div className="text-lg font-bold text-slate-800">
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
