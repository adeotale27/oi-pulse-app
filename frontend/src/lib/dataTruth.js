// Trust / audit labels for the data-as-of strip.
// Guests (and admins) must never confuse LAST SESSION with LIVE.

export function formatIstClock(iso, withSeconds = false) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hour12: false,
    });
  } catch {
    return null;
  }
}

/**
 * Build an impossible-to-misread truth layer from API data_status + market flags.
 *
 * @returns {{
 *   mode: 'LIVE' | 'LAST_SESSION' | 'STALE' | 'OFFLINE' | 'NO_DATA',
 *   badge: string,
 *   asOfLabel: string,
 *   detail: string,
 *   tone: 'live' | 'session' | 'warn' | 'offline',
 * }}
 */
export function buildDataTruth({
  dataStatus,
  marketOpen,
  mode, // kite | offline
  snapshotTs,
  now = new Date(),
} = {}) {
  const ds = dataStatus || {};
  const kite = mode === "kite";
  const open = marketOpen === true;
  const asOfIso = snapshotTs || null;
  const asOfClock = formatIstClock(asOfIso, true);
  const dataDate = ds.data_date || null;
  const age = ds.cache_age_seconds;

  // Prefer server is_live when present; otherwise derive.
  const staleAfter =
    Number(ds.stale_after_seconds) > 0 ? Number(ds.stale_after_seconds) : 90;
  let isLive = ds.is_live === true;
  if (ds.is_live == null) {
    isLive = kite && open && (age == null || age <= staleAfter);
  }

  if (!asOfIso && !dataDate) {
    return {
      mode: "NO_DATA",
      badge: "NO DATA",
      asOfLabel: "—",
      detail: kite ? "Waiting for first snapshot" : "Connect Kite API for live OI",
      tone: "offline",
    };
  }

  if (!kite) {
    return {
      mode: "OFFLINE",
      badge: "OFFLINE",
      asOfLabel: asOfClock ? `data as of ${asOfClock} IST` : dataDate ? `session ${dataDate}` : "—",
      detail: "API key required · not live",
      tone: "offline",
    };
  }

  if (isLive && open) {
    const ageNote = age != null ? ` · ${Math.round(age)}s ago` : "";
    return {
      mode: "LIVE",
      badge: "LIVE",
      asOfLabel: asOfClock ? `data as of ${asOfClock} IST` : "data as of —",
      detail: `Market open · polling${ageNote}`,
      tone: "live",
    };
  }

  if (!open) {
    return {
      mode: "LAST_SESSION",
      badge: "LAST SESSION",
      asOfLabel: dataDate
        ? `${dataDate}${asOfClock ? ` · ${asOfClock} IST` : ""}`
        : asOfClock
          ? `${asOfClock} IST`
          : "prior close",
      detail: "Not live · OI polling paused until next open · GIFT/VIX may still update",
      tone: "session",
    };
  }

  // Market open but cache stale / not marked live
  const reason = ds.stale_reason || "stale_cache";
  return {
    mode: "STALE",
    badge: "STALE",
    asOfLabel: asOfClock ? `last tick ${asOfClock} IST` : "last tick unknown",
    detail: reason === "stale_cache"
      ? "Market open but snapshot lagging — not guaranteed live"
      : String(reason).replace(/_/g, " "),
    tone: "warn",
  };
}
