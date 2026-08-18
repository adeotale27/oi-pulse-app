/**
 * Shared kite / market mode badge copy.
 * Prefer inclusive "markets" language — desk tracks NSE (NIFTY/BANK) and BSE (SENSEX).
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
      label: "MARKETS LIVE",
      short: "LIVE",
      tone: "live",
      title:
        "MARKETS LIVE — Kite connected and the cash/F&O session is open (NSE + BSE indices). OI polls while the session is open.",
    };
  }
  return {
    label: "MARKETS CLOSED",
    short: "CLOSED",
    tone: "closed",
    title:
      "MARKETS CLOSED — Kite is connected, but the cash/F&O session is closed (after hours / weekend / holiday). Board shows the last session snapshot; OI polling pauses until next open. GIFT NIFTY may still print; India VIX follows NSE hours (09:15–15:40 IST).",
  };
}

export function kiteModeBadgeClass(tone) {
  if (tone === "live") return "bg-emerald-600 hover:bg-emerald-600";
  if (tone === "closed") return "bg-slate-600 hover:bg-slate-600";
  return "bg-red-600 hover:bg-red-600";
}
