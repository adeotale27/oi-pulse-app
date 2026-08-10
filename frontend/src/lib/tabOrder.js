// Persist + apply ordered id lists (dashboard tabs, info tiles, …).

const TAB_ORDER_KEY = "oiDashboardTabOrder";
const TILE_ORDER_KEY = "oiDashboardTileOrder";
const EXPIRY_LIST_HEIGHT_KEY = "oiExpiryListHeightPx";

export function loadIdOrder(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function saveIdOrder(storageKey, ids) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    /* noop */
  }
}

export function loadTabOrder() {
  return loadIdOrder(TAB_ORDER_KEY);
}

export function saveTabOrder(ids) {
  saveIdOrder(TAB_ORDER_KEY, ids);
}

export function loadTileOrder() {
  return loadIdOrder(TILE_ORDER_KEY);
}

export function saveTileOrder(ids) {
  saveIdOrder(TILE_ORDER_KEY, ids);
}

const EXPIRY_LIST_MIN_PX = 36; // ~one expiry row
const EXPIRY_LIST_MAX_PX = 480;
const EXPIRY_LIST_DEFAULT_PX = 220;

export function clampExpiryListHeight(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return EXPIRY_LIST_DEFAULT_PX;
  return Math.min(EXPIRY_LIST_MAX_PX, Math.max(EXPIRY_LIST_MIN_PX, Math.round(n)));
}

export function loadExpiryListHeight() {
  try {
    const raw = localStorage.getItem(EXPIRY_LIST_HEIGHT_KEY);
    if (raw == null || raw === "") return EXPIRY_LIST_DEFAULT_PX;
    return clampExpiryListHeight(parseInt(raw, 10));
  } catch {
    return EXPIRY_LIST_DEFAULT_PX;
  }
}

export function saveExpiryListHeight(px) {
  try {
    localStorage.setItem(EXPIRY_LIST_HEIGHT_KEY, String(clampExpiryListHeight(px)));
  } catch {
    /* noop */
  }
}

export {
  TAB_ORDER_KEY,
  TILE_ORDER_KEY,
  EXPIRY_LIST_HEIGHT_KEY,
  EXPIRY_LIST_MIN_PX,
  EXPIRY_LIST_MAX_PX,
  EXPIRY_LIST_DEFAULT_PX,
};

/** Stable merge: preferred ids first (when known), then any remaining catalog pages. */
export function orderPages(pages, preferredIds = []) {
  const byId = new Map((pages || []).map((p) => [p.v, p]));
  const seen = new Set();
  const out = [];
  for (const id of preferredIds || []) {
    const page = byId.get(id);
    if (page && !seen.has(id)) {
      out.push(page);
      seen.add(id);
    }
  }
  for (const page of pages || []) {
    if (!seen.has(page.v)) {
      out.push(page);
      seen.add(page.v);
    }
  }
  return out;
}

/** Order items by preferred ids using `idKey` (default "id"). */
export function orderByIds(items, preferredIds = [], idKey = "id") {
  const byId = new Map((items || []).map((it) => [it[idKey], it]));
  const seen = new Set();
  const out = [];
  for (const id of preferredIds || []) {
    const it = byId.get(id);
    if (it && !seen.has(id)) {
      out.push(it);
      seen.add(id);
    }
  }
  for (const it of items || []) {
    const id = it[idKey];
    if (!seen.has(id)) {
      out.push(it);
      seen.add(id);
    }
  }
  return out;
}

/** Move dragId so it sits where dropId currently is (dropId shifts aside). */
export function moveIdBefore(ids, dragId, dropId) {
  if (!dragId || !dropId || dragId === dropId) return ids.slice();
  const next = ids.filter((id) => id !== dragId);
  const to = next.indexOf(dropId);
  if (to < 0) {
    next.push(dragId);
    return next;
  }
  next.splice(to, 0, dragId);
  return next;
}

/** Move id left (-1) or right (+1) by one slot; clamps at ends. */
export function moveIdByOffset(ids, id, delta) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  const i = list.indexOf(id);
  if (i < 0 || !delta) return list;
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (j === i) return list;
  list.splice(i, 1);
  list.splice(j, 0, id);
  return list;
}

/** Pin id to the front (favorite). */
export function pinIdFirst(ids, id) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  if (!id || !list.includes(id)) return list;
  return [id, ...list.filter((x) => x !== id)];
}

/** Clear saved layout prefs and restore factory defaults. */
export function resetLayoutPrefs() {
  try {
    localStorage.removeItem(TAB_ORDER_KEY);
    localStorage.removeItem(TILE_ORDER_KEY);
    localStorage.setItem(EXPIRY_LIST_HEIGHT_KEY, String(EXPIRY_LIST_DEFAULT_PX));
  } catch {
    /* noop */
  }
  return {
    tabOrder: [],
    tileOrder: [],
    expiryListHeight: EXPIRY_LIST_DEFAULT_PX,
  };
}
