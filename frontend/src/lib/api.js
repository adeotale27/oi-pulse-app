import axios from "axios";

// Backend URL resolution:
// 1. Use REACT_APP_BACKEND_URL if provided at build time (Emergent preview).
// 2. Otherwise fall back to the current window origin. This lets the app work
//    on custom domains (e.g. https://www.aaisnamkeen.com) without a rebuild,
//    provided the domain proxies `/api/*` to the FastAPI backend.
const _envBackend = (process.env.REACT_APP_BACKEND_URL || "").trim();
const _hasEnvBackend = _envBackend && _envBackend !== "undefined" && _envBackend !== "null";
const BACKEND_URL = _hasEnvBackend
  ? _envBackend
  : (typeof window !== "undefined" ? window.location.origin : "");
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 20000 });

// Attach admin & guest tokens (if any) to every request.
api.interceptors.request.use((config) => {
  try {
    const at = localStorage.getItem("oi_admin_token");
    if (at) config.headers["X-Admin-Token"] = at;
    const gt = localStorage.getItem("oi_guest_token");
    if (gt) config.headers["X-Guest-Token"] = gt;
  } catch (_) { /* ignore */ }
  return config;
});

// Global 401 handler — session likely expired; clear tokens so AuthGate re-prompts.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      try {
        // Only wipe admin token on auth-state failures; keep vault etc. untouched otherwise.
        const url = (err.config?.url) || "";
        if (url.includes("/auth/state")) {
          localStorage.removeItem("oi_admin_token");
        }
      } catch (_) { /* ignore */ }
    }
    return Promise.reject(err);
  },
);

export const fetchStatus = () => api.get("/status").then((r) => r.data);
export const fetchOI = (idx) => api.get(`/oi/${idx}`).then((r) => r.data);
export const fetchOIChange = (idx, minutes) =>
  api.get(`/oi/${idx}/change`, { params: { minutes } }).then((r) => r.data);
export const fetchAlerts = () => api.get("/alerts").then((r) => r.data);
export const fetchVRP = (idx, days = 30) =>
  api.get(`/vrp/${idx}`, { params: { days } }).then((r) => r.data);
export const fetchStraddle = (idx, opts = {}) =>
  api.get(`/straddle/${idx}`, { params: opts }).then((r) => r.data);
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
export const setMode = (mode) => api.post("/mode", { mode }).then((r) => r.data);