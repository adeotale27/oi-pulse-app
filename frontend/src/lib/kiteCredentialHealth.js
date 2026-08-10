/**
 * Real Kite credential / token problems only.
 * Brief tracker mode=offline flaps must NOT look like a disconnect when
 * credentials are still loaded and the token is fine.
 */
export function isKiteCredentialProblem(status) {
  if (!status) return false;
  if (!status.has_kite_credentials) return true;
  if (status.kite_token_issue === true) return true;
  const err = String(status.last_error || "").toLowerCase();
  if (!err) return false;
  return (
    err.includes("tokenexception")
    || err.includes("invalid token")
    || err.includes("access_token")
    || err.includes("incorrect `api_key`")
    || err.includes("incorrect api_key")
    || err.includes("unauthorized")
    || err.includes("forbidden")
  );
}

export function kiteCredentialTitle(status) {
  if (!status?.has_kite_credentials) return "Kite not connected";
  return "Kite token issue";
}
