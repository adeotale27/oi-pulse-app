// Local (browser-side) settings for the new huge-shift / velocity / gamma-wall /
// institutional-detector features. Persisted in localStorage so a page refresh
// keeps user overrides. Backend `/api/settings` is untouched (that governs the
// server-side OI reversal engine).

const KEY = "oiPulseSettings.v1";

export const DEFAULT_OI_SETTINGS = {
  // Huge OI shift: aggregate |ΔOI| across ATM & ATM±1 strikes (CE or PE side)
  // that triggers the blocking siren modal. Default: 1 Cr = 10,000,000.
  hugeShiftAbs: 10_000_000,
  // Windows (minutes) to monitor for huge shift. Default 1 / 3 / 5.
  hugeShiftWindows: [1, 3, 5],
  // Gamma wall: min single-strike CE-or-PE OI gain within 3 min.
  gammaWallAbs: 200_000, // 2 lakh
  gammaWallMinutes: 3,
  // OI velocity thresholds (OI per minute).
  velocityFastMin: 50_000,
  velocityMediumMin: 10_000,
  // Institutional detector.
  instOiMin: 50_000,
  instPremiumCr: 10, // ₹10 Cr notional premium value of the OI
  // Lot sizes (Indian F&O standard as configured by user).
  lotSize: { NIFTY: 65, SENSEX: 20, BANKNIFTY: 30 },
};

export function loadOISettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_OI_SETTINGS };
    const parsed = JSON.parse(raw);
    // Fill any missing keys with defaults for forward compatibility.
    return { ...DEFAULT_OI_SETTINGS, ...parsed, lotSize: { ...DEFAULT_OI_SETTINGS.lotSize, ...(parsed.lotSize || {}) } };
  } catch {
    return { ...DEFAULT_OI_SETTINGS };
  }
}

export function saveOISettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

// Helper to classify a per-minute OI velocity.
export function classifyVelocity(oiPerMin, s = DEFAULT_OI_SETTINGS) {
  const v = Math.abs(oiPerMin);
  if (v >= s.velocityFastMin) return { level: "fast", label: "Fast Build-up", emoji: "🔥" };
  if (v >= s.velocityMediumMin) return { level: "medium", label: "Medium", emoji: "🟢" };
  return { level: "slow", label: "Slow", emoji: "⚪" };
}
