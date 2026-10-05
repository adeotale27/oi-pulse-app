import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Coffee, RefreshCw, Wrench } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";
import StrikLenzRobot from "@/components/StrikLenzRobot";
import AuthFeatureFooter from "@/components/AuthFeatureFooter";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import { api, fetchExtras, fetchTickers } from "@/lib/api";
import { isMarketOpenNow } from "@/hooks/useLiveDemo";
import "@/styles/landing.css";

function formatIndex(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  }) : "—";
}

export function MiniChart({ points: historyPoints }) {
  const reduceMotion = useReducedMotion();
  const chart = useMemo(() => {
    if (historyPoints.length < 2) return null;
    const prices = historyPoints.map((point) => point.price);
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    const midPrice = (max + min) / 2;
    const range = Math.max((max - min) * 1.15, midPrice * 0.0005, 1);
    const minPrice = midPrice - range / 2;
    const times = historyPoints.map((point) => Date.parse(point.timestamp));
    const start = times[0];
    const end = times[times.length - 1];
    const hasTimeRange = Number.isFinite(start) && Number.isFinite(end) && end > start;
    const coordinates = historyPoints.map((point, index) => {
      const x = hasTimeRange
        ? 10 + ((times[index] - start) / (end - start)) * 230
        : 10 + (index / (historyPoints.length - 1)) * 230;
      const y = 70 - ((point.price - minPrice) / range) * 48;
      return { x, y };
    });
    const format = ({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const linePath = coordinates.slice(0, -1).reduce((path, point, index) => {
      const next = coordinates[index + 1];
      const previous = coordinates[Math.max(0, index - 1)];
      const afterNext = coordinates[Math.min(coordinates.length - 1, index + 2)];
      const controlOne = {
        x: point.x + (next.x - previous.x) / 6,
        y: point.y + (next.y - previous.y) / 6,
      };
      const controlTwo = {
        x: next.x - (afterNext.x - point.x) / 6,
        y: next.y - (afterNext.y - point.y) / 6,
      };
      return index === 0
        ? `M${format(point)} C${format(controlOne)} ${format(controlTwo)} ${format(next)}`
        : `${path} C${format(controlOne)} ${format(controlTwo)} ${format(next)}`;
    }, "");
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return {
      linePath,
      last,
      lastTimestamp: historyPoints[historyPoints.length - 1].timestamp,
    };
  }, [historyPoints]);

  if (!chart) return null;

  return (
    <svg viewBox="0 0 250 90" className="h-full w-full" aria-hidden>
      <path d="M0 70H250M0 46H250M0 22H250" stroke="rgba(148, 210, 200, .14)" />
      <motion.path
        key={chart.lastTimestamp}
        d={chart.linePath}
        pathLength={1}
        initial={reduceMotion ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduceMotion ? 0 : 1.4, ease: "easeOut" }}
        fill="none"
        stroke="#32e6b0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!reduceMotion && (
        <motion.path
          key={`${chart.lastTimestamp}-trace`}
          d={chart.linePath}
          pathLength={1}
          stroke="#a7f3d0"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="0.08 0.92"
          animate={{ strokeDashoffset: [0, -1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
        />
      )}
      <circle
        cx={chart.last.x}
        cy={chart.last.y}
        r="3.2"
        fill="#a7f3d0"
        className={reduceMotion ? undefined : "maintenance-chart-pulse"}
      />
    </svg>
  );
}

function Ticker({ label, data }) {
  const change = data?.changePct == null || data.changePct === ""
    ? Number.NaN
    : Number(data.changePct);
  const validChange = Number.isFinite(change);
  const up = validChange && change >= 0;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-slate-200">
      <b className="font-semibold text-white">{label}</b>
      <strong className="font-mono">{formatIndex(data?.price)}</strong>
      <em className={`not-italic font-semibold ${validChange ? (up ? "text-emerald-300" : "text-rose-300") : "text-slate-500"}`}>
        {validChange ? `${up ? "▲" : "▼"}${Math.abs(change).toFixed(2)}%` : "—"}
      </em>
    </span>
  );
}

export default function MaintenanceScreen({
  onRetry,
  retrying = false,
  walkthroughUnavailable = false,
  notice,
}) {
  const marketOpen = isMarketOpenNow();
  const reduceMotion = useReducedMotion();
  const [liveMarket, setLiveMarket] = useState(null);
  const [niftyHistory, setNiftyHistory] = useState({
    points: [],
    source: null,
    loading: true,
    unavailable: false,
  });

  useEffect(() => {
    if (walkthroughUnavailable) {
      setLiveMarket(null);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      const [tickerResult, extrasResult] = await Promise.allSettled([fetchTickers(), fetchExtras()]);
      if (cancelled) return;
      setLiveMarket((previous) => ({
        tickers: tickerResult.status === "fulfilled"
          ? tickerResult.value?.tickers
          : previous?.tickers || null,
        extras: extrasResult.status === "fulfilled"
          ? extrasResult.value
          : previous?.extras || null,
      }));
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [walkthroughUnavailable]);

  useEffect(() => {
    if (walkthroughUnavailable) {
      setNiftyHistory({ points: [], source: null, loading: false, unavailable: false });
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/history/NIFTY", {
          params: { minutes: 60 },
          timeout: 12000,
        });
        if (cancelled) return;
        const pointsByTime = new Map();
        for (const snapshot of data?.history || []) {
          const price = Number(snapshot.price);
          const timestamp = String(snapshot.timestamp || "");
          if (timestamp && Number.isFinite(Date.parse(timestamp)) && Number.isFinite(price) && price > 0) {
            pointsByTime.set(timestamp, { timestamp, price });
          }
        }
        const points = [...pointsByTime.values()]
          .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
          .slice(-240);
        setNiftyHistory({
          points,
          source: data?.source || null,
          loading: false,
          unavailable: false,
        });
      } catch {
        if (cancelled) return;
        setNiftyHistory((previous) => ({
          ...previous,
          loading: false,
          unavailable: true,
        }));
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [walkthroughUnavailable]);

  const liveByName = new Map((liveMarket?.tickers || []).map((item) => [
    String(item.index || item.label).toUpperCase(),
    { price: Number(item.ltp), changePct: Number(item.change_pct) },
  ]));
  const niftyLivePrice = liveByName.get("NIFTY")?.price;

  // Extend stored snapshots only with the existing live ticker while the session is open.
  useEffect(() => {
    if (walkthroughUnavailable || !marketOpen || !Number.isFinite(niftyLivePrice) || niftyLivePrice <= 0) return;
    const timestamp = new Date().toISOString();
    setNiftyHistory((previous) => ({
      ...previous,
      points: [...previous.points, { timestamp, price: niftyLivePrice }].slice(-240),
      source: "live_window",
      unavailable: false,
    }));
  }, [marketOpen, niftyLivePrice, walkthroughUnavailable]);
  const displayedTick = ["NIFTY", "SENSEX", "BANKNIFTY"].map((label) => [
    label,
    liveByName.get(label) || { price: null, changePct: null },
  ]);
  const vix = liveMarket?.extras?.vix;
  const gift = liveMarket?.extras?.gift_nifty;
  const readExtra = (item) => ({
    price: item?.last ?? item?.ltp ?? item?.value ?? item?.last_price ?? item?.price,
    changePct: item?.change_pct ?? item?.changePct ?? item?.change_percent,
  });
  const headerTick = [
    ...displayedTick,
    ["VIX", readExtra(vix)],
    ["GIFT NIFTY", readExtra(gift)],
  ];
  const lastNiftyPoint = niftyHistory.points[niftyHistory.points.length - 1];
  const historyLabel = niftyHistory.source === "live_window"
    ? "LAST 60 MIN"
    : niftyHistory.source === "last_session"
      ? "LAST SESSION"
      : "";
  const historyStatus = niftyHistory.loading
    ? "Loading NIFTY history…"
    : niftyHistory.unavailable
      ? niftyHistory.points.length
        ? "Update failed · showing last available"
        : "NIFTY history unavailable"
      : niftyHistory.points.length < 2
        ? "Not enough history to draw a chart"
        : niftyHistory.source === "last_session"
          ? `Last session · ${new Date(lastNiftyPoint.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`
          : `Updated · ${new Date(lastNiftyPoint.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;

  return (
    <div className="maintenance-page relative flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#020b0e] px-4 py-3 text-white sm:px-8 sm:py-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_15%,rgba(16,185,129,.25),transparent_38%),radial-gradient(ellipse_at_82%_90%,rgba(14,116,144,.22),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(66,244,211,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(66,244,211,.16)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-2.5 sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          <OiPulseLogo className="h-10 w-10" pulse={false} />
          <div>
            <div className="text-lg font-bold tracking-tight sm:text-xl">Strik<span className="text-emerald-400">Lenz</span></div>
            <div className="text-[10px] uppercase tracking-[.22em] text-slate-400">Market intelligence desk</div>
          </div>
        </div>
        <div className="maintenance-status-pill rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-200">
          Under maintenance
        </div>
        {!walkthroughUnavailable ? (
          <div className="maintenance-status-pill flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            {marketOpen ? "Market live" : "Market closed"}
          </div>
        ) : null}
      </header>
      {!walkthroughUnavailable ? (
        <div className="maintenance-ticker relative z-10 mx-auto mt-2 w-full max-w-7xl overflow-hidden border-y border-white/10 py-2 font-mono text-[10px] text-slate-300">
          <div className="admin-login-ticker-track">
            {[0, 1, 2, 3].map((copy) => <div className="admin-login-ticker-copy" key={copy} aria-hidden={copy > 0}>
              {headerTick.map(([label, data]) => <Ticker label={label} data={data} key={label} />)}
            </div>)}
          </div>
        </div>
      ) : null}

      <main className="relative z-10 mx-auto grid w-full max-w-7xl min-h-0 flex-1 items-center gap-5 overflow-hidden py-5 lg:grid-cols-[.9fr_1.1fr] lg:py-3">
        <section className="maintenance-hero max-w-xl">
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.13em] text-amber-200 sm:mb-4 sm:text-[10px] sm:tracking-[.18em]">
            <Wrench className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> The market robot is on a coffee break
          </div>
          <h1 className="text-[2.65rem] font-black leading-[.95] tracking-[-.06em] sm:text-6xl">
            {walkthroughUnavailable ? (
              <>StrikLenz is<br /><span className="text-emerald-300">under maintenance.</span></>
            ) : (
              <>StrikLenz is<br /><span className="text-emerald-300">brewing</span> better trades.</>
            )}
          </h1>
          <p className="mt-3 max-w-lg text-[13px] leading-5 text-slate-300 sm:mt-4 sm:text-base sm:leading-6">
            {walkthroughUnavailable
              ? notice || "The public walkthrough is paused. Please check with the administrator for updates."
              : "We're tuning the desk behind the scenes. Please try again shortly."}
          </p>
          <div className="mt-4 flex flex-col gap-2.5 sm:mt-5 sm:flex-row sm:flex-wrap sm:gap-3">
            <button type="button" onClick={onRetry} disabled={retrying} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:opacity-60">
              <RefreshCw className={retrying ? "h-4 w-4 animate-spin motion-reduce:animate-none" : "h-4 w-4"} />
              {retrying ? "Checking desk…" : walkthroughUnavailable ? "Check for updates" : "Try the desk again"}
            </button>
            <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
              <Coffee className="h-4 w-4 text-amber-300" />
              {walkthroughUnavailable ? "The public preview will return when enabled." : "No action needed. Sip responsibly."}
            </div>
          </div>
        </section>

        <section className="maintenance-artwork relative mx-auto h-56 w-full max-w-2xl sm:h-72 lg:h-[min(27rem,100%)]" aria-label={walkthroughUnavailable ? "StrikLenz walkthrough maintenance notice" : "NIFTY chart and StrikLenz robot"}>
          {walkthroughUnavailable ? (
            <div className="maintenance-nifty-card relative left-auto top-auto flex min-h-40 w-full flex-col justify-center rounded-2xl border border-emerald-300/20 bg-transparent p-5 sm:min-h-48 sm:p-7">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-200">
                <Activity className="h-4 w-4" /> Public walkthrough
              </div>
              <p className="mt-3 text-xl font-bold text-white sm:text-2xl">Preview temporarily paused</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">
                The dashboard preview and its sample market data are unavailable while the site is under maintenance.
              </p>
            </div>
          ) : (
            <motion.div className="maintenance-nifty-card relative left-auto top-auto w-full rounded-2xl border border-emerald-300/20 bg-transparent p-3 sm:p-4" animate={reduceMotion ? undefined : { y: [0, -8, 0] }} transition={reduceMotion ? undefined : { duration: 5, repeat: Infinity, ease: "easeInOut" }}>
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-200">
                <span>NIFTY pulse{historyLabel ? ` · ${historyLabel}` : ""}</span>
                {lastNiftyPoint ? <strong className="font-mono text-white">{formatIndex(lastNiftyPoint.price)}</strong> : <Activity className="h-3.5 w-3.5 shrink-0" />}
              </div>
              <div className="mt-2 h-20 sm:mt-3 sm:h-28" aria-label={historyStatus}>
                {niftyHistory.points.length >= 2
                  ? <MiniChart points={niftyHistory.points} />
                  : <div className="flex h-full items-center justify-center px-2 text-center text-[9px] text-slate-400">{historyStatus}</div>}
              </div>
              <div className="mt-2 flex justify-between gap-2 font-mono text-[9px] text-slate-400">
                <span>{historyStatus}</span>
                <span className={marketOpen ? "text-emerald-300" : "text-slate-400"}>{marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span>
              </div>
            </motion.div>
          )}

          <motion.div className="absolute right-[0%] top-[13%] hidden w-[34%] rounded-2xl border border-white/10 bg-slate-950/80 p-4 shadow-xl backdrop-blur sm:block" animate={reduceMotion ? undefined : { y: [0, 9, 0] }} transition={reduceMotion ? undefined : { duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">System thoughts</div>
            <div className="mt-3 space-y-2 font-mono text-[10px]">
              {walkthroughUnavailable ? (
                <>
                  <div className="text-emerald-300">✓ market data access paused</div>
                  <div className="text-amber-300">… waiting for admin update</div>
                  <div className="text-sky-300">… preview will return when enabled</div>
                </>
              ) : (
                <>
                  <div className="text-emerald-300">✓ candles polished</div>
                  <div className="text-amber-300">… coffee acquired</div>
                  <div className="text-sky-300">… bias recalculating</div>
                </>
              )}
            </div>
          </motion.div>

          <motion.div className="maintenance-robot relative z-10" aria-label="StrikLenz robot" animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-1, 1, -1] }} transition={reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <div className="maintenance-robot-scale">
              <StrikLenzRobot variant="maintenance" />
            </div>
          </motion.div>
        </section>
      </main>
      <p className="maintenance-footer relative z-10 mx-auto max-w-7xl shrink-0 border-t border-white/10 py-2 text-center text-[9px] leading-4 text-slate-500 sm:text-[10px]">StrikLenz · Traders&apos; edge, always on · {APP_VERSION_LABEL}</p>
      <AuthFeatureFooter version={APP_VERSION_LABEL} compact />
    </div>
  );
}
