import assert from "node:assert/strict";
import { extractRequestToken, friendlyKiteConnectError } from "./kiteConnectError.js";

assert.equal(
  extractRequestToken("https://kite.zerodha.com/?request_token=abc123&action=login&status=success"),
  "abc123",
);
assert.equal(extractRequestToken("kZeAFDKGya0ptsD7XkwSE58IIInsA5vh"), "kZeAFDKGya0ptsD7XkwSE58IIInsA5vh");

assert.match(friendlyKiteConnectError("TokenException: Invalid checksum"), /secret/);
assert.match(friendlyKiteConnectError("TokenException: Token is invalid or has already been used"), /already used/);

console.log("kiteConnectError.test.js: ok");
