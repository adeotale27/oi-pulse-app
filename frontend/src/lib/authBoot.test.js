import { isTransientHttpError, shouldWipeTokensOn401, optimisticDeskAuthState, liveDeskSession, withTimeout, isAuthStatePayload, looksLikeHtmlBody, failOpenAuthState } from "./authBoot.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(isTransientHttpError({ code: "ECONNABORTED" }));
assert(isTransientHttpError({ response: { status: 520 } }));
assert(isTransientHttpError({ response: { status: 524 } }));
assert(isTransientHttpError({ response: { status: 502 } }));
assert(isTransientHttpError({ message: "timeout of 8000ms exceeded" }));
assert(isTransientHttpError({ response: { status: 200, data: "<!DOCTYPE html>" } }));
assert(!isTransientHttpError({ response: { status: 401 } }));
assert(!isTransientHttpError({ response: { status: 403 } }));
assert(!shouldWipeTokensOn401("/oi/NIFTY/change"));
assert(!shouldWipeTokensOn401("/auth/state"));
assert(!shouldWipeTokensOn401("/auth/remember-login"));
assert(shouldWipeTokensOn401("/auth/logout"));
assert(optimisticDeskAuthState() == null);
assert(liveDeskSession() == null);
assert(looksLikeHtmlBody("<!DOCTYPE html>\n<title>502</title>"));
assert(looksLikeHtmlBody("  <html class=\"no-js\">"));
assert(!looksLikeHtmlBody('{"is_admin":false}'));
assert(!isAuthStatePayload("<!DOCTYPE html>"));
assert(!isAuthStatePayload({ ok: true }));
assert(isAuthStatePayload({ is_admin: false, is_guest: false, public_access_open: true }));
assert(failOpenAuthState().loading === false);
assert(failOpenAuthState().auth_unavailable === true);

const t0 = Date.now();
try {
  await withTimeout(new Promise(() => {}), 40, "auth budget");
  assert(false, "withTimeout should reject");
} catch (e) {
  assert(e.code === "ECONNABORTED");
  assert(Date.now() - t0 < 200);
}

let aborted = false;
try {
  await withTimeout(new Promise(() => {}), 40, "abort me", () => { aborted = true; });
} catch (_) { /* expected */ }
assert(aborted, "withTimeout must abort the in-flight request");
console.log("authBoot ok");
