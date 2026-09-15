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
  return `Impact ${score ?? "—"}`;
}

export function indiaImpactLabel(score) {
  return `Indian market impact ${score ?? "—"}`;
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
