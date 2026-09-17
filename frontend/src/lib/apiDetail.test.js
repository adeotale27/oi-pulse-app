import assert from "node:assert/strict";
import { apiDetail } from "./apiErrors.js";

const kite = "Kite dump took too long — tap Refresh, wait, then Enable again (first load can take a minute)";
const mi = "Market intelligence took too long. Tap Refresh — this feed is stored news, not a Kite dump.";

assert.equal(
  apiDetail({ code: "ECONNABORTED", message: "timeout of 10000ms exceeded", config: { url: "/market-intel" } }, "fallback"),
  mi,
);
assert.equal(
  apiDetail({ code: "ECONNABORTED", message: "timeout", config: { url: "/indices/enable" } }, "fallback"),
  kite,
);
assert.equal(
  apiDetail({ response: { status: 504 }, config: { url: "/market-intel?filter=all" } }, "feed failed"),
  mi,
);
assert.equal(
  apiDetail({ response: { status: 500, data: { detail: "Market intelligence feed failed" } }, config: { url: "/market-intel" } }, "x"),
  "Market intelligence feed failed",
);

console.log("apiDetail.test.js ok");
