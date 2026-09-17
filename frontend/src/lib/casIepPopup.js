/** CAS Indicative price popup window + ticker IEP merge (do not drop last print on sparse ticks). */

export const CAS_IEP_POPUP_PREF = "oiCasIepPopup";

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

/** Popup from one minute before admin IEP start through IEP end (default 15:19–15:35). */
export function casIepPopupActive({
  enabled = true,
  force = false,
  startIst = "15:20",
  endIst = "15:35",
  minutesOfDay = 0,
  tradingDay = true,
} = {}) {
  if (enabled === false) return false;
  if (force) return true;
  if (!tradingDay) return false;
  const start = hmToMinutes(startIst, 15 * 60 + 20);
  const end = hmToMinutes(endIst, 15 * 60 + 35);
  const popupStart = Math.max(0, start - 1);
  if (popupStart <= end) return minutesOfDay >= popupStart && minutesOfDay <= end;
  return minutesOfDay >= popupStart || minutesOfDay <= end;
}

export function mergeIndicativeClose(prevRow, incoming, { keepLast = false } = {}) {
  const nextVal = incoming?.indicative_close_price;
  if (nextVal != null && Number(nextVal) > 0) return Number(nextVal);
  const prev = prevRow?.indicative_close_price;
  if (keepLast && prev != null && Number(prev) > 0) return Number(prev);
  return undefined;
}

export const CAS_IEP_POPUP_INDICES = [
  { index: "NIFTY", label: "NIFTY 50" },
  { index: "SENSEX", label: "SENSEX" },
];
