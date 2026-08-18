import axios from "axios";
import { shouldWipeTokensOn401 } from "@/lib/authBoot";

// Backend URL resolution:
// 1. Use REACT_APP_BACKEND_URL if provided at build time (Emergent preview).
// 2. Otherwise fall back to the current window origin. This lets the app work
//    on custom domains (e.g. https://striklenz.com) without a rebuild,
//    provided the domain proxies `/api/*` to the FastAPI backend.
const _envBackend = (process.env.REACT_APP_BACKEND_URL || "").trim();
const _hasEnvBackend = _envBackend && _envBackend !== "undefined" && _envBackend !== "null";
const BACKEND_URL = _hasEnvBackend
  ? _envBackend
  : (typeof window !== "undefined" ? window.location.origin : "");
export const API = `${BACKEND_URL}/api`;

// NOTE: withCredentials MUST be false. The Emergent preview ingress (Cloudflare)
// overrides `Access-Control-Allow-Origin` to `*`, and browsers reject `*` +
// credentials mode. We authenticate via `X-Admin-Token` / `X-Guest-Token`
// headers (see the request interceptor below) — no cookies are used — so
// disabling withCredentials is safe.
export const api = axios.create({ baseURL: API, timeout: 20000, withCredentials: false });

/** FastAPI `detail` can be a string, list of objects, or missing on timeout. */
export function apiDetail(e, fallback = "Request failed") {
  const code = e?.code;
  if (code === "ECONNABORTED" || /timeout/i.test(String(e?.message || ""))) {
    return "Kite dump took too long — tap Refresh, wait, then Enable again (first load can take a minute)";
  }
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d.trim()) return d;
  if (Array.isArray(d)) {
    const bits = d.map((x) => (typeof x === "string" ? x : x?.msg || x?.detail)).filter(Boolean);
    if (bits.length) return bits.join("; ");
  }
  if (d && typeof d === "object" && d.msg) return String(d.msg);
  return e?.message || fallback;
}

export const INDEX_ADMIN_TIMEOUT_MS = 90000;

// Simple deduped helper for the /tickers/extras endpoint so multiple callers
// won't create duplicate concurrent network requests. Keeps one inflight promise
// and returns its resolved data to all callers.
let __inflightExtras = null;
let __lastExtrasFetchAt = 0;
let __extrasCache = null; // { data, fetchedAt }
const EXTRAS_CACHE_TTL_MS = 3000; // 3s cache to coalesce very rapid repeat callers

// Singleton poller state
let __extrasSubscribers = new Set();
let __extrasPollerId = null;
let __extrasPollMs = 30_000; // default poll interval

export async function fetchExtras() {
  const now = Date.now();

  // Return cached data for very short TTL to avoid bursty duplicate requests
  if (__extrasCache && now - (__extrasCache.fetchedAt || 0) < EXTRAS_CACHE_TTL_MS) {
    if (process.env.NODE_ENV !== 'production') {
      try { console.debug('[fetchExtras] returning cached extras', { ageMs: now - __extrasCache.fetchedAt }); } catch (_) {}
    }
    return Promise.resolve(__extrasCache.data);
  }

  // If a fetch is already in-flight, reuse it
  if (__inflightExtras) {
    if (process.env.NODE_ENV !== 'production') {
      try { console.debug('[fetchExtras] returning existing inflight promise', { now: new Date(now).toISOString() }); console.trace('[fetchExtras] callers stack'); } catch (_) {}
    }
    return __inflightExtras;
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      console.debug('[fetchExtras] creating new network request', { time: new Date(now).toISOString() });
      console.trace('[fetchExtras] stack trace for creator');
    } catch (_) {}
  }

  __inflightExtras = api.get("/tickers/extras").then((r) => {
    const data = r.data;
    try {
      __lastExtrasFetchAt = Date.now();
      __extrasCache = { data, fetchedAt: Date.now() };
    } catch (_) {}
    return data;
  }).catch((e) => {
    // On error, keep previous cache (don't clobber) and rethrow
    if (process.env.NODE_ENV !== 'production') {
      try { console.debug('[fetchExtras] network error, keeping previous cache if any', e?.message || e); } catch (_) {}
    }
    throw e;
  }).finally(() => { __inflightExtras = null; });

  return __inflightExtras;
}

// Internal: notify subscribers with latest data
function __notifyExtrasSubscribers(data, meta = {}) {
  try {
    __extrasSubscribers.forEach((cb) => {
      try { cb(data, meta); } catch (_) {}
    });
  } catch (_) {}
}

// Start the singleton poller if not running
function __startExtrasPoller(ms = __extrasPollMs) {
  if (__extrasPollerId) return;
  __extrasPollMs = ms;
  if (process.env.NODE_ENV !== 'production') try { console.debug('[extrasPoller] starting with ms=', ms); } catch (_) {}
  // run immediately once
  (async () => {
    try {
      const data = await fetchExtras();
      __notifyExtrasSubscribers(data, { source: 'init' });
    } catch (e) { if (process.env.NODE_ENV !== 'production') try { console.debug('[extrasPoller] initial fetch failed', e?.message || e); } catch (_) {} }
  })();
  __extrasPollerId = setInterval(async () => {
    try {
      const data = await fetchExtras();
      __notifyExtrasSubscribers(data, { source: 'poll' });
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') try { console.debug('[extrasPoller] poll error', e?.message || e); } catch (_) {}
    }
  }, ms);
}

// Stop the poller
function __stopExtrasPoller() {
  if (!__extrasPollerId) return;
  clearInterval(__extrasPollerId);
  __extrasPollerId = null;
  if (process.env.NODE_ENV !== 'production') try { console.debug('[extrasPoller] stopped'); } catch (_) {}
}

// Public: subscribe to extras updates. Returns an unsubscribe function.
export function subscribeExtras(cb, options = {}) {
  const { immediate = true, pollMs = __extrasPollMs, delayMs = 0 } = options || {};
  __extrasSubscribers.add(cb);
  if (delayMs > 0 && !__extrasPollerId) {
    setTimeout(() => {
      if (__extrasSubscribers.size) __startExtrasPoller(pollMs);
    }, delayMs);
  } else {
    __startExtrasPoller(pollMs);
  }
  // if we have cached data, immediately notify
  if (immediate && __extrasCache && __extrasCache.data) {
    try { cb(__extrasCache.data, { source: 'cache' }); } catch (_) {}
  }
  return () => { unsubscribeExtras(cb); };
}

export function unsubscribeExtras(cb) {
  __extrasSubscribers.delete(cb);
  if (__extrasSubscribers.size === 0) __stopExtrasPoller();
}

const authStorage = {
  get(key) {
    try {
      // Prefer sessionStorage for ephemeral sessions, but fall back to localStorage
      const s = sessionStorage.getItem(key);
      if (s) return s;
      try {
        return localStorage.getItem(key);
      } catch (_) {
        return null;
      }
    } catch (_) {
      // sessionStorage may be unavailable in some contexts (e.g., third-party frames)
      try { return localStorage.getItem(key); } catch (_) { return null; }
    }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  },
};

export function clearGuestAuth() {
  authStorage.remove("oi_guest_token");
  authStorage.remove("oi_guest_name");
  authStorage.remove("oi_guest_expires_at");
  try {
    sessionStorage.removeItem("oi_access_request_id");
    sessionStorage.removeItem("oi_access_request_name");
  } catch (_) {}
}

/** Server-side guest Exit: revoke session + IP opt-out so auto-admit does not bounce them back in. */
export async function logoutGuest() {
  try {
    await api.post("/auth/guest/logout");
  } catch (_) {
    /* still clear client — best effort */
  }
  clearGuestAuth();
}

export function persistGuestAuth({ token, name, expiresInSeconds, expiresAt }) {
  if (!token) return;
  try { sessionStorage.setItem("oi_guest_token", token); } catch (_) {}
  try { localStorage.setItem("oi_guest_token", token); } catch (_) {}
  if (name != null) {
    try { sessionStorage.setItem("oi_guest_name", name); } catch (_) {}
    try { localStorage.setItem("oi_guest_name", name); } catch (_) {}
  }
  let expiresMs = null;
  if (expiresAt) {
    const parsed = Date.parse(expiresAt);
    if (!Number.isNaN(parsed)) expiresMs = parsed;
  }
  if (expiresMs == null && expiresInSeconds != null) {
    expiresMs = Date.now() + (Number(expiresInSeconds) * 1000);
  }
  if (expiresMs != null) {
    try { sessionStorage.setItem("oi_guest_expires_at", String(expiresMs)); } catch (_) {}
    try { localStorage.setItem("oi_guest_expires_at", String(expiresMs)); } catch (_) {}
  }
}

export function persistAdminSession(token) {
  if (!token) return;
  try { sessionStorage.setItem("oi_admin_token", token); } catch (_) {}
  // Never leave a stale localStorage admin token — it blocked Remember-me.
  try { localStorage.removeItem("oi_admin_token"); } catch (_) {}
}

export function clearAdminAuth({ clearRemember = false } = {}) {
  authStorage.remove("oi_admin_token");
  if (clearRemember) {
    try { localStorage.removeItem("oi_admin_remember_token"); } catch (_) {}
  }
}

// Attach admin OR guest token (mutually exclusive — admin wins).
api.interceptors.request.use((config) => {
  try {
    const at = authStorage.get("oi_admin_token");
    if (at) {
      config.headers["X-Admin-Token"] = at;
      // Do not also send a leftover guest token — confuses auth/state + last_seen.
      return config;
    }
    const gt = authStorage.get("oi_guest_token");
    if (gt) config.headers["X-Guest-Token"] = gt;

    // Dev-time tracing for extras endpoint to find duplicate callers
    if (process.env.NODE_ENV !== 'production' && config && config.url && String(config.url).includes('/tickers/extras')) {
      try {
        console.debug('[api] outgoing /tickers/extras request; config:', config);
        console.trace('[api] stack trace for /tickers/extras');
      } catch (_) {}
    }
  } catch (_) { /* ignore */ }
  return config;
});

// Global 401 handler — clear ephemeral session tokens so AuthGate can re-auth.
// Keep Remember-me token so the next load can restore the admin session.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const url = String(err?.config?.url || "");
      if (!shouldWipeTokensOn401(url)) {
        return Promise.reject(err);
      }
      try {
        clearAdminAuth({ clearRemember: false });
        clearGuestAuth();
      } catch (_) { /* ignore */ }
    }
    return Promise.reject(err);
  },
);

export const fetchStatus = () => api.get("/status").then((r) => r.data);
export const fetchOI = (idx) => api.get(`/oi/${idx}`).then((r) => r.data);
export const fetchOIChange = (idx, minutes, opts = {}) => {
  const params = { minutes };
  if (opts.expiry) params.expiry = opts.expiry;
  if (opts.also) params.also = Array.isArray(opts.also) ? opts.also.join(",") : opts.also;
  const timeout = opts.timeout;
  return api.get(`/oi/${idx}/change`, timeout ? { params, timeout } : { params }).then((r) => r.data);
};
export const fetchAlerts = () => api.get("/alerts").then((r) => r.data);
export const fetchTickers = () => api.get("/tickers").then((r) => r.data);
export const fetchJournalMonth = (year, month) =>
  api.get("/journal", { params: { year, month } }).then((r) => r.data);
export const fetchJournalYear = (year) =>
  api.get(`/journal/year/${year}`).then((r) => r.data);
export const fetchJournalDay = (day) =>
  api.get(`/journal/${day}`).then((r) => r.data);
export const saveJournalDay = (day, body) =>
  api.put(`/journal/${day}`, body).then((r) => r.data);
export const addJournalScreenshot = (day, body) =>
  api.post(`/journal/${day}/screenshot`, body).then((r) => r.data);
export const deleteJournalScreenshot = (day, id) =>
  api.delete(`/journal/${day}/screenshot/${id}`).then((r) => r.data);
export const fetchVRP = (idx, days = 30) =>
  api.get(`/vrp/${idx}`, { params: { days } }).then((r) => r.data);
export const fetchStraddle = (idx, opts = {}) =>
  api.get(`/straddle/${idx}`, { params: opts }).then((r) => r.data);
export const fetchStraddleTick = (idx, opts = {}) =>
  api.get(`/straddle/${idx}/tick`, { params: opts }).then((r) => r.data);
export const fetchStraddleHistory = (idx, minutes = 60, opts = {}) => {
  const params = { ...opts };
  if (minutes != null) params.minutes = minutes;
  return api.get(`/straddle/${idx}/history`, { params }).then((r) => r.data);
};
export const clearAlerts = () => api.delete("/alerts").then((r) => r.data);
export const saveCredentials = (api_key, access_token) =>
  api.post("/credentials", { api_key, access_token }).then((r) => r.data);
export const credentialsStatus = () =>
  api.get("/credentials/status").then((r) => r.data);
export const kiteVaultStatus = () =>
  api.get("/kite/vault").then((r) => r.data);
export const saveKiteVault = (payload) =>
  api.post("/kite/vault", payload).then((r) => r.data);
export const clearKiteVault = () =>
  api.delete("/kite/vault").then((r) => r.data);
export const refreshKiteSession = (request_token) =>
  api.post("/kite/refresh", { request_token }).then((r) => r.data);
export const userKiteStatus = () =>
  api.get("/kite/user/status").then((r) => r.data);
export const userKiteLoginUrl = () =>
  api.get("/kite/user/login-url").then((r) => r.data);
export const completeUserKiteSession = (request_token) =>
  api.post("/kite/user/session", { request_token }).then((r) => r.data);
export const disconnectUserKite = () =>
  api.post("/kite/user/disconnect").then((r) => r.data);
export const setMode = (mode) => api.post("/mode", { mode }).then((r) => r.data);