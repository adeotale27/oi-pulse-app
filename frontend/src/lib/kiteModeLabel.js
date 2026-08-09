/**
 * Shared kite / market mode badge copy.
 * Prefer "market session" language over "KITE · CLOSED", which traders read as
 * a broker outage rather than NSE cash/F&O hours.
 */
export function kiteModeBadge(mode, marketOpen) {
  if (mode !== "kite") {
    return {
      label: "OFFLINE",
      short: "OFFLINE",
      tone: "offline",
      title:
        "OFFLINE — no Kite credentials. Connect via Kite API to pull live OI.",
    };
  }
  if (marketOpen) {
    return {
      label: "NSE LIVE",
      short: "LIVE",
      tone: "live",
      title:
        "NSE LIVE — Kite connected and the NSE cash/F&O session is open. OI polls while the market is open.",
    };
  }
  return {
    label: "NSE CLOSED",
    short: "CLOSED",
    tone: "closed",
    title:
      "NSE CLOSED — Kite is connected, but the NSE session is closed (after hours / weekend / holiday). Board shows the last session snapshot; OI polling pauses until next open. GIFT/VIX may still update.",
  };
}

export function kiteModeBadgeClass(tone) {
  if (tone === "live") return "bg-emerald-600 hover:bg-emerald-600";
  if (tone === "closed") return "bg-slate-600 hover:bg-slate-600";
  return "bg-red-600 hover:bg-red-600";
}
