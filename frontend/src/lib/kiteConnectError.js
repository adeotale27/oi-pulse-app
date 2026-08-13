/** Map Kite Connect failures into a desk-readable sentence. */
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
  if (low.includes("checksum") || (low.includes("token") && (low.includes("invalid") || low.includes("expired")))) {
    return "Kite login expired or was reused. Tap Connect Zerodha and try once more.";
  }
  return text || "Kite login failed";
}
