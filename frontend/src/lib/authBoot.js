/** Boot/auth helpers — keep a desk session through origin 520/timeouts. */

export function isTransientHttpError(err) {
  const status = err?.response?.status;
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  if (code === "ECONNABORTED" || code === "ERR_CANCELED" || code === "ERR_NETWORK" || code === "ETIMEDOUT") return true;
  if (/timeout/i.test(msg) || /network error/i.test(msg) || /aborted/i.test(msg)) return true;
  if (looksLikeHtmlBody(err?.response?.data) || looksLikeHtmlBody(err?.data)) return true;
  if (status == null) return true;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 520 || status === 521 || status === 522 || status === 523 || status === 524) return true;
  return status >= 500;
}

export function looksLikeHtmlBody(data) {
  if (typeof data === "string") return /^\s*</.test(data);
  return false;
}

/** True only for a real /auth/state JSON object — never a Cloudflare 502 HTML page. */
export function isAuthStatePayload(data) {
  return !!(
    data
    && typeof data === "object"
    && !Array.isArray(data)
    && typeof data.is_admin === "boolean"
  );
}

export function deskUnavailableAuthState() {
  return {
    loading: false,
    auth_unavailable: true,
    requires_login: false,
    public_access_open: false,
    is_admin: false,
    is_guest: false,
    needs_guest_name: false,
  };
}

export function storedSessionAuthState() {
  const stored = storedDeskSession();
  if (!stored) return deskUnavailableAuthState();
  return {
    loading: false,
    requires_login: false,
    public_access_open: true,
    is_admin: !!stored.is_admin,
    is_guest: !!stored.is_guest,
    needs_guest_name: false,
  };
}

export function failOpenAuthState() {
  const stored = storedDeskSession();
  if (stored) return storedSessionAuthState();
  return deskUnavailableAuthState();
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

/** Session tokens only — Remember-me still needs /auth/remember-login before API calls. */
export function liveDeskSession() {
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_admin_token")) {
      return { is_admin: true, is_guest: false };
    }
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_guest_token")) {
      return { is_admin: false, is_guest: true };
    }
  } catch (_) { /* noop */ }
  return null;
}

export function optimisticDeskAuthState() {
  const live = liveDeskSession();
  if (!live) return null;
  return {
    loading: false,
    requires_login: false,
    public_access_open: true,
    is_admin: !!live.is_admin,
    is_guest: !!live.is_guest,
    needs_guest_name: false,
  };
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

/** Never let boot wait forever on a hung origin (preview /auth/state 0-byte stall).
 *  Pass `abort` so axios/XHR is actually cancelled when the budget expires
 *  (axios timeout alone often does not abort a Cloudflare 502 that never finishes). */
export function withTimeout(promise, ms, label = "timeout", abort) {
  let t;
  const killer = new Promise((_, reject) => {
    t = setTimeout(() => {
      try { abort?.(); } catch (_) { /* noop */ }
      const err = new Error(label);
      err.code = "ECONNABORTED";
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), killer]).finally(() => clearTimeout(t));
}
