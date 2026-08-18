import { isTransientHttpError, shouldWipeTokensOn401, optimisticDeskAuthState, liveDeskSession } from "./authBoot.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(isTransientHttpError({ code: "ECONNABORTED" }));
assert(isTransientHttpError({ response: { status: 520 } }));
assert(isTransientHttpError({ response: { status: 524 } }));
assert(isTransientHttpError({ message: "timeout of 8000ms exceeded" }));
assert(!isTransientHttpError({ response: { status: 401 } }));
assert(!isTransientHttpError({ response: { status: 403 } }));
assert(!shouldWipeTokensOn401("/oi/NIFTY/change"));
assert(!shouldWipeTokensOn401("/auth/state"));
assert(!shouldWipeTokensOn401("/auth/remember-login"));
assert(shouldWipeTokensOn401("/auth/logout"));
assert(optimisticDeskAuthState() == null);
assert(liveDeskSession() == null);
console.log("authBoot ok");
