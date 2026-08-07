/**
 * Unit tests for overnight brief, writer defense, data truth.
 * Run: node frontend/src/lib/carryTruth.test.js
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ---- Inline mirrors of pure logic (no JSX / path aliases) ----

const EVENT_WARNING_MINUTE = 15 * 60 + 15;
const SUNDAY_BRIEF_MINUTE = 20 * 60;

function shouldAutoShowBrief(weekday, minutesOfDay) {
  if (weekday >= 1 && weekday <= 5 && minutesOfDay >= EVENT_WARNING_MINUTE) return true;
  if (weekday === 0 && minutesOfDay >= SUNDAY_BRIEF_MINUTE) return true;
  return false;
}

function briefTriggerKey(istDateISO, weekday, minutesOfDay) {
  if (weekday === 0 && minutesOfDay >= SUNDAY_BRIEF_MINUTE) return `${istDateISO}|sunday-night`;
  if (weekday >= 1 && weekday <= 5 && minutesOfDay >= EVENT_WARNING_MINUTE) return `${istDateISO}|eod-315`;
  return null;
}

function sessionBiasFromSnapshots(current, sessionPrevious) {
  if (!current?.strikes?.length || !sessionPrevious?.strikes?.length) return null;
  const prevMap = new Map();
  sessionPrevious.strikes.forEach((s) => prevMap.set(s.strike, s));
  let ce = 0, pe = 0;
  for (const s of current.strikes) {
    const p = prevMap.get(s.strike);
    if (!p) continue;
    ce += (s.ce_oi || 0) - (p.ce_oi || 0);
    pe += (s.pe_oi || 0) - (p.pe_oi || 0);
  }
  const total = Math.abs(ce) + Math.abs(pe) || 1;
  const net = pe - ce;
  return { ce, pe, net, intensity: Math.min(1, Math.abs(net) / total), bullish: net >= 0 };
}

function carryVerdict({ biases = [], events = [], giftPct = null, weekday }) {
  const criticalEvents = events.filter((e) => e.impact === "critical" || e.type === "holiday");
  const highEvents = events.filter((e) => e.impact === "high");
  const giftAbs = giftPct != null && Number.isFinite(Number(giftPct)) ? Math.abs(Number(giftPct)) : null;
  let score = 0;
  if (criticalEvents.length) score += 40;
  else if (highEvents.length) score += 20;
  if (giftAbs != null) {
    if (giftAbs >= 0.8) score += 25;
    else if (giftAbs >= 0.35) score += 12;
  }
  const bearish = biases.filter((b) => b && !b.bullish && b.pct >= 25).length;
  const bullish = biases.filter((b) => b && b.bullish && b.pct >= 25).length;
  if (bearish && bullish) score += 10;
  else if (bearish >= 2) score += 15;
  else if (bullish >= 2) score += 5;
  if (weekday === 5 || weekday === 0) score += 10;
  score = Math.min(100, score);
  let band = "CARRY_OK";
  if (score >= 55) band = "DO_NOT_CARRY";
  else if (score >= 30) band = "REDUCE";
  return { score, band };
}

// Writer defense classify (simplified mirror of classifySide + compute)
const RETAIN_HELD = 0.92;
const RETAIN_CRACK = 0.85;
const MIN_OI = 500;
const BUILD_PCT = 8;
const UNWIND_PCT = 10;

function classifySide({ openOi, nowOi, side, strike, spot }) {
  const open = Number(openOi) || 0;
  const now = Number(nowOi) || 0;
  const delta = now - open;
  const retain = open > 0 ? now / open : now > 0 ? 1 : 0;
  const deltaPct = open > 0 ? (delta / open) * 100 : 0;
  const significant = Math.max(open, now) >= MIN_OI;
  let priceBroke = false;
  if (spot != null && Number.isFinite(spot)) {
    if (side === "PE" && spot < strike) priceBroke = true;
    if (side === "CE" && spot > strike) priceBroke = true;
  }
  if (!significant) return { code: "THIN" };
  if (priceBroke && retain < RETAIN_HELD) return { code: "CRACKED" };
  if (priceBroke && retain >= RETAIN_HELD) return { code: "STRESSED" };
  if (retain < RETAIN_CRACK || deltaPct <= -UNWIND_PCT) return { code: "CRACKED" };
  if (deltaPct >= BUILD_PCT && retain >= RETAIN_HELD) return { code: "BUILDING" };
  if (retain >= RETAIN_HELD) return { code: "HELD" };
  return { code: "SOFTENING" };
}

function buildDataTruth({ dataStatus, marketOpen, mode, snapshotTs }) {
  const ds = dataStatus || {};
  const kite = mode === "kite";
  const open = marketOpen === true;
  const asOfIso = snapshotTs || null;
  const dataDate = ds.data_date || null;
  const age = ds.cache_age_seconds;
  let isLive = ds.is_live === true;
  if (ds.is_live == null) isLive = kite && open && (age == null || age <= 45);
  if (!asOfIso && !dataDate) return { mode: "NO_DATA", badge: "NO DATA" };
  if (!kite) return { mode: "OFFLINE", badge: "OFFLINE" };
  if (isLive && open) return { mode: "LIVE", badge: "LIVE" };
  if (!open) return { mode: "LAST_SESSION", badge: "LAST SESSION" };
  return { mode: "STALE", badge: "STALE" };
}

// ---- Tests ----

assert(shouldAutoShowBrief(1, EVENT_WARNING_MINUTE) === true, "Mon 15:15 shows");
assert(shouldAutoShowBrief(1, EVENT_WARNING_MINUTE - 1) === false, "Mon 15:14 hidden");
assert(shouldAutoShowBrief(0, SUNDAY_BRIEF_MINUTE) === true, "Sun 20:00 shows");
assert(shouldAutoShowBrief(0, SUNDAY_BRIEF_MINUTE - 1) === false, "Sun 19:59 hidden");
assert(shouldAutoShowBrief(6, 22 * 60) === false, "Sat never auto");

assert(briefTriggerKey("2026-08-07", 5, EVENT_WARNING_MINUTE) === "2026-08-07|eod-315", "fri key");
assert(briefTriggerKey("2026-08-09", 0, SUNDAY_BRIEF_MINUTE) === "2026-08-09|sunday-night", "sun key");
assert(briefTriggerKey("2026-08-07", 3, 10 * 60) === null, "midday no key");

const bias = sessionBiasFromSnapshots(
  { strikes: [{ strike: 100, ce_oi: 1100, pe_oi: 2000 }] },
  { strikes: [{ strike: 100, ce_oi: 1000, pe_oi: 1000 }] },
);
assert(bias.bullish === true, "put build → bullish");
assert(bias.pe === 1000 && bias.ce === 100, "deltas");

const calm = carryVerdict({ biases: [{ bullish: true, pct: 40 }], events: [], giftPct: 0.05, weekday: 2 });
assert(calm.band === "CARRY_OK", "calm carry");
const hot = carryVerdict({
  biases: [{ bullish: false, pct: 50 }, { bullish: false, pct: 40 }],
  events: [{ impact: "critical" }],
  giftPct: -1.2,
  weekday: 5,
});
assert(hot.band === "DO_NOT_CARRY", "hot do-not-carry");

assert(classifySide({ openOi: 10000, nowOi: 9800, side: "PE", strike: 100, spot: 101 }).code === "HELD", "support held");
assert(classifySide({ openOi: 10000, nowOi: 7000, side: "PE", strike: 100, spot: 101 }).code === "CRACKED", "support cracked OI");
assert(classifySide({ openOi: 10000, nowOi: 9500, side: "PE", strike: 100, spot: 99 }).code === "STRESSED", "price thru stressed");
assert(classifySide({ openOi: 10000, nowOi: 7000, side: "PE", strike: 100, spot: 99 }).code === "CRACKED", "price thru cracked");
assert(classifySide({ openOi: 10000, nowOi: 12000, side: "CE", strike: 110, spot: 100 }).code === "BUILDING", "resistance building");

assert(buildDataTruth({
  dataStatus: { is_live: true, data_date: "2026-08-07", cache_age_seconds: 10 },
  marketOpen: true, mode: "kite", snapshotTs: "2026-08-07T10:00:00+05:30",
}).mode === "LIVE", "live");
assert(buildDataTruth({
  dataStatus: { is_live: false, stale_reason: "market_closed", data_date: "2026-08-07" },
  marketOpen: false, mode: "kite", snapshotTs: "2026-08-07T15:30:00+05:30",
}).badge === "LAST SESSION", "last session badge");
assert(buildDataTruth({
  dataStatus: { is_live: false, stale_reason: "missing_kite_credentials", data_date: "2026-08-07" },
  marketOpen: true, mode: "offline", snapshotTs: "2026-08-07T10:00:00+05:30",
}).mode === "OFFLINE", "offline");
assert(buildDataTruth({
  dataStatus: { is_live: false, stale_reason: "stale_cache", data_date: "2026-08-07", cache_age_seconds: 120 },
  marketOpen: true, mode: "kite", snapshotTs: "2026-08-07T10:00:00+05:30",
}).mode === "STALE", "stale while open");

console.log("carryTruth.test.js: all assertions passed");
