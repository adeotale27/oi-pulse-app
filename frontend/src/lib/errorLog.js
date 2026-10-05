/** Report desk crashes to Mongo `error_logs`. Never send tokens. */
import { isSiteWalkthroughPath } from "@/lib/siteWalkthroughApi";

const MAX_PER_MIN = 8;
const stamps = [];
const CHUNK_RELOAD_KEY = "oi_chunk_reload_once";
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;
const CHUNK_RELOAD_PARAM = "__chunk_reload";
let chunkReloadStartedAt = 0;

function isPublicWalkthrough() {
  // Keep public demo browsing out of persistent crash telemetry.
  return isSiteWalkthroughPath();
}

export function isChunkLoadError(message) {
  return /chunkloaderror|loading\s+(?:css\s+)?chunk\s+\d+\s+failed|failed to fetch dynamically imported module|importing a module script failed|unable to preload css/i
    .test(String(message || ""));
}

export function recoverFromChunkLoad(message) {
  if (!isChunkLoadError(message) || typeof window === "undefined") return;
  const now = Date.now();
  let lastReloadAt = chunkReloadStartedAt;
  try {
    lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || lastReloadAt);
  } catch { /* in-memory throttle remains available when storage is blocked */ }
  if (now - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) return;
  chunkReloadStartedAt = now;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch { /* the in-memory timestamp still prevents a reload loop */ }
  // A deployed HTML shell can outlive its hashed JS/CSS assets in a browser or
  // CDN cache; a unique document URL bypasses that cached shell once.
  window.setTimeout(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(CHUNK_RELOAD_PARAM, String(Date.now()));
    window.location.replace(url.href);
  }, 50);
}

function cleanChunkReloadUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CHUNK_RELOAD_PARAM)) return;
    url.searchParams.delete(CHUNK_RELOAD_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    /* URL cleanup is best-effort; it must not block error reporting. */
  }
}

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
    if (typeof window === "undefined" || isPublicWalkthrough()) return;
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
    const sameOrigin =
      typeof window !== "undefined" &&
      url.startsWith(String(window.location.origin || ""));
    // Cross-origin sendBeacon is credentialed and trips CORS when the API uses `*`.
    if (
      sameOrigin &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
      mode: "cors",
    }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

export const ERROR_LOG_UNSEEN_EVENT = "oi-error-log-unseen";

export function errorSourceLabel(src) {
  const raw = String(src || "").trim();
  if (!raw) return "";
  const known = {
    market_intel: "Mkt Intel",
    straddle: "Straddle",
    kite: "Kite",
    adr: "Global Markets",
    global_market: "Global Market",
    ui: "UI",
    api: "API",
    ws: "WS",
    boundary: "Boundary",
  };
  return known[raw] || raw;
}

export function notifyErrorLogUnseenChanged(unseen) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ERROR_LOG_UNSEEN_EVENT, { detail: { unseen } }));
}

export function installDeskErrorLog() {
  if (typeof window === "undefined") return;
  cleanChunkReloadUrl();
  if (window.__striklenzErrorLog) return;
  window.__striklenzErrorLog = true;
  window.addEventListener("error", (ev) => {
    const message = ev?.message || ev?.error?.message || "window.error";
    reportDeskError({
      message,
      stack: ev?.error?.stack || "",
      source: "ui",
    });
    recoverFromChunkLoad(message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev?.reason;
    const message = reason?.message || String(reason || "unhandledrejection");
    reportDeskError({
      message,
      stack: reason?.stack || "",
      source: "ui",
    });
    recoverFromChunkLoad(message);
  });
}
