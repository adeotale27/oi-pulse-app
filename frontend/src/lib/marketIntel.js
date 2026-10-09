export const MI_FILTERS = [
  { id: "all", label: "All" },
  { id: "breaking", label: "Breaking" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High Impact" },
  { id: "india", label: "India" },
  { id: "macro", label: "Macro" },
  { id: "rbi", label: "RBI" },
  { id: "fed", label: "Fed" },
  { id: "oil", label: "Oil" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "corporate", label: "Corporate" },
];

export const MI_CATS = ["India", "Macro", "Fed", "Oil", "Geopolitics", "Corporate"];

export function bandClass(band) {
  if (band === "CRITICAL") return "bg-rose-100 text-rose-900 border-rose-200";
  if (band === "HIGH") return "bg-amber-100 text-amber-900 border-amber-200";
  if (band === "MODERATE") return "bg-sky-50 text-sky-900 border-sky-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function impactScoreLabel(score) {
  return `Importance ${score ?? "—"}`;
}

export function indiaImpactLabel(score) {
  return `Indian market impact ${score ?? "—"}`;
}

export function directionalImpactLabel(direction) {
  if (direction === "SUPPORTIVE") return "Likely market up";
  if (direction === "NEGATIVE") return "Likely market down";
  if (direction === "MIXED") return "Mixed signals";
  return "Market direction unclear";
}

export function directionalBasisLabel(basis) {
  if (basis === "HEADLINE") return "Direction read from headline.";
  if (basis === "SUMMARY") return "Direction read from article summary; less direct than the headline.";
  if (basis === "SOURCES") return "Direction checked against independent publisher reads.";
  return "No clear directional cue found.";
}

export function marketTimingLabel(timing) {
  return ({
    IN_SESSION: "During market hours",
    PRE_OPEN: "Before market open",
    AFTER_CLOSE: "After market close",
    WEEKEND_OR_HOLIDAY: "Weekend / market holiday",
  })[timing] || "Market timing unavailable";
}

export function newsFreshnessLabel(freshness) {
  return ({
    CURRENT: "Recent",
    OLD: "Older story",
    RECEIVED_LATE: "Received more than 1h after publication",
    PUBLISH_TIME_UNKNOWN: "Publisher time unavailable",
    FUTURE_TIMESTAMP: "Publisher time needs checking",
  })[freshness] || "Freshness unavailable";
}

export function sourceAgreementLabel(agreement) {
  return ({
    AGREE: "Independent reads agree",
    DISAGREE: "Independent reads disagree",
    INSUFFICIENT_DIRECTION: "Not enough directional reads",
    SINGLE: "Single independent source",
    UNKNOWN: "Source independence unavailable",
  })[agreement] || "Source agreement unavailable";
}

export function marketIntelTimeLabel(value) {
  if (!value) return "unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed) + " IST";
}

export function marketIntelPublicationLabel(value, precision) {
  if (!value) return "time not supplied";
  if (precision === "DATE") return String(value).slice(0, 10);
  return marketIntelTimeLabel(value);
}

export function volatilityRiskClass(level) {
  if (level === "HIGH") return "border-rose-200 bg-rose-50 text-rose-900";
  if (level === "ELEVATED") return "border-amber-200 bg-amber-50 text-amber-900";
  if (level === "LOW") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-slate-200 bg-white text-slate-600";
}

export function volatilitySellerNote(level) {
  if (level === "HIGH") return "High text-based volatility read: review short-option exposure and hedges.";
  if (level === "ELEVATED") return "Elevated text-based volatility read: review short-option exposure.";
  if (level === "LOW") return "A low text-based catalyst read does not mean your positions are low risk.";
  return null;
}

export function directionalImpactClass(direction) {
  if (direction === "SUPPORTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (direction === "NEGATIVE") return "border-rose-200 bg-rose-50 text-rose-900";
  if (direction === "MIXED") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function directionalPopupSurfaceClass(direction) {
  if (direction === "SUPPORTIVE") return "border-emerald-400 bg-emerald-50 text-emerald-950";
  if (direction === "NEGATIVE") return "border-rose-400 bg-rose-50 text-rose-950";
  if (direction === "MIXED") return "border-amber-400 bg-amber-50 text-amber-950";
  if (direction === "UNCLEAR") return "border-slate-300 bg-slate-50 text-slate-900";
  return "border-rose-400 bg-rose-50 text-rose-950";
}

/** `india_macro` / `oil` → `INDIA MACRO` / `OIL` for the feed chip. */
export function formatEventTypeLabel(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  return t.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}

export const MI_RELOAD_EVENT = "oi-market-intel-reload";

export function notifyMarketIntelReload() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MI_RELOAD_EVENT));
}

export const MI_POPUP_LEFT_KEY = "oiMiPopupLeftPx";
export const MI_POPUP_BOTTOM_KEY = "oiMiPopupBottomPx";
export const MI_POPUP_MIN_KEY = "oi_mi_popup_minimized";

export function miMinimizeActive(nowMs, untilMs) {
  return Number.isFinite(untilMs) && Number(nowMs) < Number(untilMs);
}

const MI_FEED_CACHE = new Map();

export function miFeedCacheKey(date, filt) {
  return `${date || ""}|${filt || "all"}`;
}

export function readMiFeedCache(date, filt) {
  return MI_FEED_CACHE.get(miFeedCacheKey(date, filt)) || null;
}

export function writeMiFeedCache(date, filt, items) {
  MI_FEED_CACHE.set(miFeedCacheKey(date, filt), Array.isArray(items) ? items : []);
}
