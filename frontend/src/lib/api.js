import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 20000 });

// Attach admin token (if any) to every request so backend can identify the admin.
api.interceptors.request.use((config) => {
  try {
    const tok = localStorage.getItem("oi_admin_token");
    if (tok) config.headers["X-Admin-Token"] = tok;
  } catch (_) { /* ignore */ }
  return config;
});

export const fetchStatus = () => api.get("/status").then((r) => r.data);
export const fetchOI = (idx) => api.get(`/oi/${idx}`).then((r) => r.data);
export const fetchOIChange = (idx, minutes) =>
  api.get(`/oi/${idx}/change`, { params: { minutes } }).then((r) => r.data);
export const fetchAlerts = () => api.get("/alerts").then((r) => r.data);
export const fetchVRP = (idx, days = 30) =>
  api.get(`/vrp/${idx}`, { params: { days } }).then((r) => r.data);
export const clearAlerts = () => api.delete("/alerts").then((r) => r.data);
export const saveCredentials = (api_key, access_token) =>
  api.post("/credentials", { api_key, access_token }).then((r) => r.data);
export const credentialsStatus = () =>
  api.get("/credentials/status").then((r) => r.data);
export const setMode = (mode) => api.post("/mode", { mode }).then((r) => r.data);
