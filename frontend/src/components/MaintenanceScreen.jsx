import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Coffee, RefreshCw, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import OiPulseLogo from "@/components/OiPulseLogo";
import StrikLenzRobot from "@/components/StrikLenzRobot";
import AuthFeatureFooter from "@/components/AuthFeatureFooter";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import { fetchExtras, fetchTickers } from "@/lib/api";
import useLiveDemo, { isMarketOpenNow } from "@/hooks/useLiveDemo";
import "@/styles/landing.css";

function formatIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  }) : "—";
}

function MiniChart({ values }) {
  const points = useMemo(() => {
    const source = values.length ? values : [36, 42, 34, 50, 45, 64, 57, 78];
    const max = Math.max(...source, 1);
    const min = Math.min(...source);
    const range = Math.max(max - min, 1);
    return source.map((value, index) => {
      const x = (index / Math.max(source.length - 1, 1)) * 250;
      const y = 78 - ((value - min) / range) * 58;
      return `${x},${y}`;
    }).join(" ");
  }, [values]);

  return (
    <svg viewBox="0 0 250 90" className="h-full w-full" aria-hidden>
      <path d="M0 78H250M0 49H250M0 20H250" stroke="rgba(148, 210, 200, .14)" />
      <polyline points={points} fill="none" stroke="#32e6b0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,78 ${points} 250,78`} fill="url(#maintenance-fill)" opacity=".25" />
      <defs>
        <linearGradient id="maintenance-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#32e6b0" />
          <stop offset="1" stopColor="#32e6b0" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Ticker({ label, data }) {
  const change = Number(data?.changePct);
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

export default function MaintenanceScreen({ onRetry, retrying = false }) {
  const marketOpen = isMarketOpenNow();
  const snap = useLiveDemo(1200, marketOpen);
  const [liveMarket, setLiveMarket] = useState(null);
  const oiBars = snap.chain.rows.map((row) => Number(row.ce_oi || 0) + Number(row.pe_oi || 0));

  useEffect(() => {
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
  }, []);

  const liveByName = new Map((liveMarket?.tickers || []).map((item) => [
    String(item.index || item.label).toUpperCase(),
    { price: Number(item.ltp), changePct: Number(item.change_pct) },
  ]));
  const displayedTick = ["NIFTY", "SENSEX", "BANKNIFTY"].map((label) => [
    label,
    liveByName.get(label) || snap.indices[label],
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

  return (
    <div className="maintenance-page relative flex h-[100dvh] flex-col overflow-hidden bg-[#020b0e] px-4 py-3 text-white sm:px-8 sm:py-4">
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
        <div className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-200">
          Under maintenance
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          {marketOpen ? "Market live" : "Market closed"}
        </div>
      </header>
      <div className="maintenance-ticker relative z-10 mx-auto mt-2 w-full max-w-7xl overflow-hidden border-y border-white/10 py-2 font-mono text-[10px] text-slate-300">
        <div className="admin-login-ticker-track">
          {[0, 1, 2, 3].map((copy) => <div className="admin-login-ticker-copy" key={copy} aria-hidden={copy > 0}>
            {headerTick.map(([label, data]) => <Ticker label={label} data={data} key={label} />)}
          </div>)}
        </div>
      </div>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-none items-start gap-5 overflow-visible py-5 lg:flex-1 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:overflow-hidden lg:py-3">
        <section className="max-w-xl">
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.13em] text-amber-200 sm:mb-4 sm:text-[10px] sm:tracking-[.18em]">
            <Wrench className="h-3.5 w-3.5 animate-spin" /> The market robot is on a coffee break
          </div>
          <h1 className="text-[2.65rem] font-black leading-[.95] tracking-[-.06em] sm:text-6xl">
            StrikLenz is<br /><span className="text-emerald-300">brewing</span> better trades.
          </h1>
          <p className="mt-3 max-w-lg text-[13px] leading-5 text-slate-300 sm:mt-4 sm:text-base sm:leading-6">
            Something unexpected happened behind the scenes. Our robot is blaming the OI candles, the coffee machine is blaming the robot, and we&apos;re fixing both.
          </p>
          <div className="mt-4 flex flex-col gap-2.5 sm:mt-5 sm:flex-row sm:flex-wrap sm:gap-3">
            <button type="button" onClick={onRetry} disabled={retrying} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:opacity-60">
              <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {retrying ? "Checking desk…" : "Try the desk again"}
            </button>
            <Link to="/admin" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-300/10">
              Admin sign in
            </Link>
            <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
              <Coffee className="h-4 w-4 text-amber-300" /> No action needed. Sip responsibly.
            </div>
          </div>
        </section>

        <section className="relative mx-auto h-56 w-full max-w-2xl sm:h-72 lg:h-[min(27rem,100%)]">
          <motion.div className="absolute left-[2%] top-[5%] w-[58%] rounded-2xl border border-emerald-300/20 bg-[#06191b]/90 p-3 shadow-2xl shadow-emerald-950/50 backdrop-blur sm:left-[5%] sm:top-[8%] sm:w-[48%] sm:p-4" animate={{ y: [0, -8, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-emerald-200"><span>NIFTY pulse</span><Activity className="h-3.5 w-3.5" /></div>
            <div className="mt-2 h-20 sm:mt-3 sm:h-28"><MiniChart values={oiBars} /></div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-400"><span>OI feed: {marketOpen ? "humming" : "paused"}</span><span className={marketOpen ? "text-emerald-300" : "text-slate-400"}>{marketOpen ? "MARKET LIVE" : "MARKET CLOSED"}</span></div>
          </motion.div>

          <motion.div className="absolute right-[0%] top-[13%] hidden w-[34%] rounded-2xl border border-white/10 bg-slate-950/80 p-4 shadow-xl backdrop-blur sm:block" animate={{ y: [0, 9, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">System thoughts</div>
            <div className="mt-3 space-y-2 font-mono text-[10px]">
              <div className="text-emerald-300">✓ candles polished</div>
              <div className="text-amber-300">… coffee acquired</div>
              <div className="text-sky-300">… bias recalculating</div>
            </div>
          </motion.div>

          <div className="absolute inset-x-[8%] bottom-[5%] h-8 rounded-[50%] bg-emerald-400/20 blur-2xl" />
          <motion.div className="absolute bottom-[3%] left-[31%] z-10 scale-[.65] origin-bottom sm:bottom-[10%] sm:left-[25%] sm:scale-100" animate={{ y: [0, -10, 0], rotate: [-1, 1, -1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <StrikLenzRobot variant="maintenance" />
          </motion.div>
          <div className="absolute bottom-[3%] left-[8%] h-6 w-[84%] skew-x-[-12deg] rounded-xl border border-white/15 bg-gradient-to-b from-slate-700 to-slate-950 shadow-2xl sm:bottom-[9%] sm:h-8" />
          <div className="absolute bottom-0 right-[4%] rounded-lg border border-amber-200/25 bg-amber-100/10 px-2 py-1.5 text-center font-mono text-[8px] text-amber-100/90 shadow-lg rotate-3 sm:bottom-[2%] sm:px-3 sm:py-2 sm:text-[10px]">
            COFFEE BREAK<br /><span className="text-amber-300">= BETTER INSIGHTS ☕</span>
          </div>
        </section>
      </main>
      <p className="relative z-10 mx-auto max-w-7xl shrink-0 border-t border-white/10 py-2 text-center text-[9px] leading-4 text-slate-500 sm:text-[10px]">StrikLenz • Traders&apos; edge, always on • Our admin has been politely asked to stop drinking coffee and fix things.</p>
      <AuthFeatureFooter version={APP_VERSION_LABEL} />
    </div>
  );
}
