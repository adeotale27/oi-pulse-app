/** Public/admin dashboard page ticks. Home is always OI Change until /config arrives. */

export const HOME_PAGE = "oi-change";
export const BOOT_VISIBLE_PAGES = [HOME_PAGE];
/** NSE holidays + index impact — always on for guests and admin after /config. */
export const ALWAYS_ON_PAGES = ["holidays"];

/**
 * Before pagesReady, only HOME_PAGE is allowed so a reload cannot flash
 * Straddle / CAS / ADRs / etc. to guests.
 */
export function pageAllowed(id, { isAdmin, visiblePages, adminPages, pagesReady = true } = {}) {
  if (pagesReady === false) return id === HOME_PAGE;
  if (ALWAYS_ON_PAGES.includes(id)) return true;
  if (isAdmin) {
    if (!Array.isArray(adminPages) || adminPages.length === 0) return true;
    return adminPages.includes(id);
  }
  return Array.isArray(visiblePages) && visiblePages.includes(id);
}

export function sanitizePageList(ids, fallback = BOOT_VISIBLE_PAGES) {
  if (!Array.isArray(ids) || !ids.length) return fallback.slice();
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}
