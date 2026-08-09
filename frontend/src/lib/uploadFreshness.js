/**
 * Upload freshness rules for Index Risk / Admin advisories.
 *
 * NSE event calendar should be refreshed about twice a month so mid-month
 * corporate events are not missed. Index constituents change less often.
 */
export const UPLOAD_FRESHNESS = {
  events: {
    key: "events",
    label: "NSE event calendar",
    shortLabel: "NSE events",
    staleAfterDays: 15,
    advice:
      "Refresh the 1-month NSE event calendar about every 15 days so Index Risk does not miss mid-month results / board meetings.",
  },
  nifty50: {
    key: "nifty50",
    label: "Nifty 50 constituents",
    shortLabel: "Nifty 50",
    staleAfterDays: 30,
    advice: "Re-upload Nifty 50 constituents about every 30 days after index reconstitution / weightage updates.",
  },
  banknifty: {
    key: "banknifty",
    label: "Bank Nifty constituents",
    shortLabel: "Bank Nifty",
    staleAfterDays: 30,
    advice: "Re-upload Bank Nifty constituents about every 30 days after index reconstitution / weightage updates.",
  },
  sensex: {
    key: "sensex",
    label: "Sensex constituents",
    shortLabel: "Sensex",
    staleAfterDays: 30,
    advice: "Re-upload Sensex constituents about every 30 days after index reconstitution / weightage updates.",
  },
};

export const UPLOAD_ORDER = ["nifty50", "banknifty", "sensex", "events"];

export function uploadAgeDays(uploadedAt, now = new Date()) {
  if (!uploadedAt) return null;
  try {
    const d = new Date(uploadedAt);
    if (Number.isNaN(d.getTime())) return null;
    const ms = now.getTime() - d.getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

export function isUploadStale(key, uploadedAt, now = new Date()) {
  const rule = UPLOAD_FRESHNESS[key];
  if (!rule) return false;
  const age = uploadAgeDays(uploadedAt, now);
  if (age == null) return true; // never uploaded
  return age >= rule.staleAfterDays;
}

/**
 * @returns {Array<{ key, label, shortLabel, staleAfterDays, advice, uploadedAt, ageDays, stale, never }>}
 */
export function evaluateUploadFreshness(meta, now = new Date()) {
  return UPLOAD_ORDER.map((key) => {
    const rule = UPLOAD_FRESHNESS[key];
    const row = meta?.[key] || {};
    const uploadedAt = row.uploaded_at || null;
    const ageDays = uploadAgeDays(uploadedAt, now);
    const never = !uploadedAt;
    const stale = never || (ageDays != null && ageDays >= rule.staleAfterDays);
    return {
      key,
      label: rule.label,
      shortLabel: rule.shortLabel,
      staleAfterDays: rule.staleAfterDays,
      advice: rule.advice,
      uploadedAt,
      sourceFilename: row.source_filename || null,
      ageDays,
      never,
      stale,
    };
  });
}

export function formatUploadAge(ageDays, never) {
  if (never || ageDays == null) return "never uploaded";
  if (ageDays === 0) return "uploaded today";
  if (ageDays === 1) return "1 day old";
  return `${ageDays} days old`;
}
