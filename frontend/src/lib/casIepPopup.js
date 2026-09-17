/** CAS Indicative price popup window + ticker IEP merge (do not drop last print on sparse ticks). */

export const CAS_IEP_POPUP_PREF = "oiCasIepPopup";
/** NSE cash / Kite IEP typically stops printing at 15:30 IST. */
export const KITE_IEP_SETTLE_MINUTE = 15 * 60 + 30;

export function readCasIepPopupPref() {
  try {
    return localStorage.getItem(CAS_IEP_POPUP_PREF) !== "0";
  } catch {
    return true;
  }
}

export function writeCasIepPopupPref(on) {
  try {
    localStorage.setItem(CAS_IEP_POPUP_PREF, on ? "1" : "0");
  } catch { /* noop */ }
}

export function hmToMinutes(hm, fallback) {
  try {
    const [h, m] = String(hm || "").split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return h * 60 + m;
    }
  } catch { /* noop */ }
  return fallback;
}

export function casIepDisplayEndMinutes(endIst = "15:30") {
  const end = hmToMinutes(endIst, KITE_IEP_SETTLE_MINUTE);
  return Math.min(end, KITE_IEP_SETTLE_MINUTE);
}

/** Popup from one minute before admin IEP start through Kite settle (15:30) or admin end, whichever is sooner. */
export function casIepPopupActive({
  enabled = true,
  force = false,
  startIst = "15:20",
  endIst = "15:30",
  minutesOfDay = 0,
  tradingDay = true,
} = {}) {
  if (enabled === false) return false;
  if (force) return true;
  if (!tradingDay) return false;
  const start = hmToMinutes(startIst, 15 * 60 + 20);
  const end = casIepDisplayEndMinutes(endIst);
  const popupStart = Math.max(0, start - 1);
  if (popupStart <= end) return minutesOfDay >= popupStart && minutesOfDay <= end;
  return minutesOfDay >= popupStart || minutesOfDay <= end;
}

export function mergeIndicativeClose(prevRow, incoming, { keepLast = false } = {}) {
  const hasKey = incoming && Object.prototype.hasOwnProperty.call(incoming, "indicative_close_price");
  const nextVal = incoming?.indicative_close_price;
  if (nextVal != null && Number(nextVal) > 0) return Number(nextVal);
  // Kite sends 0 / omits IEP once CAS matching settles — drop the last print.
  if (hasKey && !(Number(nextVal) > 0) && prevRow?.indicative_close_price) return undefined;
  const prev = prevRow?.indicative_close_price;
  if (keepLast && prev != null && Number(prev) > 0) return Number(prev);
  return undefined;
}

export function indicativeChangePct(row) {
  if (!row) return null;
  const given = Number(row.indicative_change_pct);
  if (Number.isFinite(given)) return given;
  const iep = Number(row.indicative_close_price);
  const prev = Number(row.prev_close);
  if (!(iep > 0) || !(prev > 0)) return null;
  return ((iep - prev) / prev) * 100;
}

export function roundAtm(spot, step = 50) {
  const s = Number(spot);
  const g = Number(step) || 50;
  if (!(s > 0) || !(g > 0)) return 0;
  return Math.round(s / g) * g;
}

export const CAS_IEP_POPUP_INDICES = [
  { index: "NIFTY", label: "NIFTY 50" },
  { index: "SENSEX", label: "SENSEX" },
];
