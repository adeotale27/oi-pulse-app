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
  if (typeof doc.visibilityState === "string" && doc.visibilityState !== "visible") return true;
  if (typeof doc.hasFocus === "function" && !doc.hasFocus()) return true;
  if (typeof document !== "undefined" && typeof document.hasFocus === "function" && doc === document) {
    try {
      if (typeof window !== "undefined" && document.hasFocus() === false) return true;
    } catch { /* noop */ }
  }
  return false;
}

export function osNotificationOptions(body, { force = false, tag } = {}) {
  return {
    body: body || "",
    icon: "/logo192.png",
    badge: "/logo192.png",
    tag: tag || (force ? "striklenz-notif-test" : `striklenz-alert-${Date.now()}`),
    renotify: true,
    requireInteraction: true,
    silent: false,
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function registerAlertServiceWorker() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    return await withTimeout(
      navigator.serviceWorker.register("/sw-alerts.js", {
        scope: "/",
        updateViaCache: "none",
      }),
      2500,
    );
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
      let reg = null;
      try {
        reg = await withTimeout(navigator.serviceWorker.getRegistration("/"), 800);
      } catch { /* noop */ }
      if (!reg) {
        try {
          reg = await withTimeout(registerAlertServiceWorker(), 2500);
        } catch { /* noop */ }
      }
      if (reg && typeof reg.showNotification === "function") {
        await withTimeout(reg.showNotification(title || "StrikLenz", opts), 1500);
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
