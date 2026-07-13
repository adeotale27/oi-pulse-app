import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// Polls /api/oi/{index}/change for each of the configured short windows
// (default 1/3/5 min) every `pollMs` and computes the aggregate ΔOI on the
// CE and PE side across the ATM-band (ATM, ATM+step, ATM-step). When either
// side crosses |thresholdAbs|, emits a shift event via `onShift`.
//
// One event is emitted at most once per (window,side,direction) inside the
// cooldown window so we don't spam the modal on every 30s pull.
export function useHugeShiftMonitor({
  index,
  expiry,
  windows = [1, 3, 5],
  thresholdAbs = 10_000_000,
  pollMs = 30000,
  cooldownMs = 120000,
  onShift,
  enabled = true,
}) {
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const cooldownRef = useRef({}); // key -> lastFiredAt
  const onShiftRef = useRef(onShift);
  onShiftRef.current = onShift;

  useEffect(() => {
    if (!enabled || !index) return;
    let cancelled = false;

    async function tick() {
      for (const w of windows) {
        try {
          const params = { minutes: w };
          if (expiry) params.expiry = expiry;
          const { data } = await api.get(`/oi/${index}/change`, { params });
          if (cancelled) return;
          const cur = data.current;
          const prev = data.previous;
          if (!cur || !prev) continue;
          const atm = cur.atm;
          // Detect step size from actual strike spacing (fallback to inference).
          const strikes = [...cur.strikes].sort((a, b) => a.strike - b.strike);
          if (strikes.length < 2) continue;
          const step = strikes[1].strike - strikes[0].strike;
          const band = new Set([atm, atm + step, atm - step]);
          const prevMap = new Map();
          (prev.strikes || []).forEach((s) => prevMap.set(s.strike, s));
          let ce = 0, pe = 0;
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
              side, // 'CE' or 'PE'
              value,
              direction: dir, // 'build' | 'unwind'
              atm,
              price: cur.price,
              contributing,
              at: new Date().toISOString(),
            });
          };
          if (Math.abs(ce) >= thresholdAbs) emit("CE", ce);
          if (Math.abs(pe) >= thresholdAbs) emit("PE", pe);
        } catch (e) {
          // Silent - the main dashboard poll surfaces errors already.
        }
      }
      if (!cancelled) setLastCheckedAt(new Date().toISOString());
    }

    tick(); // immediate first tick
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [index, expiry, enabled, pollMs, cooldownMs, thresholdAbs, JSON.stringify(windows)]);

  return { lastCheckedAt };
}
