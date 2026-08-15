/** Boot/auth helpers — keep a desk session through origin 520/timeouts. */

export function isTransientHttpError(err) {
  const status = err?.response?.status;
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  if (code === "ECONNABORTED" || code === "ERR_NETWORK" || code === "ETIMEDOUT") return true;
  if (/timeout/i.test(msg) || /network error/i.test(msg)) return true;
  if (status == null) return true;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 520 || status === 521 || status === 522 || status === 523 || status === 524) return true;
  return status >= 500;
}

export function storedDeskSession() {
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_admin_token")) {
      return { is_admin: true, is_guest: false };
    }
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_guest_token")) {
      return { is_admin: false, is_guest: true };
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem("oi_admin_remember_token")) {
      return { is_admin: true, is_guest: false, remember: true };
    }
  } catch (_) { /* noop */ }
  return null;
}

export function shouldWipeTokensOn401(url) {
  const u = String(url || "");
  if (!u.includes("/auth/")) return false;
  if (u.includes("/auth/remember-login")) return false;
  if (u.includes("/auth/login")) return false;
  if (u.includes("/auth/guest")) return false;
  if (u.includes("/auth/state")) return false;
  return true;
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
