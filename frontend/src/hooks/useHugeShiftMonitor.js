import { useEffect, useRef, useState } from "react";

/**
 * Evaluates ATM±1 CE/PE ΔOI from a change-bundle (current + also_windows)
 * produced by the main /oi/.../change poll. Does NOT issue its own API calls —
 * that was causing 3× duplicate /change requests every poll cycle.
 *
 * Emits at most one event per (window, side, direction) inside the cooldown.
 */
export function useHugeShiftMonitor({
  index,
  windows = [1, 3, 5],
  thresholdAbs = 10_000_000,
  cooldownMs = 120000,
  onShift,
  enabled = true,
  /** { current, also_windows: { "1": { previous, ... }, ... } } from loadOI */
  changeBundle = null,
}) {
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const cooldownRef = useRef({});
  const onShiftRef = useRef(onShift);
  onShiftRef.current = onShift;
  const lastBundleTsRef = useRef(null);

  useEffect(() => {
    if (!enabled || !changeBundle?.current) return;
    const cur = changeBundle.current;
    const bundleTs = cur.timestamp || null;
    // Skip re-eval on identical snapshot (spot-price updates shouldn't re-fire).
    if (bundleTs && bundleTs === lastBundleTsRef.current) return;
    lastBundleTsRef.current = bundleTs;

    const also = changeBundle.also_windows || {};
    for (const w of windows) {
      try {
        const entry = also[String(w)];
        const prev = entry?.previous;
        if (!cur || !prev) continue;
        const atm = cur.atm;
        const strikes = [...(cur.strikes || [])].sort((a, b) => a.strike - b.strike);
        if (strikes.length < 2) continue;
        const step = strikes[1].strike - strikes[0].strike;
        const band = new Set([atm, atm + step, atm - step]);
        const prevMap = new Map();
        (prev.strikes || []).forEach((s) => prevMap.set(s.strike, s));
        let ce = 0;
        let pe = 0;
        const contributing = [];
        for (const s of strikes) {
          if (!band.has(s.strike)) continue;
          const p = prevMap.get(s.strike);
          if (!p) continue;
          const dCE = s.ce_oi - p.ce_oi;
          const dPE = s.pe_oi - p.pe_oi;
          ce += dCE;
          pe += dPE;
          contributing.push({ strike: s.strike, ce_delta: dCE, pe_delta: dPE });
        }
        const now = Date.now();
        const emit = (side, value) => {
          const dir = value > 0 ? "build" : "unwind";
          const key = `${index}:${w}:${side}:${dir}`;
          const last = cooldownRef.current[key] || 0;
          if (now - last < cooldownMs) return;
          cooldownRef.current[key] = now;
          onShiftRef.current?.({
            id: `${key}:${now}`,
            index,
            window: w,
            side,
            value,
            direction: dir,
            atm,
            price: cur.price,
            contributing,
            at: new Date().toISOString(),
          });
        };
        if (Math.abs(ce) >= thresholdAbs) emit("CE", ce);
        if (Math.abs(pe) >= thresholdAbs) emit("PE", pe);
      } catch (_) {
        // Silent — main dashboard poll surfaces errors.
      }
    }
    setLastCheckedAt(new Date().toISOString());
  }, [changeBundle, enabled, index, windows, thresholdAbs, cooldownMs]);

  return { lastCheckedAt };
}
