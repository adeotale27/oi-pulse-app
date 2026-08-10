import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import InfoTip from "@/components/InfoTip";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Play,
  Square,
  Zap,
  RefreshCw,
  Shield,
} from "lucide-react";

const ALL_INDEXES = ["NIFTY", "SENSEX"];

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  const s = String(iso);
  // Prefer HH:MM:SS.mmm from ISO
  const m = s.match(/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (m) return m[1].replace(/(\.\d{3})\d+$/, "$1");
  return s.slice(11, 23) || s;
}

function fmtMs(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return String(Math.round(Number(v)));
}

const GUIDE = (
  <div className="space-y-2 text-[12px] leading-relaxed">
    <p>
      Near market close the exchange prints a special <b>CAS closing price</b>.
      This tool sells one Call + one Put the moment that print appears.
    </p>
    <p>
      <b>Paper</b> — watches the live feed and pretends to sell (safe).
      <b> Live</b> — places real Zerodha MARKET sells (admin only).
    </p>
    <p>
      <b>Debug</b> — Activate anytime (even after hours). With Paper, windows
      widen so you can see ticks, last close, and dry-run timing.
    </p>
    <p>
      Nothing fires until you click <b>Activate</b>. Normal window ≈ 15:27–15:35 IST.
      Tue = NIFTY · Thu = SENSEX.
    </p>
  </div>
);

function toggleIndex(list, name) {
  const set = new Set(list);
  if (set.has(name)) {
    if (set.size <= 1) return list; // keep at least one
    set.delete(name);
  } else {
    set.add(name);
  }
  return ALL_INDEXES.filter((x) => set.has(x));
}

export default function CasPanel({ isAdmin = false, isKiteMode = false }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lots, setLots] = useState(1);
  const [watchIndexes, setWatchIndexes] = useState(["NIFTY", "SENSEX"]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("live"); // live | backtest
  const [btStart, setBtStart] = useState("");
  const [btEnd, setBtEnd] = useState("");
  const [btLots, setBtLots] = useState(1);
  const [btIndexes, setBtIndexes] = useState(["NIFTY", "SENSEX"]);
  const [btResult, setBtResult] = useState(null);
  const [btBusy, setBtBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/cas/status");
      setStatus(data);
      const cfgLots = data?.config?.lots ?? data?.settings?.lots;
      if (cfgLots != null) setLots(Number(cfgLots) || 1);
      const wi =
        data?.config?.watch_indexes ||
        data?.settings?.watch_indexes ||
        null;
      if (Array.isArray(wi) && wi.length) {
        setWatchIndexes(wi.map((x) => String(x).toUpperCase()));
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load CAS");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const plain = status?.plain || {};
  const cfg = status?.config || {};
  const state = status?.state || {};
  const day = status?.day || {};
  const activated = !!plain.activated || !!state.activated;
  const live = !!plain.live || !!cfg.live_trading;
  const debug = !!(plain.debug || cfg.debug_mode || status?.settings?.debug_mode);
  const fills = state.fills || [];
  const timings = state.timings || [];
  const watching = day.indexes || plain.watching || watchIndexes;
  const ticks =
    plain.ticks ??
    state.ticks_seen ??
    status?.ws?.ticks_received ??
    0;
  const marketClosed = !!status?.market_closed && !debug;
  const readiness = status?.live_readiness || {};

  const modeTone = useMemo(() => {
    if (activated && live) return "rose";
    if (activated && debug) return "amber";
    if (activated) return "emerald";
    if (debug) return "amber";
    return "slate";
  }, [activated, live, debug]);

  const patchSettings = async (patch) => {
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/cas/settings", patch);
      setStatus(data);
      if (patch.lots != null) setLots(Number(data?.config?.lots) || patch.lots);
      if (patch.watch_indexes) {
        const wi = data?.config?.watch_indexes || patch.watch_indexes;
        setWatchIndexes((wi || []).map((x) => String(x).toUpperCase()));
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveLots = async (nextLots) => {
    const n = Math.max(1, Math.min(50, Number(nextLots) || 1));
    setLots(n);
    await patchSettings({ lots: n });
  };

  const setLiveTrading = async (on) => {
    if (!isAdmin) return;
    if (on) {
      const ok = window.confirm(
        "Switch to LIVE?\n\nActivate will place real MARKET sells on Zerodha.\nUse Paper to practise safely."
      );
      if (!ok) return;
    }
    await patchSettings({ live_trading: !!on });
  };

  const setDebugMode = async (on) => {
    if (!isAdmin) return;
    await patchSettings({ debug_mode: !!on });
  };

  const setWatch = async (next) => {
    setWatchIndexes(next);
    await patchSettings({ watch_indexes: next });
  };

  const activate = async () => {
    if (!isAdmin) return;
    if (live) {
      const ok = window.confirm(
        "ACTIVATE LIVE CAS?\n\nReal MARKET sells will fire when CAS print arrives for selected indexes.\nOnly continue if you mean it."
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/cas/activate", { confirm_live: !!live });
      setStatus(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      const { data } = await api.post("/cas/deactivate");
      setStatus(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const runBacktest = async () => {
    setBtBusy(true);
    setBtResult(null);
    setError(null);
    try {
      const { data } = await api.post("/cas/backtest", {
        start: btStart || undefined,
        end: btEnd || undefined,
        lots: btLots,
        indexes: btIndexes,
      });
      setBtResult(data.result || null);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBtBusy(false);
    }
  };

  const toneBox = {
    rose: "border-rose-300 bg-rose-50 text-rose-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  }[modeTone];

  const watchStart = (cfg.watch_start || "15:27:00").slice(0, 5);
  const watchEnd = (cfg.watch_end || "15:35:00").slice(0, 5);
  const moveStart = (cfg.move_window_start || "15:28:00").slice(0, 5);
  const moveEnd = (cfg.move_window_end || "15:30:00").slice(0, 5);

  return (
    <div className="space-y-4" data-testid="cas-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-900">CAS Expiry</h2>
          <InfoTip title="What is CAS?" testId="cas-guide-tip">
            {GUIDE}
          </InfoTip>
          {day.weekday && (
            <span className="text-[10px] font-mono-data bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm">
              {day.weekday} {day.date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={tab === "live" ? "default" : "outline"}
            className="h-7 rounded-sm text-xs"
            onClick={() => setTab("live")}
            data-testid="cas-tab-live"
          >
            Today
          </Button>
          <Button
            size="sm"
            variant={tab === "backtest" ? "default" : "outline"}
            className="h-7 rounded-sm text-xs"
            onClick={() => setTab("backtest")}
            data-testid="cas-tab-backtest"
          >
            <FlaskConical className="w-3.5 h-3.5 mr-1" />
            Backtest
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-sm"
            onClick={load}
            disabled={loading}
            data-testid="cas-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
          data-testid="cas-error"
        >
          {error}
        </div>
      )}

      {!isKiteMode && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <b>Kite not connected.</b> Open <b>Kite API</b> in the header and connect first.
            Paper and Live both use the same credentials.
          </div>
        </div>
      )}

      {tab === "live" && (
        <>
          <div className={`rounded-md border px-4 py-3 ${toneBox}`} data-testid="cas-status-banner">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {activated ? <CheckCircle2 className="w-4 h-4" /> : <Clock3 className="w-4 h-4" />}
              {plain.mode_label || "Loading…"}
            </div>
            <div className="mt-1 text-[11px] opacity-90">
              Will trade: {watching.length ? watching.join(", ") : "—"}
              {plain.fired?.length ? ` · Fired: ${plain.fired.join(", ")}` : ""}
              {state.ws_connected ? " · Feed connected" : activated ? " · Waiting for feed…" : ""}
              {debug ? " · Debug on" : ""}
            </div>
          </div>

          {/* Controls: mode + debug + lots + indexes + arm */}
          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Trade mode
                </div>
                <div
                  className="inline-flex rounded-sm border border-slate-200 overflow-hidden"
                  data-testid="cas-mode-toggle"
                >
                  <button
                    type="button"
                    disabled={!isAdmin || busy}
                    onClick={() => live && setLiveTrading(false)}
                    className={`px-3 h-8 text-xs font-semibold ${
                      !live
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid="cas-mode-paper"
                  >
                    Paper
                  </button>
                  <button
                    type="button"
                    disabled={!isAdmin || busy}
                    onClick={() => !live && setLiveTrading(true)}
                    className={`px-3 h-8 text-xs font-semibold border-l border-slate-200 ${
                      live
                        ? "bg-rose-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid="cas-mode-live"
                  >
                    Live
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {live ? "Real MARKET sells" : "Dry-run only — no broker orders"}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                  <Bug className="w-3 h-3" /> Debug
                </div>
                <div className="flex items-center gap-2 h-8">
                  <Switch
                    checked={debug}
                    disabled={!isAdmin || busy}
                    onCheckedChange={setDebugMode}
                    data-testid="cas-debug-toggle"
                  />
                  <span className="text-[11px] text-slate-700">
                    {debug ? "On — Activate anytime" : "Off — market hours only"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Lots</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={lots}
                  disabled={!isAdmin || busy}
                  onChange={(e) => setLots(Number(e.target.value) || 1)}
                  onBlur={() => saveLots(lots)}
                  className="mt-0.5 w-16 h-8 px-2 text-sm border border-slate-200 rounded-sm font-mono-data"
                  data-testid="cas-lots"
                />
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Indexes
                </div>
                <div className="flex items-center gap-2 h-8" data-testid="cas-index-select">
                  {ALL_INDEXES.map((idx) => {
                    const on = watchIndexes.includes(idx);
                    return (
                      <label
                        key={idx}
                        className={`inline-flex items-center gap-1.5 px-2 h-8 text-xs border rounded-sm cursor-pointer ${
                          on
                            ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                            : "border-slate-200 bg-white text-slate-500"
                        } ${!isAdmin ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="accent-emerald-600"
                          checked={on}
                          disabled={!isAdmin || busy}
                          onChange={() => setWatch(toggleIndex(watchIndexes, idx))}
                          data-testid={`cas-index-${idx.toLowerCase()}`}
                        />
                        {idx}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="ml-auto">
                {isAdmin ? (
                  !activated ? (
                    <Button
                      size="sm"
                      className={`h-9 rounded-sm ${
                        live
                          ? "bg-rose-600 hover:bg-rose-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                      onClick={activate}
                      disabled={busy || !isKiteMode || marketClosed}
                      data-testid="cas-activate"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Activate {live ? "Live" : "Paper"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-sm border-slate-300"
                      onClick={deactivate}
                      disabled={busy}
                      data-testid="cas-deactivate"
                    >
                      <Square className="w-3.5 h-3.5 mr-1" />
                      Deactivate
                    </Button>
                  )
                ) : (
                  <div className="text-[11px] text-slate-500">
                    View only — ask admin to Activate / change mode.
                  </div>
                )}
              </div>
            </div>

            {live && (
              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-sm px-2 py-1.5 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                Live is selected. Activate only if you intend to sell options for real.
              </div>
            )}
            {debug && !live && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-sm px-2 py-1.5">
                Debug + Paper: CAS can arm outside market hours. Watch/move windows widen so you
                can see ticks, last close, and dry-run timing.
              </div>
            )}
            {marketClosed && !debug && (
              <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-sm px-2 py-1.5">
                Market closed for CAS (after 15:41 IST). Turn on Debug to rehearse, or try tomorrow.
              </div>
            )}
            {plain.last_error && (
              <div
                className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-sm px-2 py-1.5"
                data-testid="cas-last-error"
              >
                Last order/engine error: {plain.last_error}
              </div>
            )}
          </div>

          {/* Live readiness vs Zerodha MARKET rules */}
          <section
            className="rounded-md border border-slate-200 bg-white p-3 space-y-2"
            data-testid="cas-live-readiness"
          >
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Live order readiness
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {readiness.summary ||
                  "CAS places regular MARKET SELLs (CE+PE) with market_protection=-1."}
              </p>
              {readiness.egress_ip && (
                <p
                  className="text-[12px] font-mono-data text-slate-800 mt-1.5 bg-slate-50 border border-slate-100 rounded-sm px-2 py-1.5"
                  data-testid="cas-egress-ip"
                >
                  Backend egress IP to whitelist: <b>{readiness.egress_ip}</b>
                  <span className="block text-[10px] text-slate-500 font-sans mt-0.5">
                    This is the server that calls Zerodha (Emergent host if API is there) — not your
                    computer&apos;s IP unless you run the backend locally.
                  </span>
                </p>
              )}
            </div>
            <ul className="space-y-1.5">
              {(readiness.checks || []).map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-2 text-[11px] text-slate-700"
                  data-testid={`cas-ready-${c.id}`}
                >
                  <span className="mt-0.5 shrink-0">
                    {c.ok === true ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : c.ok === false ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    )}
                  </span>
                  <span>
                    <b>{c.label}</b>
                    <span className="text-slate-500"> — {c.fix}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* TODAY's RUN */}
          <section className="rounded-md border border-slate-200 bg-white p-3 space-y-2" data-testid="cas-today-run">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Today&apos;s run
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Watch <b>{watchStart}–{watchEnd}</b> · fire on move{" "}
                <b>{moveStart}–{moveEnd} IST</b>
                {debug && !live ? " (debug: any-time)" : " (never at watch open alone)"}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <MiniCard label="Today" value={`${day.date || "—"} · ${day.weekday || ""}`} />
              <MiniCard
                label="Will trade"
                value={watching.length ? watching.join(", ") : "—"}
              />
              <MiniCard label="Watch window" value={`${watchStart}–${watchEnd} IST`} />
              <MiniCard label="Move window" value={`${moveStart}–${moveEnd} IST`} />
              <MiniCard label="Feed ticks" value={String(ticks)} mono />
            </div>
          </section>

          {/* PRICES */}
          <section className="rounded-md border border-slate-200 bg-white p-3 space-y-2" data-testid="cas-prices">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Prices</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                <b>Last close</b> = previous session (history, once). <b>LTP</b> streams while CAS
                is armed. <b>Last move</b> = last LTP change in the watch window (trigger point for
                sells between {moveStart}–{moveEnd}).
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_INDEXES.map((idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2">
                  <MiniCard
                    label={`${idx} LTP`}
                    value={fmt(state.last_ltp?.[idx], 2)}
                    mono
                  />
                  <MiniCard
                    label={`Last close ${idx}`}
                    value={fmt(state.baseline_close?.[idx], 2)}
                    mono
                  />
                  <MiniCard
                    label={`Last move ${idx}`}
                    value={fmtTime(state.last_index_move_at?.[idx])}
                    mono
                    highlight={!!state.last_index_move_at?.[idx]}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* CAS → SELL TIMING */}
          <section className="rounded-md border border-slate-200 bg-white overflow-hidden" data-testid="cas-timing">
            <div className="px-3 py-2 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                CAS → Sell timing
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Detects a WebSocket tick of a CAS LTP move / close flip, then parallel MARKET SELL
                for CE + PE. PAPER rows are dry-run latency only.
              </p>
            </div>
            {timings.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                No CAS detect yet. After Activate, timing rows appear here when an index moves /
                closes.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-[11px] font-mono-data">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1.5">Index</th>
                      <th className="text-right px-2 py-1.5">Close</th>
                      <th className="text-left px-2 py-1.5">CAS detected</th>
                      <th className="text-left px-2 py-1.5">CE sold</th>
                      <th className="text-left px-2 py-1.5">PE sold</th>
                      <th className="text-right px-2 py-1.5">→CE ms</th>
                      <th className="text-right px-2 py-1.5">→PE ms</th>
                      <th className="text-right px-2 py-1.5">Total ms</th>
                      <th className="text-left px-2 py-1.5">Mode</th>
                      <th className="text-left px-2 py-1.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timings.map((t, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid="cas-timing-row">
                        <td className="px-2 py-1.5 font-semibold">{t.index}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(t.close_price, 2)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.cas_detected_at)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.ce_sold_at)}</td>
                        <td className="px-2 py-1.5">{fmtTime(t.pe_sold_at)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_ce_ms)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_pe_ms)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMs(t.detect_to_done_ms)}</td>
                        <td className="px-2 py-1.5">
                          {t.dry_run !== false ? (
                            <span className="text-emerald-700 font-semibold">PAPER</span>
                          ) : (
                            <span className="text-rose-700 font-semibold">LIVE</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">
                          {t.source || "—"}
                          {t.trigger ? ` · ${t.trigger}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Fills */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
              Today&apos;s fills ({fills.length})
            </div>
            {fills.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                No sells yet. After Activate, fills appear here when CAS fires.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs font-mono-data">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1.5">Time</th>
                      <th className="text-left px-2 py-1.5">Index</th>
                      <th className="text-left px-2 py-1.5">Leg</th>
                      <th className="text-left px-2 py-1.5">Symbol</th>
                      <th className="text-right px-2 py-1.5">Qty</th>
                      <th className="text-left px-2 py-1.5">Order</th>
                      <th className="text-left px-2 py-1.5">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((f, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid="cas-fill-row">
                        <td className="px-2 py-1.5">{String(f.ts || "").slice(11, 19) || "—"}</td>
                        <td className="px-2 py-1.5">{f.index}</td>
                        <td className="px-2 py-1.5">
                          {f.opt_type} {f.strike}
                        </td>
                        <td className="px-2 py-1.5">{f.tradingsymbol}</td>
                        <td className="px-2 py-1.5 text-right">{f.quantity}</td>
                        <td className="px-2 py-1.5">{String(f.order_id || "—")}</td>
                        <td className="px-2 py-1.5">
                          {f.dry_run ? (
                            <span className="text-emerald-700">Paper</span>
                          ) : (
                            <span className="text-rose-700 font-semibold">Live</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "backtest" && (
        <div className="rounded-md border border-slate-200 bg-white p-4 space-y-3" data-testid="cas-backtest">
          <div className="text-xs text-slate-600 leading-relaxed">
            Replays past expiry days with the <b>same strike + sell logic</b>. No live orders.
            Uses Kite history when connected; otherwise estimates premiums.
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[10px] uppercase text-slate-500">From</div>
              <input
                type="date"
                value={btStart}
                onChange={(e) => setBtStart(e.target.value)}
                className="h-8 px-2 text-xs border border-slate-200 rounded-sm"
                data-testid="cas-bt-start"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">To</div>
              <input
                type="date"
                value={btEnd}
                onChange={(e) => setBtEnd(e.target.value)}
                className="h-8 px-2 text-xs border border-slate-200 rounded-sm"
                data-testid="cas-bt-end"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Lots</div>
              <input
                type="number"
                min={1}
                max={50}
                value={btLots}
                onChange={(e) => setBtLots(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-16 px-2 text-xs border border-slate-200 rounded-sm font-mono-data"
                data-testid="cas-bt-lots"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500 mb-1">Indexes</div>
              <div className="flex items-center gap-2" data-testid="cas-bt-indexes">
                {ALL_INDEXES.map((idx) => {
                  const on = btIndexes.includes(idx);
                  return (
                    <label
                      key={idx}
                      className={`inline-flex items-center gap-1.5 px-2 h-8 text-xs border rounded-sm cursor-pointer ${
                        on
                          ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                          : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600"
                        checked={on}
                        onChange={() => setBtIndexes(toggleIndex(btIndexes, idx))}
                        data-testid={`cas-bt-index-${idx.toLowerCase()}`}
                      />
                      {idx}
                    </label>
                  );
                })}
              </div>
            </div>
            <Button
              size="sm"
              className="h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700"
              onClick={runBacktest}
              disabled={btBusy || !btIndexes.length}
              data-testid="cas-bt-run"
            >
              {btBusy ? "Running…" : "Run backtest"}
            </Button>
          </div>

          {btResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat label="Trades" value={btResult.num_trades} />
                <Stat label="Win rate" value={`${fmt(btResult.win_rate_pct, 1)}%`} />
                <Stat
                  label="Total P&L"
                  value={`₹ ${fmt(btResult.total_pnl, 0)}`}
                  tone={btResult.total_pnl >= 0 ? "emerald" : "rose"}
                />
                <Stat label="Max DD" value={`${fmt(btResult.max_drawdown_pct, 2)}%`} />
              </div>
              <div className="overflow-auto max-h-80 border border-slate-100 rounded-sm">
                <table className="w-full text-[11px] font-mono-data">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Date</th>
                      <th className="text-left px-2 py-1">Index</th>
                      <th className="text-right px-2 py-1">Close</th>
                      <th className="text-left px-2 py-1">CAS detected</th>
                      <th className="text-right px-2 py-1">CE / PE</th>
                      <th className="text-right px-2 py-1">Entry prem</th>
                      <th className="text-right px-2 py-1">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(btResult.trades || []).map((t, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1">{t.entry_date}</td>
                        <td className="px-2 py-1">{t.index}</td>
                        <td className="px-2 py-1 text-right">{fmt(t.close_price, 2)}</td>
                        <td className="px-2 py-1">{fmtTime(t.cas_detected_at)}</td>
                        <td className="px-2 py-1 text-right">
                          {t.ce_strike}/{t.pe_strike}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmt(t.ce_premium, 1)}/{fmt(t.pe_premium, 1)}
                        </td>
                        <td
                          className={`px-2 py-1 text-right font-semibold ${
                            t.pnl >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {fmt(t.pnl, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(btResult.notes || []).slice(0, 4).map((n, i) => (
                <div key={i} className="text-[10px] text-slate-500">
                  {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, mono, highlight }) {
  return (
    <div
      className={`rounded-sm border px-2.5 py-2 ${
        highlight
          ? "border-emerald-200 bg-emerald-50/80"
          : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={`text-[12px] font-semibold text-slate-800 mt-0.5 truncate ${
          mono ? "font-mono-data" : ""
        }`}
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-sm font-semibold font-mono-data ${color}`}>{value}</div>
    </div>
  );
}
