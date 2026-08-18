import { useCallback, useEffect, useRef } from "react";

/**
 * Small hook that wraps browser notifications + a beep sound.
 * Uses the Notification API and the Web Audio API for the beep.
 */
export function useNotify() {
  const audioCtxRef = useRef(null);

  const ensureAudio = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") {
      try { ctx.resume(); } catch { /* autoplay lock until a click */ }
    }
    return ctx;
  };

  const beep = useCallback((freq = 880, duration = 0.18) => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.start();
    o.stop(ctx.currentTime + duration + 0.02);
  }, []);

  const alarm = useCallback(() => {
    beep(880, 0.16);
    setTimeout(() => beep(1180, 0.18), 180);
    setTimeout(() => beep(660, 0.22), 380);
  }, [beep]);

  // Distinct, urgent siren pattern for VVIP "huge OI shift" alerts.
  // Descending 2-tone whoop x 3 with wider dynamics so it is unmistakably
  // different from the normal alarm().
  const siren = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const playSweep = (t0, freqA, freqB, dur, gain = 0.35) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freqA, t0);
      o.frequency.exponentialRampToValueAtTime(freqB, t0 + dur);
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };
    // Three whoops rising-falling for ~1.8s total.
    playSweep(now + 0.00, 520, 1200, 0.30);
    playSweep(now + 0.32, 1200, 520, 0.30);
    playSweep(now + 0.66, 520, 1200, 0.30);
    playSweep(now + 0.98, 1200, 520, 0.30);
    playSweep(now + 1.32, 520, 1200, 0.30);
    playSweep(now + 1.64, 1200, 520, 0.30);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }, []);

  const push = useCallback((title, body) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(title, {
          body,
          silent: typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches,
        });
      } catch (e) {
        console.error("Notification failed", e);
      }
    }
  }, []);

  const permission = () => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  };

  return { beep, alarm, siren, push, requestPermission, permission };
}
