const KITE_DUMP_TIMEOUT =
  "Kite dump took too long — tap Refresh, wait, then Enable again (first load can take a minute)";
const MI_TIMEOUT =
  "Market intelligence took too long. Tap Refresh — this feed is stored news, not a Kite dump.";

function requestPath(e) {
  return `${e?.config?.url || ""} ${e?.config?.baseURL || ""}`;
}

function isTimeoutLike(e) {
  const code = e?.code;
  const status = e?.response?.status;
  return (
    code === "ECONNABORTED" ||
    /timeout/i.test(String(e?.message || "")) ||
    status === 504 ||
    status === 502
  );
}

/** FastAPI `detail` can be a string, list of objects, or missing on timeout. */
export function apiDetail(e, fallback = "Request failed") {
  if (isTimeoutLike(e)) {
    const path = requestPath(e);
    if (/market-intel/i.test(path)) return MI_TIMEOUT;
    if (/\/indices|index-management|\/inspect|\/enable|kite/i.test(path)) return KITE_DUMP_TIMEOUT;
    return fallback || "Request timed out — tap Refresh and try again";
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
