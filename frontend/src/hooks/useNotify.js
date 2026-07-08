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
    return audioCtxRef.current;
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
        new Notification(title, { body, silent: false });
      } catch (e) {
        console.error("Notification failed", e);
      }
    }
  }, []);

  useEffect(() => {
    // preload permission state
    requestPermission();
  }, [requestPermission]);

  return { beep, alarm, push, requestPermission };
}
