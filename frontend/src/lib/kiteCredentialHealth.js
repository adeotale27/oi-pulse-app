/**
 * Real Kite credential / token problems only.
 * Brief tracker mode=offline flaps must NOT look like a disconnect when
 * credentials are still loaded and the token is fine.
 *
 * kite_token_issue is token-death only (not "no credentials"). Missing
 * credentials are signaled by has_kite_credentials=false.
 */
export function isKiteCredentialProblem(status) {
  if (!status) return false;
  if (!status.has_kite_credentials) return true;
  if (status.kite_token_issue === true) return true;
  const err = String(status.last_error || "").toLowerCase();
  if (!err) return false;
  // Ignore soft "please re-auth after key rotate" copy unless credentials are gone
  // (handled above). Match real Kite auth failures only.
  return (
    err.includes("tokenexception")
    || err.includes("invalid token")
    || err.includes("incorrect `api_key`")
    || err.includes("incorrect api_key")
    || (err.includes("access_token") && (err.includes("incorrect") || err.includes("invalid") || err.includes("expired")))
    || err.includes("unauthorized")
    || err.includes("forbidden")
  );
}

export function kiteCredentialTitle(status) {
  if (!status?.has_kite_credentials) return "Kite not connected";
  return "Kite token issue";
}
