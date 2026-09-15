/** Carry brief dock side. Default left on desktop; user can flip or drag. */

export const CARRY_DOCK_KEY = "oiCarryBriefDock";
export const CARRY_LEFT_KEY = "oiCarryBriefLeftPx";
export const CARRY_PANEL_WIDTH = 480;

export function normalizeCarryDockSide(value) {
  return value === "right" ? "right" : "left";
}

export function clampCarryLeft(px, viewportWidth, panelWidth = CARRY_PANEL_WIDTH) {
  const w = Number(viewportWidth) || 1200;
  const width = Math.min(panelWidth, Math.max(240, w - 16));
  const max = Math.max(8, w - width - 8);
  const n = Number(px);
  if (!Number.isFinite(n)) return 12;
  return Math.min(max, Math.max(8, n));
}

export function snapCarryLeft(mode, viewportWidth, panelWidth = CARRY_PANEL_WIDTH) {
  const w = Number(viewportWidth) || 1200;
  const width = Math.min(panelWidth, Math.max(240, w - 16));
  if (mode === "right") return clampCarryLeft(w - width - 12, w, panelWidth);
  if (mode === "center") return clampCarryLeft(Math.round((w - width) / 2), w, panelWidth);
  return 12;
}

export function snapDockFromClientX(clientX, viewportWidth) {
  const w = Number(viewportWidth) || 0;
  const x = Number(clientX);
  if (!Number.isFinite(x) || w <= 0) return "left";
  if (x < w / 3) return "left";
  if (x > (2 * w) / 3) return "right";
  return "center";
}

export function readCarryDockSide() {
  try {
    return normalizeCarryDockSide(localStorage.getItem(CARRY_DOCK_KEY));
  } catch {
    return "left";
  }
}

export function writeCarryDockSide(side) {
  try {
    localStorage.setItem(CARRY_DOCK_KEY, normalizeCarryDockSide(side));
  } catch {
    /* ignore */
  }
}

export function readCarryLeft() {
  try {
    const n = Number(localStorage.getItem(CARRY_LEFT_KEY));
    if (Number.isFinite(n) && n >= 8 && n <= 4000) return n;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeCarryLeft(px) {
  try {
    localStorage.setItem(CARRY_LEFT_KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

/** Keep floating docks below the ticker / Kite API header. */
export function deskHeaderClearance() {
  if (typeof document === "undefined") return 88;
  let top = 56;
  for (const sel of [
    "[data-testid='dashboard-header']",
    ".oi-header",
    "[data-testid='kite-maintenance-banner']",
    "[data-testid='kite-token-banner']",
  ]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0) top = Math.max(top, r.bottom);
  }
  return Math.min(220, Math.max(56, Math.round(top + 8)));
}

/**
 * CSS `bottom` so the panel top (drag handle) stays below the header.
 * `panelHeight` is the rendered height of the chip or sheet.
 */
export function clampDockBottom(raw, viewportHeight, opts = {}) {
  const vh = Number(viewportHeight) || 800;
  const min = Math.max(8, Number(opts.minBottom) || 12);
  const header = Math.max(48, Number(opts.headerClearance) || 88);
  const h = Math.max(40, Number(opts.panelHeight) || 48);
  const max = Math.max(min, vh - header - h);
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
