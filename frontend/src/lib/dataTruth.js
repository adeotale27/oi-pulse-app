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

/** Seconds until the next poll, given snapshot age and poll cadence. */
export function nextRefreshInSeconds(ageSeconds, pollMs = 15000) {
  const pollS = Math.max(1, Math.round(Number(pollMs) / 1000) || 15);
  const age = Math.max(0, Math.round(Number(ageSeconds) || 0));
  const rem = pollS - (age % pollS);
  return rem === 0 ? pollS : rem;
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
  pollMs = 15000,
} = {}) {
  const ds = dataStatus || {};
  const kite = mode === "kite";
  const open = marketOpen === true;
  const asOfIso = snapshotTs || null;
  const asOfClock = formatIstClock(asOfIso, true);
  const dataDate = ds.data_date || null;
  let age = ds.cache_age_seconds;
  if (asOfIso) {
    const drift = (now.getTime() - new Date(asOfIso).getTime()) / 1000;
    if (Number.isFinite(drift) && drift >= 0) age = drift;
  }

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
      asOfLabel: asOfClock ? `Live data as of ${asOfClock} IST` : dataDate ? `Session ${dataDate}` : "—",
      detail: "Kite API required · board is not live",
      tone: "offline",
    };
  }

  if (isLive && open) {
    const left = nextRefreshInSeconds(age, pollMs);
    const ageNote = age != null ? `next (${left}s)` : "Updating on schedule";
    return {
      mode: "LIVE",
      badge: "LIVE",
      asOfLabel: asOfClock ? `Live data as of ${asOfClock} IST` : "Live data as of —",
      detail: `Market open · ${ageNote}`,
      tone: "live",
    };
  }

  if (!open) {
    return {
      mode: "LAST_SESSION",
      badge: "LAST SESSION",
      asOfLabel: dataDate || (asOfClock ? `${asOfClock} IST` : "Prior close"),
      detail: "",
      tone: "session",
    };
  }

  // Market open but cache stale / not marked live
  const reason = ds.stale_reason || "stale_cache";
  return {
    mode: "STALE",
    badge: "STALE",
    asOfLabel: asOfClock ? `Last update ${asOfClock} IST` : "Last update unknown",
    detail: reason === "stale_cache"
      ? "Market open but snapshot lagging — treat as delayed"
      : String(reason).replace(/_/g, " "),
    tone: "warn",
  };
}
