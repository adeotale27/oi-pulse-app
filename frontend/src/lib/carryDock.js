/** Carry brief dock side. Default left on desktop; user can flip or drag. */

export const CARRY_DOCK_KEY = "oiCarryBriefDock";

export function normalizeCarryDockSide(value) {
  return value === "right" ? "right" : "left";
}

export function snapDockFromClientX(clientX, viewportWidth) {
  const w = Number(viewportWidth) || 0;
  const x = Number(clientX);
  if (!Number.isFinite(x) || w <= 0) return "left";
  return x < w / 2 ? "left" : "right";
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
