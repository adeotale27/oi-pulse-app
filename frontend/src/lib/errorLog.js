/** Report desk crashes to Mongo `error_logs`. Never send tokens. */

const MAX_PER_MIN = 8;
const stamps = [];

function backendOrigin() {
  const env = (process.env.REACT_APP_BACKEND_URL || "").trim();
  if (env && env !== "undefined" && env !== "null") return env.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function allowed() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 60_000) stamps.shift();
  if (stamps.length >= MAX_PER_MIN) return false;
  stamps.push(now);
  return true;
}

export function reportDeskError({ message, stack, source = "ui", path } = {}) {
  try {
    if (typeof window === "undefined") return;
    const msg = String(message || "client error").slice(0, 2000);
    if (/cancellederror|websocketdisconnect/i.test(msg)) return;
    if (!allowed()) return;
    const body = JSON.stringify({
      message: msg,
      stack: String(stack || "").slice(0, 8000),
      source: String(source || "ui").slice(0, 32),
      path: String(path || window.location.pathname || "").slice(0, 300),
      href: String(window.location.pathname || "").slice(0, 200),
    });
    const url = `${backendOrigin()}/api/errors`;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

export function installDeskErrorLog() {
  if (typeof window === "undefined") return;
  if (window.__striklenzErrorLog) return;
  window.__striklenzErrorLog = true;
  window.addEventListener("error", (ev) => {
    reportDeskError({
      message: ev?.message || ev?.error?.message || "window.error",
      stack: ev?.error?.stack || "",
      source: "ui",
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev?.reason;
    const message = reason?.message || String(reason || "unhandledrejection");
    reportDeskError({
      message,
      stack: reason?.stack || "",
      source: "ui",
    });
  });
}
