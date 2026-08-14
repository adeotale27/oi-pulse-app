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
