/**
 * Chrome OS notifications for desk alerts.
 *
 * Chrome hides page-created Notification() banners while the tab is still
 * visible (including a window sitting on another monitor). Service-worker
 * showNotification is what actually reaches the OS / Chrome sidebar.
 * We also skip silent:true (that used to mute desktop banners).
 */

export function shouldShowOsNotification(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return false;
  if (doc.hidden) return true;
  if (typeof doc.hasFocus === "function" && !doc.hasFocus()) return true;
  return false;
}

export function osNotificationOptions(body, { force = false } = {}) {
  return {
    body: body || "",
    icon: "/logo192.png",
    badge: "/logo192.png",
    tag: force ? "striklenz-notif-test" : "striklenz-alert",
    renotify: true,
    requireInteraction: true,
    silent: false,
  };
}

export async function registerAlertServiceWorker() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    return await navigator.serviceWorker.register("/sw-alerts.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

export async function showOsNotification(title, body, { force = false } = {}) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }
  if (!force && !shouldShowOsNotification()) return false;
  const opts = osNotificationOptions(body, { force });
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      const reg =
        (await navigator.serviceWorker.getRegistration("/")) ||
        (await navigator.serviceWorker.ready.catch(() => null));
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(title || "StrikLenz", opts);
        return true;
      }
    }
  } catch {
    /* page Notification fallback */
  }
  try {
    // eslint-disable-next-line no-new
    new Notification(title || "StrikLenz", opts);
    return true;
  } catch {
    return false;
  }
}
