/** Map Kite Connect failures into a desk-readable sentence. */

export function extractRequestToken(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/[?&]request_token=([^&\s#]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return s.split(/\s+/)[0];
}

export function httpErrorDetail(err) {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || x?.message || String(x)).join("; ");
  if (d && typeof d === "object") return d.msg || d.message || JSON.stringify(d);
  return String(err?.message || "");
}

export function friendlyKiteConnectError(raw) {
  const text = String(raw || "");
  const low = text.toLowerCase();
  if (low.includes("not enabled for the app")) {
    return (
      "This Zerodha user is not enabled on the Kite Connect app. " +
      "In developers.kite.tech open the app and add that user_id (or publish the app). " +
      "Until then only the app owner can Connect."
    );
  }
  if (low.includes("checksum")) {
    return (
      "API key and API secret do not match (Kite checksum failed). " +
      "Re-save the secret from developers.kite.tech for this exact API key, then login again."
    );
  }
  if (
    low.includes("tokenexception")
    || low.includes("already used")
    || low.includes("invalid token")
    || (low.includes("token") && (low.includes("invalid") || low.includes("expired") || low.includes("used")))
  ) {
    return (
      "This request_token was already used or expired. Open Kite login again and paste the new code immediately — it works only once."
    );
  }
  return text || "Kite login failed";
}
