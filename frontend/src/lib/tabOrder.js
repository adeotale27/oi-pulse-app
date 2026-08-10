// Persist + apply dashboard tab order (drag-and-drop).

const TAB_ORDER_KEY = "oiDashboardTabOrder";

export function loadTabOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function saveTabOrder(ids) {
  try {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* noop */
  }
}

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
