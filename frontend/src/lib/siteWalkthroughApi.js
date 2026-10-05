import {
  isHoliday,
  isSpecialSessionIST,
  isTradingDayIST,
  previousTradingDayIST,
  specialSessionCatchupMinute,
  specialSessionOpenMinute,
  todayIST,
} from "./holidays";

const WALKTHROUGH_PATH = "/sitewalkthrough";
const transientWrites = new Map();
const MARKET_OPEN_MINUTE = 9 * 60 + 15;
const MARKET_CLOSE_MINUTE = 15 * 60 + 30;
const DEMO_ALERT_INTERVAL_MS = 90 * 1000;
// Deterministic clock-based values keep every demo surface coherent without touching live feeds or storage.
const INDEX_MARKETS = {
  NIFTY: { open: 24342.8, previousClose: 24320.2, step: 50, volatility: 44, phase: 0.2 },
  SENSEX: { open: 80044.4, previousClose: 80010.1, step: 100, volatility: 116, phase: 1.7 },
  BANKNIFTY: { open: 51788.6, previousClose: 51740.3, step: 100, volatility: 132, phase: 3.1 },
};

function istMinutes(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value || 0);
}

function istWeekday(now) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(now);
}

function dateAtIstMinute(isoDate, minute) {
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  const mins = String(minute % 60).padStart(2, "0");
  return new Date(`${isoDate}T${hour}:${mins}:00+05:30`);
}

function minuteToIstTime(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function nextExpiryDate(index, sessionDate) {
  const expiryWeekday = { NIFTY: 2, SENSEX: 4, BANKNIFTY: 2 }[index] ?? 2;
  const [year, month, day] = sessionDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilExpiry = (expiryWeekday - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilExpiry);
  let iso = candidate.toISOString().slice(0, 10);
  while (!isTradingDayIST(iso)) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
    iso = candidate.toISOString().slice(0, 10);
  }
  return iso;
}

function optionTradingsymbol(index, expiry, strike, option) {
  const expiryDate = new Date(`${expiry}T00:00:00.000Z`);
  const month = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ][expiryDate.getUTCMonth()];
  const expiryCode = `${String(expiryDate.getUTCFullYear()).slice(-2)}${month}`;
  return `${index}${expiryCode}${strike}${option}`;
}

function marketSession(now) {
  const today = todayIST();
  const todayIsTradingDay = isTradingDayIST(today);
  const specialToday = isSpecialSessionIST(today);
  const openMinute = specialToday ? specialSessionOpenMinute(today) : MARKET_OPEN_MINUTE;
  const closeMinute = specialToday
    ? specialSessionCatchupMinute(today) - 5
    : MARKET_CLOSE_MINUTE;
  const minute = istMinutes(now);
  const isOpen = todayIsTradingDay && minute >= openMinute && minute < closeMinute;
  const sessionDate = todayIsTradingDay && minute >= openMinute
    ? today
    : previousTradingDayIST(today);
  const specialSession = isSpecialSessionIST(sessionDate);
  const sessionOpenMinute = specialSession
    ? specialSessionOpenMinute(sessionDate)
    : MARKET_OPEN_MINUTE;
  const sessionCloseMinute = specialSession
    ? specialSessionCatchupMinute(sessionDate) - 5
    : MARKET_CLOSE_MINUTE;
  const sessionOpen = dateAtIstMinute(sessionDate, sessionOpenMinute);
  const sessionClose = dateAtIstMinute(sessionDate, sessionCloseMinute);
  const sampleAt = isOpen ? now : sessionClose;
  const weekday = istWeekday(now);
  const phase = isOpen
    ? "live"
    : (!todayIsTradingDay && (weekday === "Sat" || weekday === "Sun")
      ? "weekend"
      : (!todayIsTradingDay && isHoliday(today)
        ? "holiday"
        : (todayIsTradingDay && minute < openMinute
          ? (!specialToday && minute >= 9 * 60 ? "pre_market" : "pre_open")
          : "post_close")));

  return {
    isOpen,
    phase,
    sessionDate,
    sessionOpen,
    sessionClose,
    sampleAt,
    openMinute: sessionOpenMinute,
    closeMinute: sessionCloseMinute,
    todayOpenMinute: openMinute,
    todayCloseMinute: closeMinute,
  };
}

function indexQuote(index, at, session) {
  const market = INDEX_MARKETS[index] || INDEX_MARKETS.NIFTY;
  const clampedAt = new Date(Math.max(
    session.sessionOpen.getTime(),
    Math.min(at.getTime(), session.sessionClose.getTime()),
  ));
  const elapsedSeconds = Math.max(0, (clampedAt.getTime() - session.sessionOpen.getTime()) / 1000);
  const wave = Math.sin(elapsedSeconds / 105 + market.phase) * 0.55
    + Math.sin(elapsedSeconds / 367 + market.phase * 1.3) * 0.32
    + Math.sin(elapsedSeconds / 1500 + market.phase * 0.7) * 0.13;
  const drift = Math.sin(elapsedSeconds / 1700 + market.phase) * market.volatility * 0.22;
  const price = Number((market.open + wave * market.volatility + drift).toFixed(2));
  return {
    ...market,
    price,
    vix: Number((14.2 + Math.sin(elapsedSeconds / 211 + 0.6) * 0.72).toFixed(2)),
    at: clampedAt,
    elapsedSeconds,
  };
}

export function isSiteWalkthroughPath() {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname.replace(/\/+$/, "");
  try {
    // React Router matches paths case-insensitively; keep isolation aligned with that route behavior.
    return decodeURIComponent(pathname).toLowerCase() === WALKTHROUGH_PATH;
  } catch {
    return pathname.toLowerCase() === WALKTHROUGH_PATH;
  }
}

function makeSnapshot(index, at, session) {
  const quote = indexQuote(index, at, session);
  const { price, step, previousClose, open: dayOpen, elapsedSeconds } = quote;
  const atm = Math.round(price / step) * step;
  const minutesIntoSession = elapsedSeconds / 60;
  const oiWave = Math.sin(elapsedSeconds / 83 + quote.phase) * 0.012
    + Math.sin(elapsedSeconds / 257 + quote.phase * 0.8) * 0.008;
  const strikes = Array.from({ length: 17 }, (_, i) => {
    const strike = atm + (i - 8) * step;
    const signedDistance = i - 8;
    const distance = Math.abs(signedDistance);
    const ceBase = (2.1 + Math.max(0, 6 - distance) * 0.7) * 1000000;
    const peBase = (2.4 + Math.max(0, 7 - distance) * 0.62) * 1000000;
    const ceOi = Math.round(ceBase * (1 + oiWave + (signedDistance > 0 ? 0.003 : -0.002) * minutesIntoSession / 60));
    const peOi = Math.round(peBase * (1 - oiWave + (signedDistance < 0 ? 0.003 : -0.002) * minutesIntoSession / 60));
    const underlyingMove = price - dayOpen;
    const optionWave = Math.sin(elapsedSeconds / 29 + quote.phase + i * 0.17) * 4;
    return {
      strike,
      ce_oi: ceOi,
      pe_oi: peOi,
      ce_ltp: Number(Math.max(2, 188 - Math.max(0, signedDistance) * 17 + Math.max(0, -signedDistance) * 4 + underlyingMove * 0.38 + optionWave).toFixed(2)),
      pe_ltp: Number(Math.max(2, 176 - Math.max(0, -signedDistance) * 16 + Math.max(0, signedDistance) * 4 - underlyingMove * 0.38 - optionWave * 0.8).toFixed(2)),
      ce_volume: 18000 + (16 - i) * 1200 + Math.floor(elapsedSeconds / 5) * (17 - i) * 3,
      pe_volume: 17000 + i * 1150 + Math.floor(elapsedSeconds / 5) * (i + 1) * 3,
    };
  });
  const ceOi = strikes.reduce((sum, item) => sum + item.ce_oi, 0);
  const peOi = strikes.reduce((sum, item) => sum + item.pe_oi, 0);
  return {
    index,
    timestamp: quote.at.toISOString(),
    price,
    prev_close: previousClose,
    day_open: dayOpen,
    atm,
    expiry: nextExpiryDate(index, session.sessionDate),
    expiries: [nextExpiryDate(index, session.sessionDate)],
    pcr: Number((peOi / ceOi).toFixed(2)),
    vix: quote.vix,
    strikes,
  };
}

function snapshotPair(index, session, minutes = 15) {
  const current = makeSnapshot(index, session.sampleAt, session);
  const previousAt = new Date(Math.max(
    session.sessionOpen.getTime(),
    session.sampleAt.getTime() - Math.max(1, Number(minutes) || 15) * 60000,
  ));
  const previous = makeSnapshot(index, previousAt, session);
  return { current, previous };
}

function sampleAlerts(session) {
  const elapsed = Math.max(0, session.sampleAt.getTime() - session.sessionOpen.getTime());
  const latestSlot = Math.floor(elapsed / DEMO_ALERT_INTERVAL_MS);
  const daySeed = [...session.sessionDate].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  // Stable 90-second slots let the real alert poll surface new demo events without firing on every refresh.
  return Array.from({ length: Math.min(4, latestSlot + 1) }, (_, offset) => {
    const slot = latestSlot - offset;
    const seed = (Math.imul(slot + daySeed, 48271) >>> 0);
    const index = ["NIFTY", "SENSEX", "BANKNIFTY"][seed % 3];
    const eventAt = new Date(session.sessionOpen.getTime() + slot * DEMO_ALERT_INTERVAL_MS);
    const { current } = snapshotPair(index, { ...session, sampleAt: eventAt }, 15);
    const direction = ["Bullish OI reversal", "Put writing", "Call unwinding", "Call writing"][seed % 4];
    return {
      created_at: current.timestamp,
      index,
      direction,
      severity: seed % 2 ? "warning" : "info",
      price: current.price,
      atm: current.atm,
      strikes: current.strikes.slice(7, 10).map((strike) => strike.strike),
      sample: true,
    };
  }).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function sessionHistory(index, session, intervalMinutes = 5) {
  const points = [];
  for (let at = session.sessionOpen.getTime(); at <= session.sampleAt.getTime(); at += intervalMinutes * 60000) {
    points.push(makeSnapshot(index, new Date(at), session));
  }
  if (!points.length || points[points.length - 1].timestamp !== session.sampleAt.toISOString()) {
    points.push(makeSnapshot(index, session.sampleAt, session));
  }
  return points;
}

function demoConfig() {
  const visiblePages = [
    "oi-change", "open-interest", "strike-table", "sell-candidates", "buildup",
    "positions", "alerts", "activity", "holidays", "straddle", "index-events",
    "market-intel", "adrs",
  ];
  return {
    indices: {
      NIFTY: { label: "NIFTY 50", step: 50 },
      SENSEX: { label: "SENSEX", step: 100 },
      BANKNIFTY: { label: "BANKNIFTY", step: 100 },
    },
    enabled_indices: ["NIFTY", "SENSEX", "BANKNIFTY"],
    visible_pages: visiblePages,
    admin_visible_pages: [],
    alert_enabled_indices: ["NIFTY", "SENSEX"],
    straddle_enabled_indices: ["NIFTY", "SENSEX", "BANKNIFTY"],
    mcx_desk_on: false,
    global_markets_enabled: true,
    show_market_memory: true,
    show_writer_defense: true,
    show_suggestion: true,
    show_chart_signals: true,
    desk_ai_show: true,
    market_open_ist: "09:15",
    market_close_ist: "15:30",
    display_open_ist: "09:15",
    display_close_ist: "15:30",
    oi_poll_interval_seconds: 15,
    straddle_poll_interval_seconds: 5,
    positions_poll_interval_seconds: 5,
    market_intel_ingest_seconds: 60,
  };
}

function fixture(path, now, config, params = {}) {
  if (path === "/config") return config;
  const session = marketSession(now);
  if (path === "/status") {
    return {
      mode: "kite",
      kite_ok: true,
      has_kite_credentials: false,
      market: {
        is_market_open: session.isOpen,
        is_oi_polling: session.isOpen,
        is_pre_market: session.phase === "pre_market",
        phase: session.phase,
        session_anchor_date: session.sessionDate,
        market_open_ist: minuteToIstTime(session.todayOpenMinute),
        market_close_ist: minuteToIstTime(session.todayCloseMinute),
        display_open_ist: minuteToIstTime(session.todayOpenMinute),
        display_close_ist: minuteToIstTime(session.todayCloseMinute),
      },
      vix: indexQuote("NIFTY", session.sampleAt, session).vix,
      data_status: {
        data_date: session.sessionDate,
        cache_age_seconds: 0,
        stale_after_seconds: 90,
        is_live: session.isOpen,
      },
    };
  }
  if (path === "/global-markets/status") return { enabled: true };
  if (path === "/tickers") {
    return {
      tickers: Object.entries(INDEX_MARKETS).map(([index, market]) => {
        const quote = indexQuote(index, session.sampleAt, session);
        const change = Number((quote.price - market.previousClose).toFixed(2));
        return {
          index,
          ltp: quote.price,
          prev_close: market.previousClose,
          day_open: market.open,
          change,
          change_pct: Number((change / market.previousClose * 100).toFixed(2)),
          timestamp: quote.at.toISOString(),
        };
      }),
    };
  }
  if (path === "/tickers/extras") {
    const quoteTime = session.sampleAt.toISOString();
    const nifty = indexQuote("NIFTY", session.sampleAt, session);
    return {
      vix: {
        symbol: "NSE:INDIA VIX",
        last: nifty.vix,
        prev_close: 14.16,
        change: 0.12,
        change_pct: 0.847,
        ts: quoteTime,
        source: "demo",
      },
      gift_nifty: {
        symbol: "NSEIX:GIFT NIFTY",
        label: "GIFT NIFTY",
        last: Number((nifty.price + 31.7).toFixed(2)),
        prev_close: 24321.1,
        change: Number((nifty.price + 31.7 - 24321.1).toFixed(2)),
        change_pct: Number(((nifty.price + 31.7 - 24321.1) / 24321.1 * 100).toFixed(3)),
        ts: quoteTime,
        source: "demo",
      },
      windows: {
        vix: {
          start_ist: minuteToIstTime(session.todayOpenMinute),
          end_ist: minuteToIstTime(session.todayCloseMinute),
          display: `${minuteToIstTime(session.todayOpenMinute)}–${minuteToIstTime(session.todayCloseMinute)}`,
          open_now: session.isOpen,
        },
        gift: {
          start_ist: "06:30",
          end_ist: "02:45",
          display: "06:30–15:40 & 16:35–02:45",
          sessions: [{ start_ist: "06:30", end_ist: "15:40" }, { start_ist: "16:35", end_ist: "02:45" }],
          open_now: session.isOpen,
          kite_symbol: "NSEIX:GIFT NIFTY",
        },
      },
      server_time_ist: quoteTime,
    };
  }
  if (path === "/alerts") {
    return { alerts: sampleAlerts(session) };
  }
  if (path === "/desk-ai") {
    return {
      desk_ai_show: true,
      desk_ai_positions: false,
      desk_ai_radar: false,
      ...(transientWrites.get(path)?.[0] || {}),
    };
  }
  if (path === "/desk-outside") {
    const quoteTime = session.sampleAt.toISOString();
    return {
      quote_source: "walkthrough sample",
      updated_at: quoteTime,
      heavy_count: 4,
      note: "Illustrative cash-market tape for the public walkthrough.",
      briefing: "Sample cash breadth is positive, led by Reliance and HDFC Bank; this is not a live market feed.",
      movers: [
        { index: "NIFTY", symbol: "RELIANCE", pct: 0.82, weightage: 8.7, price: 1482.6, timestamp: quoteTime },
        { index: "NIFTY", symbol: "HDFCBANK", pct: 0.54, weightage: 12.4, price: 1768.3, timestamp: quoteTime },
        { index: "NIFTY", symbol: "INFY", pct: -0.36, weightage: 5.8, price: 1537.9, timestamp: quoteTime },
        { index: "BANKNIFTY", symbol: "ICICIBANK", pct: 0.67, weightage: 8.1, price: 1296.4, timestamp: quoteTime },
      ],
      breadth: {
        NIFTY: { n: 50, adv: 31, dec: 19, above_vwap: 28 },
        BANKNIFTY: { n: 12, adv: 8, dec: 4, above_vwap: 7 },
      },
      news: [
        { title: "Illustrative: private-bank shares support the sample index tape", source: "Walkthrough market wire", published: quoteTime },
        { title: "Illustrative: IT stocks mixed as the sample session develops", source: "Walkthrough market wire", published: quoteTime },
      ],
      corporate: [
        { symbol: "RELIANCE", event_type: "sample results watch", days: 3, weightage: 8.7 },
        { symbol: "INFY", event_type: "sample board meeting", days: 5, weightage: 5.8 },
      ],
    };
  }
  if (path === "/desk-guide") {
    const current = snapshotPair("NIFTY", session).current;
    return {
      source: "rules",
      sample: true,
      guide: [
        `Sample read: NIFTY is ${current.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })} with PCR ${current.pcr}; cash breadth and option positioning are illustrative, not live evidence.`,
        "DO",
        "Wait for price to hold near the sample ATM before considering a defined-risk setup.",
        "Compare the next OI update with the sample heavyweight breadth; treat both as fictional.",
        "BASE CASE",
        "If NIFTY holds above the sample ATM and breadth stays positive, the tape remains cautiously constructive.",
        "CONTRARY CASE",
        "A failed hold near ATM with weakening bank breadth would make the sample bullish read less useful.",
        "WATCH NEXT",
        "Watch the next OI pull, ATM response, and whether HDFCBANK remains above VWAP.",
        "REASSESS IF",
        "Reassess if the sample spot crosses ATM while the OI and breadth signals diverge.",
        "DON'T",
        "Do not treat this walkthrough output as live advice, a forecast, or an order instruction.",
      ].join("\n"),
      evidence_quality: {
        sources: [
          { name: "Session OI", status: session.isOpen ? "fresh sample" : "last-session sample", timestamp: current.timestamp },
          { name: "India VIX", status: "sample", timestamp: current.timestamp },
          { name: "Outside tape", status: "fictional sample", timestamp: current.timestamp },
        ],
      },
    };
  }
  if (path === "/positions") {
    const positions = [
      { index: "NIFTY", strike: 24300, option: "CE", exchange: "NFO", product: "MIS", quantity: 50, average_price: 142.5, instrument_token: 1 },
      { index: "NIFTY", strike: 24400, option: "PE", exchange: "NFO", product: "MIS", quantity: -50, average_price: 176.4, instrument_token: 2 },
      { index: "BANKNIFTY", strike: 51800, option: "CE", exchange: "NFO", product: "NRML", quantity: 30, average_price: 312.1, instrument_token: 3 },
    ].map((position) => {
      const { current } = snapshotPair(position.index, session, 15);
      const option = current.strikes.find((strike) => strike.strike === position.strike);
      const lastPrice = option ? option[`${position.option.toLowerCase()}_ltp`] : position.average_price;
      const expiry = nextExpiryDate(position.index, session.sessionDate);
      return {
        ...position,
        tradingsymbol: optionTradingsymbol(position.index, expiry, position.strike, position.option),
        last_price: lastPrice,
        pnl: Number((position.quantity * (lastPrice - position.average_price)).toFixed(2)),
        day_buy_quantity: position.quantity > 0 ? position.quantity : 0,
        day_sell_quantity: position.quantity < 0 ? Math.abs(position.quantity) : 0,
      };
    });
    return {
      mode: "demo",
      positions,
      funds: { available: 524850, used: 186400 },
      pnl_today: { total: Number(positions.reduce((total, position) => total + position.pnl, 0).toFixed(2)) },
      kite_connected: true,
      connect_required: false,
    };
  }
  if (path === "/positions/brokerage-day") {
    return {
      ok: true,
      brokerage: 40,
      charges_total: 286.4,
      order_count: 3,
      trade_count: 2,
      source: "demo",
    };
  }
  if (path === "/market/fii-dii") {
    const date = now.toISOString().slice(0, 10);
    return {
      ok: true,
      expected_as_of: date,
      stale: false,
      last_error: null,
      pull_ist: "19:31",
      data: {
        as_of_date: date,
        as_of_date_display: date,
        fii: { buy: 12874.2, sell: 13620.7, net: -746.5 },
        dii: { buy: 10482.6, sell: 9728.1, net: 754.5 },
      },
    };
  }
  if (path === "/holidays") {
    return {
      source: "demo",
      holidays: [
        { date: now.toISOString().slice(0, 10), name: "Demo market session", type: "sample" },
        { date: new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10), name: "Illustrative exchange holiday", type: "sample" },
      ],
    };
  }
  if (path === "/history/NIFTY" || path === "/history/SENSEX" || path === "/history/BANKNIFTY") {
    const index = path.split("/").pop();
    const history = sessionHistory(index, session);
    return { index, history, snapshots: history };
  }
  const change = path.match(/^\/oi\/([^/]+)\/change$/);
  if (change) {
    const index = change[1].toUpperCase();
    const minutes = Number(params.minutes) || 15;
    const { current, previous } = snapshotPair(index, session, minutes);
    const windowPrevious = (windowMinutes) => snapshotPair(index, session, windowMinutes).previous;
    return {
      index,
      current,
      previous,
      minutes,
      history_ready: true,
      available_history_minutes: 240,
      also_windows: {
        "1": { previous: windowPrevious(1), minutes: 1, history_ready: true, available_history_minutes: 240 },
        "3": { previous: windowPrevious(3), minutes: 3, history_ready: true, available_history_minutes: 240 },
        "5": { previous: windowPrevious(5), minutes: 5, history_ready: true, available_history_minutes: 240 },
        session: {
          previous: makeSnapshot(index, session.sessionOpen, session),
          minutes: 240,
          history_ready: true,
          available_history_minutes: 240,
          label: "session",
        },
      },
      data_status: {
        data_date: session.sessionDate,
        cache_age_seconds: 0,
        stale_after_seconds: 90,
        is_live: session.isOpen,
      },
    };
  }
  const oi = path.match(/^\/oi\/([^/]+)$/);
  if (oi) return snapshotPair(oi[1].toUpperCase(), session).current;
  const expiry = path.match(/^\/expiries\/([^/]+)$/);
  if (expiry) {
    const next = nextExpiryDate(expiry[1].toUpperCase(), session.sessionDate);
    return { index: expiry[1].toUpperCase(), expiries: [next], expiries_meta: [], selected: next, note: null };
  }
  if (path.startsWith("/straddle/")) {
    const index = path.split("/")[2]?.toUpperCase() || "NIFTY";
    const { current } = snapshotPair(index, session);
    if (path.endsWith("/history")) {
      const history = sessionHistory(index, session).map((snapshot) => {
        const atmStrike = snapshot.strikes.find((strike) => strike.strike === snapshot.atm);
        const ce_ltp = atmStrike?.ce_ltp || 0;
        const pe_ltp = atmStrike?.pe_ltp || 0;
        return {
          ts: snapshot.timestamp,
          atm: snapshot.atm,
          strike: snapshot.atm,
          underlying: snapshot.price,
          ce_ltp,
          pe_ltp,
          premium: Number((ce_ltp + pe_ltp).toFixed(2)),
          expiry: snapshot.expiry,
        };
      });
      return { index, trade_date: session.sessionDate, count: history.length, history };
    }
    const atmStrike = current.strikes.find((strike) => strike.strike === current.atm);
    return {
      index,
      ts: current.timestamp,
      atm: current.atm,
      strike: current.atm,
      underlying: current.price,
      ce_ltp: atmStrike?.ce_ltp || 0,
      pe_ltp: atmStrike?.pe_ltp || 0,
      premium: Number(((atmStrike?.ce_ltp || 0) + (atmStrike?.pe_ltp || 0)).toFixed(2)),
      expiry: current.expiry,
      cached: true,
    };
  }
  if (path.startsWith("/global-markets/overview")) {
    return {
      enabled: true,
      updatedAt: now.toISOString(),
      categories: [
        { id: "GLOBAL INDICES", label: "Global indices" },
        { id: "FX / FOREX", label: "FX / Forex" },
        { id: "COMMODITIES", label: "Commodities" },
        { id: "CRYPTO", label: "Crypto" },
        { id: "ADR MONITOR", label: "ADR Monitor" },
        { id: "MACRO", label: "Macro" },
      ],
      items: [
        { id: "spx", category: "GLOBAL INDICES", symbol: "S&P 500", displayName: "S&P 500", price: 6021.3, change: 24.6, changePercent: 0.41, high: 6034.2, low: 5986.7, volume: 2418000000, marketStatus: "CLOSED", available: true, timestamp: now.toISOString(), timezone: "America/New_York", precision: 2 },
        { id: "nasdaq", category: "GLOBAL INDICES", symbol: "NASDAQ", displayName: "Nasdaq Composite", price: 19546.2, change: 108.4, changePercent: 0.56, high: 19580.1, low: 19402.5, volume: 1765000000, marketStatus: "CLOSED", available: true, timestamp: now.toISOString(), timezone: "America/New_York", precision: 2 },
        { id: "gold", category: "COMMODITIES", symbol: "GOLD", displayName: "Gold spot", price: 3318.4, change: 12.8, changePercent: 0.39, high: 3326.1, low: 3298.2, volume: null, marketStatus: "CLOSED", available: true, timestamp: now.toISOString(), timezone: "Asia/Kolkata", precision: 2 },
        { id: "btc", category: "CRYPTO", symbol: "BTC", displayName: "Bitcoin", price: 104280, change: -620, changePercent: -0.59, high: 105100, low: 103840, volume: 28740, marketStatus: "24/7", available: true, timestamp: now.toISOString(), timezone: "UTC", precision: 0 },
      ],
    };
  }
  if (path === "/market-intel/prefs") return { prefs: { dismissed: [], pinned: [] } };
  if (path === "/market-intel/config") return { config: { enabled: true, max_days_back: 5 } };
  if (path === "/market-intel") {
    const items = [
      {
        id: "demo-mi-1",
        title: "RBI liquidity signal keeps bank funding in focus",
        summary: "An illustrative liquidity update puts overnight rates and bank funding costs on the desk's watchlist.",
        event_type: "india_macro",
        impact_band: "HIGH",
        impact_score: 82,
        india_relevance_score: 92,
        published_at: new Date(now.getTime() - 12 * 60000).toISOString(),
        source_name: "Walkthrough sample",
        source_count: 1,
        potential: ["Watch short-tenor yields and rate-sensitive financials."],
      },
      {
        id: "demo-mi-2",
        title: "Crude eases; import-cost outlook improves",
        summary: "A fictional pullback in crude prices offers a modest tailwind for India's inflation and import bill.",
        event_type: "oil",
        impact_band: "MODERATE",
        impact_score: 68,
        india_relevance_score: 76,
        published_at: new Date(now.getTime() - 31 * 60000).toISOString(),
        source_name: "Walkthrough sample",
        source_count: 1,
        potential: ["Track energy shares and the rupee for confirmation."],
      },
      {
        id: "demo-mi-3",
        title: "Global risk appetite firms ahead of the open",
        summary: "Illustrative gains across major Asian markets improve the external tone, while overnight cues remain mixed.",
        event_type: "macro",
        impact_band: "MODERATE",
        impact_score: 61,
        india_relevance_score: 64,
        published_at: new Date(now.getTime() - 54 * 60000).toISOString(),
        source_name: "Walkthrough sample",
        source_count: 1,
        potential: ["Check whether index breadth confirms the opening bias."],
      },
      {
        id: "demo-mi-4",
        title: "Illustrative IT outlook points to steady export demand",
        summary: "A fictional sector update keeps export demand and currency sensitivity in focus for large-cap IT.",
        event_type: "corporate",
        impact_band: "HIGH",
        impact_score: 74,
        india_relevance_score: 81,
        published_at: new Date(now.getTime() - 79 * 60000).toISOString(),
        source_name: "Walkthrough sample",
        source_count: 1,
        potential: ["Compare sector breadth with the broader NIFTY move."],
      },
    ];
    const filter = String(params?.filter || "all").toLowerCase();
    const matchesFilter = (item) => {
      if (!filter || filter === "all") return true;
      if (filter === "breaking") return item.impact_score >= 90;
      if (filter === "critical") return item.impact_band === "CRITICAL";
      if (filter === "high") return ["CRITICAL", "HIGH"].includes(item.impact_band);
      if (filter === "india") return item.india_relevance_score >= 60 || item.event_type === "india_macro";
      if (filter === "macro") return ["macro", "india_macro"].includes(item.event_type);
      if (filter === "rbi") return item.event_type === "india_macro" || /rbi/i.test(item.title);
      if (filter === "fed") return /fed/i.test(`${item.title} ${item.summary}`) || item.event_type === "macro";
      if (filter === "oil") return item.event_type === "oil";
      if (filter === "geopolitics") return item.event_type === "geopolitics";
      if (filter === "corporate") return item.event_type === "corporate";
      return true;
    };
    return {
      enabled: true,
      items: items.filter(matchesFilter),
    };
  }
  if (path.startsWith("/market-intel")) return { enabled: true, items: [], events: [], history: [], prefs: {}, config: { enabled: true, max_days_back: 5 } };
  if (path === "/adrs") {
    const updated = now.toISOString();
    return {
      enabled: true,
      items: [
        { id: "demo-infy", company_name: "Infosys", indian_symbol: "INFY", adr_symbol: "INFY", exchange: "NYSE", sector: "IT", last_price: 22.16, change: 0.34, change_percent: 1.56, open: 21.84, high: 22.28, low: 21.76, previous_close: 21.82, volume: 1842000, average_volume: 2100000, rolling_1d_change: 1.56, rolling_7d_change: 2.4, week52_low: 16.4, week52_high: 24.9, market_status: "CLOSED", updated },
        { id: "demo-hdb", company_name: "HDFC Bank", indian_symbol: "HDFCBANK", adr_symbol: "HDB", exchange: "NYSE", sector: "BANKING", last_price: 69.42, change: -0.58, change_percent: -0.83, open: 70.08, high: 70.26, low: 69.21, previous_close: 70, volume: 1438000, average_volume: 1650000, rolling_1d_change: -0.83, rolling_7d_change: 1.1, week52_low: 55.1, week52_high: 75.6, market_status: "CLOSED", updated },
        { id: "demo-wit", company_name: "Wipro", indian_symbol: "WIPRO", adr_symbol: "WIT", exchange: "NYSE", sector: "IT", last_price: 3.24, change: -0.09, change_percent: -2.7, open: 3.31, high: 3.33, low: 3.22, previous_close: 3.33, volume: 426000, average_volume: 580000, rolling_1d_change: -2.7, rolling_7d_change: -1.8, week52_low: 2.8, week52_high: 4.2, market_status: "CLOSED", updated },
      ],
      history: [],
    };
  }
  const adrHistory = path.match(/^\/adrs\/history\/([^/]+)$/);
  if (adrHistory) {
    return {
      id: adrHistory[1],
      history: Array.from({ length: 20 }, (_, i) => ({
        ts: new Date(now.getTime() - (19 - i) * 86400000).toISOString(),
        price: 21.3 + Math.sin(i / 3) * 0.8 + i * 0.035,
        change_percent: Math.sin(i / 3) * 1.2,
      })),
    };
  }
  if (path.startsWith("/adrs")) return { enabled: true, items: [], history: [] };
  if (path.startsWith("/events") || path.startsWith("/index-events")) {
    return {
      events: [
        { id: "demo-event-1", date: new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10), event_date: new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10), days_remaining: 3, time: "10:00", title: "Illustrative policy update", name: "Illustrative policy update", company: "Sample Financials", company_name: "Sample Financials", event_type: "Quarterly Results", category: "Macro", impact: "high", weightage: 7.8, description: "Sample event for the public walkthrough." },
        { id: "demo-event-2", date: new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10), event_date: new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10), days_remaining: 5, time: "14:30", title: "Illustrative earnings watch", name: "Illustrative earnings watch", company: "Sample Technology", company_name: "Sample Technology", event_type: "Board Meeting", category: "Earnings", impact: "medium", weightage: 5.2, description: "Sample event for the public walkthrough." },
      ],
      items: [],
    };
  }
  if (path.startsWith("/vrp")) return { index: path.split("/").pop(), iv: 14.8, realized_volatility: 13.2, vrp: 1.6, history: [] };
  const memory = path.match(/^\/market-memory\/([^/]+)$/);
  if (memory) {
    const index = memory[1].toUpperCase();
    const { current } = snapshotPair(index, session);
    const step = INDEX_MARKETS[index]?.step || 50;
    const freshnessSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(current.timestamp)) / 1000));
    const strengthLevels = [
      { level: current.atm - 2 * step, levelType: "SUPPORT", strength: "Strong", rejectionCount: 5, touchCount: 3, breakoutCount: 1, failedBreakoutCount: 1, currentDistance: current.price - (current.atm - 2 * step), recentAverageReaction: 82, failedBreakoutRate: 50, context: { pcr: current.pcr, vix: current.vix, expiry: current.expiry } },
      { level: current.atm, levelType: "STRUCTURAL", strength: "Moderate", rejectionCount: 3, touchCount: 4, breakoutCount: 2, failedBreakoutCount: 1, currentDistance: current.price - current.atm, recentAverageReaction: 54, failedBreakoutRate: 33, context: { pcr: current.pcr, vix: current.vix, expiry: current.expiry } },
      { level: current.atm + 2 * step, levelType: "RESISTANCE", strength: "Moderate", rejectionCount: 4, touchCount: 2, breakoutCount: 1, failedBreakoutCount: 1, currentDistance: current.price - (current.atm + 2 * step), recentAverageReaction: 67, failedBreakoutRate: 50, context: { pcr: current.pcr, vix: current.vix, expiry: current.expiry } },
    ];
    return { index, price: current.price, freshnessSeconds, levels: strengthLevels };
  }
  if (path.startsWith("/desk-") || path.startsWith("/market-memory")) return { items: [], entries: [], enabled: false };
  return undefined;
}

export function siteWalkthroughAdapter(config) {
  const method = String(config.method || "get").toLowerCase();
  const rawUrl = String(config.url || "");
  const path = rawUrl.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/api(?=\/)/, "").split("?")[0] || "/";
  const now = new Date();
  const demoConfigData = demoConfig();
  let data;

  if (method === "get" || method === "head") {
    data = fixture(path, now, demoConfigData, config.params);
    const entries = transientWrites.get(path);
    if (data === undefined) {
      if (entries?.length) {
        data = { demo_only: true, entries: [...entries] };
      } else {
        const error = new Error(`No public walkthrough fixture for ${method.toUpperCase()} ${path}`);
        error.config = config;
        error.response = { status: 404, data: { detail: error.message }, config };
        return Promise.reject(error);
      }
    }
    if (entries?.length && data && typeof data === "object" && !Array.isArray(data)) {
      const collection = Array.isArray(data.positions) ? "positions"
        : Array.isArray(data.alerts) ? "alerts"
          : Array.isArray(data.events) ? "events"
            : Array.isArray(data.items) ? "items"
              : null;
      data = collection
        ? { ...data, [collection]: [...entries, ...data[collection]], demo_entries: [...entries] }
        : { ...data, demo_entries: [...entries] };
    }
  } else {
    const rows = transientWrites.get(path) || [];
    const body = typeof config.data === "string" ? JSON.parse(config.data || "{}") : (config.data || {});
    if (path === "/desk-ai") {
      const state = {
        desk_ai_show: true,
        desk_ai_positions: false,
        desk_ai_radar: false,
        ...body,
        demo_only: true,
      };
      transientWrites.set(path, [state]);
      data = state;
    } else if (path === "/desk-guide") {
      data = { ...fixture(path, now, demoConfigData, config.params), demo_only: true };
    } else if (method === "delete") {
      transientWrites.set(path, []);
      data = { ok: true, demo_only: true };
    } else {
      const entry = { id: `demo-${Date.now()}`, ...body };
      transientWrites.set(path, [entry, ...rows]);
      data = { ok: true, demo_only: true, entry };
    }
  }

  return Promise.resolve({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
    request: null,
  });
}
