import assert from "node:assert/strict";
import { isKiteCredentialProblem } from "./kiteCredentialHealth.js";

assert.equal(
  isKiteCredentialProblem({ has_kite_credentials: false }),
  true,
  "missing credentials",
);

assert.equal(
  isKiteCredentialProblem({
    has_kite_credentials: true,
    kite_token_issue: true,
    last_error: null,
  }),
  true,
  "explicit token issue",
);

assert.equal(
  isKiteCredentialProblem({
    has_kite_credentials: true,
    kite_token_issue: false,
    last_error: null,
  }),
  false,
  "healthy live session",
);

assert.equal(
  isKiteCredentialProblem({
    has_kite_credentials: true,
    kite_token_issue: false,
    last_error: "TokenException: Incorrect 'api_key' or 'access_token'.",
  }),
  true,
  "TokenException mismatch",
);

assert.equal(
  isKiteCredentialProblem({
    has_kite_credentials: true,
    kite_token_issue: false,
    last_error:
      "API key updated — complete Kite login (request_token) or paste a fresh access_token to go live.",
  }),
  false,
  "soft rotate guidance must not look like TokenException",
);

console.log("kiteCredentialHealth.test.js: ok");
