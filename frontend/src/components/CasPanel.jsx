import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import InfoTip from "@/components/InfoTip";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Play,
  Square,
  Zap,
  RefreshCw,
  Shield,
} from "lucide-react";

function fmt(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
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
      Nothing fires until you click <b>Activate</b>. Window ≈ 15:27–15:35 IST.
      Tue = NIFTY · Thu = SENSEX.
    </p>
  </div>
);

export default function CasPanel({ isAdmin = false, isKiteMode = false }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lots, setLots] = useState(1);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("live"); // live | backtest
  const [btStart, setBtStart] = useState("");
  const [btEnd, setBtEnd] = useState("");
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
  const fills = state.fills || [];
  const watching = day.indexes || plain.watching || [];

  const modeTone = useMemo(() => {
    if (activated && live) return "rose";
    if (activated) return "sky";
    return "slate";
  }, [activated, live]);

  const saveLots = async (nextLots) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      const { data } = await api.post("/cas/settings", { lots: nextLots });
      setStatus(data);
      setLots(Number(data?.config?.lots) || nextLots);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const setLiveTrading = async (on) => {
    if (!isAdmin) return;
    if (on) {
      const ok = window.confirm(
        "Turn on LIVE trading?\n\nWhen you Activate, real MARKET sell orders will be sent to Zerodha.\nPaper is safer for practice."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/cas/settings", { live_trading: !!on });
      setStatus(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!isAdmin) return;
    if (live) {
      const ok = window.confirm(
        "ACTIVATE LIVE CAS?\n\nThis arms real MARKET sells for today’s expiry index when the closing print arrives.\nOnly continue if you mean it."
      );
      if (!ok) return;
    }
    setBusy(true);
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
        lots,
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
    sky: "border-sky-300 bg-sky-50 text-sky-900",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  }[modeTone];

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
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" data-testid="cas-error">
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
              Watching:{" "}
              {watching.length ? watching.join(", ") : plain.is_expiry_day === false ? "no expiry today (paper can still rehearse)" : "—"}
              {plain.fired?.length ? ` · Fired: ${plain.fired.join(", ")}` : ""}
              {state.ws_connected ? " · Feed connected" : activated ? " · Waiting for feed…" : ""}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">How it sells</div>
              <div className="text-xs text-slate-700 mt-1 leading-relaxed">
                On the CAS print: sell <b>1 Call + 1 Put</b> (ATM / OTM rule).
                Window <b>15:27–15:35 IST</b>. Move band <b>15:28–15:30</b>.
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Calendar</div>
              <div className="text-xs text-slate-700 mt-1">
                <div><b>Tuesday</b> → NIFTY weekly</div>
                <div><b>Thursday</b> → SENSEX weekly</div>
                <div className="text-slate-500 mt-1">
                  {day.is_expiry_day ? "Today is an expiry day." : "Today is not an expiry day."}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Last close / LTP</div>
              <div className="text-xs font-mono-data text-slate-800 mt-1 space-y-0.5">
                {["NIFTY", "SENSEX"].map((idx) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <span>{idx}</span>
                    <span>
                      {fmt(state.baseline_close?.[idx], 1)}
                      {state.last_ltp?.[idx] != null ? ` → ${fmt(state.last_ltp[idx], 1)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
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
                <div className="flex items-center gap-2 pt-4">
                  <Shield className={`w-4 h-4 ${live ? "text-rose-600" : "text-sky-600"}`} />
                  <div>
                    <div className="text-[11px] font-semibold text-slate-800">
                      {live ? "Live trading" : "Paper trading"}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {live ? "Real MARKET sells" : "Dry-run only — safe"}
                    </div>
                  </div>
                  <Switch
                    checked={live}
                    disabled={!isAdmin || busy}
                    onCheckedChange={setLiveTrading}
                    data-testid="cas-live-toggle"
                  />
                </div>
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2">
                  {!activated ? (
                    <Button
                      size="sm"
                      className={`h-9 rounded-sm ${live ? "bg-rose-600 hover:bg-rose-700" : "bg-sky-600 hover:bg-sky-700"}`}
                      onClick={activate}
                      disabled={busy || !isKiteMode || !!status?.market_closed}
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
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  View only — ask admin to Activate / change Paper↔Live.
                </div>
              )}
            </div>
            {live && (
              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-sm px-2 py-1.5">
                Live is on. Activate only if you intend to sell options for real.
              </div>
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
              Today’s fills ({fills.length})
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
                        <td className="px-2 py-1.5">{f.opt_type} {f.strike}</td>
                        <td className="px-2 py-1.5">{f.tradingsymbol}</td>
                        <td className="px-2 py-1.5 text-right">{f.quantity}</td>
                        <td className="px-2 py-1.5">{String(f.order_id || "—")}</td>
                        <td className="px-2 py-1.5">
                          {f.dry_run ? (
                            <span className="text-sky-700">Paper</span>
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
            <Button
              size="sm"
              className="h-8 rounded-sm"
              onClick={runBacktest}
              disabled={btBusy}
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
              <div className="overflow-auto max-h-72 border border-slate-100 rounded-sm">
                <table className="w-full text-[11px] font-mono-data">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Date</th>
                      <th className="text-left px-2 py-1">Index</th>
                      <th className="text-right px-2 py-1">Close</th>
                      <th className="text-right px-2 py-1">CE/PE</th>
                      <th className="text-right px-2 py-1">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(btResult.trades || []).map((t, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1">{t.entry_date}</td>
                        <td className="px-2 py-1">{t.index}</td>
                        <td className="px-2 py-1 text-right">{fmt(t.close_price, 1)}</td>
                        <td className="px-2 py-1 text-right">{t.ce_strike}/{t.pe_strike}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${t.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {fmt(t.pnl, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(btResult.notes || []).slice(0, 3).map((n, i) => (
                <div key={i} className="text-[10px] text-slate-500">{n}</div>
              ))}
            </div>
          )}
        </div>
      )}
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
