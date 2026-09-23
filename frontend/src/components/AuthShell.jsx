import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";
import StrikLenzRobot from "@/components/StrikLenzRobot";
import AuthFeatureFooter from "@/components/AuthFeatureFooter";
import { APP_NAME, APP_VERSION_LABEL, openAboutApp } from "@/lib/appVersion";
import { fetchExtras, fetchOI, fetchTickers } from "@/lib/api";

const tickerItems = [
  ["NIFTY 50", "23,427.95", "+0.42%", "up"],
  ["SENSEX", "74,864.65", "+0.45%", "up"],
  ["BANKNIFTY", "56,374.20", "+0.28%", "up"],
  ["FINNIFTY", "26,183.10", "+0.31%", "up"],
  ["INDIAVIX", "18.35", "-5.91%", "down"],
  ["GIFT NIFTY", "23,433.80", "+0.46%", "up"],
];

function MarketScreen({ title, rows = false, chart = false, tickerRows = tickerItems, bars = null, price = null }) {
  return (
    <div className="oi-auth-screen">
      <div className="oi-auth-screen-title">{title}</div>
      {chart ? (
        <svg className="oi-auth-candle-chart" viewBox="0 0 260 120" aria-hidden>
          <path d={`M0 95 C42 88 58 70 89 78 S135 64 165 48 S211 48 260 ${Number.isFinite(price) ? 18 + Math.max(-5, Math.min(12, (price % 20) / 2)) : 18}`} fill="none" stroke="#1bd7ae" strokeWidth="2" opacity=".7" />
          {[28, 44, 61, 75, 91, 112, 132, 153, 173, 194, 215, 232].map((x, index) => {
            const top = [68, 53, 60, 42, 48, 34, 47, 27, 38, 21, 29, 14][index];
            const height = [16, 22, 14, 25, 18, 26, 19, 30, 20, 28, 17, 25][index];
            const up = index % 4 !== 1;
            return <g key={x}><path d={`M${x} ${top - 7}V${top + height + 7}`} stroke={up ? "#35e0ac" : "#fb7185"} strokeWidth="1" /><rect x={x - 3} y={top} width="6" height={height} rx="1" fill={up ? "#13b889" : "#e05c6d"} /></g>;
          })}
          <circle cx="232" cy="14" r="3" fill="#73ffe0" />
        </svg>
      ) : rows ? (
        tickerRows.slice(0, 5).map(([name, value, change, tone]) => (
          <div className="oi-auth-screen-row" key={name}>
            <span>{name}</span><b>{value}</b><em className={tone}>{change}</em>
          </div>
        ))
      ) : (
        <div className="oi-auth-bars">
          {(bars || [22, 31, 28, 44, 38, 53, 47, 68, 61, 78]).map((height, index) => (
            <i key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shared entry atmosphere for admin and guest access.
 * The scene is deliberately CSS-built so it stays crisp, lightweight, and responsive.
 */
export default function AuthShell({ mode = "admin", children }) {
  const isGuest = mode === "guest";
  const [liveTickers, setLiveTickers] = useState(null);
  const [extras, setExtras] = useState(null);
  const [liveOi, setLiveOi] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [tickerResult, extraResult, oiResult] = await Promise.allSettled([
          fetchTickers(),
          fetchExtras(),
          fetchOI("NIFTY"),
        ]);
        const payload = tickerResult.status === "fulfilled" ? tickerResult.value : null;
        const extraPayload = extraResult.status === "fulfilled" ? extraResult.value : null;
        const oiPayload = oiResult.status === "fulfilled" ? oiResult.value : null;
        if (!cancelled && Array.isArray(payload?.tickers) && payload.tickers.length) {
          setLiveTickers(payload.tickers);
        }
        if (!cancelled) {
          setExtras(extraPayload || null);
          setLiveOi(oiPayload?.current || null);
        }
      } catch (_) {
        // Keep the decorative fallback while the desk feed is unavailable.
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const displayTickers = useMemo(() => {
    const indexRows = Array.isArray(liveTickers) && liveTickers.length ? liveTickers.map((ticker) => {
      const change = Number(ticker.change_pct);
      const value = Number(ticker.ltp);
      return [
        ticker.label || ticker.index,
        Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—",
        Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—",
        Number.isFinite(change) && change >= 0 ? "up" : "down",
      ];
    }) : tickerItems.filter(([name]) => !["INDIAVIX", "GIFT NIFTY"].includes(name));
    const extraRows = [
      extras?.vix ? ["INDIAVIX", extras.vix.last ?? extras.vix.ltp, extras.vix.change_pct, Number(extras.vix.change_pct) >= 0 ? "up" : "down"] : null,
      extras?.gift_nifty ? ["GIFT NIFTY", extras.gift_nifty.last, extras.gift_nifty.change_pct, Number(extras.gift_nifty.change_pct) >= 0 ? "up" : "down"] : null,
    ].filter(Boolean).map(([name, value, change, tone]) => [
      name,
      Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—",
      Number.isFinite(Number(change)) ? `${Number(change) >= 0 ? "+" : ""}${Number(change).toFixed(2)}%` : "—",
      tone,
    ]);
    return [...extraRows, ...indexRows];
  }, [liveTickers, extras]);

  const pulseBars = useMemo(() => {
    const strikes = Array.isArray(liveOi?.strikes) ? liveOi.strikes : [];
    if (!strikes.length) return null;
    const totals = strikes.map((row) => Number(row.ce_oi || 0) + Number(row.pe_oi || 0)).filter(Number.isFinite);
    const max = Math.max(...totals, 1);
    return totals.slice(0, 10).map((value) => Math.max(16, Math.round((value / max) * 86)));
  }, [liveOi]);

  return (
    <div
      data-testid={isGuest ? "guest-auth-shell" : "admin-auth-shell"}
      className="oi-auth-shell relative min-h-screen overflow-hidden bg-[#020b0e] text-white"
      style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
    >
      <div className="oi-auth-ambient" aria-hidden />

      <div className="oi-auth-ticker" aria-label="Market snapshot">
        {displayTickers.map(([name, value, change, tone]) => (
          <span className="oi-auth-ticker-item" key={name}>
            <b>{name}</b><strong>{value}</strong><em className={tone}>{tone === "up" ? "▲" : "▼"} {change}</em>
          </span>
        ))}
        <span className="oi-auth-live"><i /> LIVE</span>
      </div>

      <main className="oi-auth-main">
        <section className="oi-auth-hero" aria-label="StrikLenz trading desk">
          <motion.button
            type="button"
            onClick={openAboutApp}
            className="oi-auth-brand"
            data-testid="brand-about-trigger"
            title={`About ${APP_NAME} ${APP_VERSION_LABEL}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <OiPulseLogo className="h-11 w-11 shrink-0" />
            <span><b>{APP_NAME}</b><small>Command the desk. Spot bias. Act on OI.</small></span>
          </motion.button>

          <div className="oi-auth-slogan oi-auth-slogan-left">
            Good Trades<br />Come From<br /><strong>Discipline,<br />Not Emotion.</strong>
            <small>PLAN · ANALYZE · EXECUTE · IMPROVE</small>
          </div>
          <div className="oi-auth-slogan oi-auth-slogan-right">TRADERS&apos; EDGE,<br />ALWAYS ON.</div>

          <div className="oi-auth-city" aria-hidden>
            <span className="oi-auth-tower tower-one" /><span className="oi-auth-tower tower-two" /><span className="oi-auth-tower tower-three" />
            <span className="oi-auth-window-light light-one" /><span className="oi-auth-window-light light-two" /><span className="oi-auth-window-light light-three" />
          </div>

          <div className="oi-auth-monitor monitor-back"><MarketScreen title="NIFTY 50 · LIVE CHART" chart price={Number(liveOi?.price)} /></div>
          <div className="oi-auth-monitor monitor-center"><MarketScreen title="DESK PULSE · LIVE" rows tickerRows={displayTickers} /></div>
          <div className="oi-auth-monitor monitor-front"><MarketScreen title="LIVE OI PULSE" bars={pulseBars} /></div>

          <motion.div
            className="oi-auth-robot-wrap"
            animate={{ y: [0, -8, 0], rotate: [-1, 1, -1] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <StrikLenzRobot />
          </motion.div>

          <div className="oi-auth-laptop"><div className="oi-auth-laptop-logo"><Activity /></div></div>
          <div className="oi-auth-pnl"><small>DESK P&amp;L</small><b>₹12.84L</b><em>+₹18,420 LIVE</em></div>
          <div className="oi-auth-desk" />
        </section>

        <motion.section
          className="oi-auth-form-slot"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.12 }}
        >
          {children}
        </motion.section>
      </main>

      <AuthFeatureFooter />
    </div>
  );
}
