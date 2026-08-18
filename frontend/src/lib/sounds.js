// Per-alert-type sound preferences persisted in localStorage.
// Each key maps to a sound-pattern id defined below.

import { ALERT_BEEP_WAV } from "./alertBeep";

export const SOUND_PATTERNS = [
  { id: "beep",    label: "Single beep (soft)" },
  { id: "double",  label: "Double beep" },
  { id: "chime",   label: "Chime (ascending)" },
  { id: "alarm",   label: "Alarm (3-tone urgent)" },
  { id: "siren",   label: "Siren (VVIP whoop x3)" },
  { id: "buzz",    label: "Buzz (short low tone)" },
  { id: "none",    label: "Silent (no sound)" },
];

const KEY = "oiSoundPrefs.v1";

export const DEFAULT_SOUND_PREFS = {
  reversal:    "alarm",
  huge_shift:  "siren",
  gamma_wall:  "chime",
  institution: "double",
  velocity:    "buzz",
  adjustment:  "alarm",
};

export function loadSoundPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SOUND_PREFS };
    return { ...DEFAULT_SOUND_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SOUND_PREFS }; }
}

export function saveSoundPrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) { /* noop */ }
}

function isIosLike() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

// Player accepts the pattern id and plays via a shared AudioContext.
let ctxRef = null;
let htmlBeep = null;
function ensureCtx() {
  if (typeof window === "undefined") return null;
  try {
    if (!ctxRef) ctxRef = new (window.AudioContext || window.webkitAudioContext)();
    return ctxRef;
  } catch { return null; }
}

function ensureHtmlBeep() {
  if (typeof Audio === "undefined") return null;
  if (!htmlBeep) {
    htmlBeep = new Audio(ALERT_BEEP_WAV);
    htmlBeep.preload = "auto";
    htmlBeep.setAttribute("playsinline", "true");
  }
  return htmlBeep;
}

function playHtmlBeep() {
  const a = ensureHtmlBeep();
  if (!a) return;
  try {
    a.currentTime = 0;
    a.volume = 0.7;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch { /* autoplay lock */ }
}

function beepOne(ctx, t0, freq, dur, gain = 0.25, type = "sine") {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export function unlockSounds() {
  const a = ensureHtmlBeep();
  if (a) {
    try {
      a.muted = true;
      a.volume = 0;
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
          a.volume = 0.7;
        }).catch(() => {});
      }
    } catch { /* noop */ }
  }
  const ctx = ensureCtx();
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === "suspended" || ctx.state === "interrupted") {
    return ctx.resume().then(() => true).catch(() => false);
  }
  return Promise.resolve(true);
}

export function playPattern(id) {
  if (id === "none") return;
  const ctx = ensureCtx();
  if (!ctx) return;
  const run = () => {
  const now = ctx.currentTime;
  switch (id) {
    case "beep":
      beepOne(ctx, now, 880, 0.14, 0.2, "sine");
      break;
    case "double":
      beepOne(ctx, now, 880, 0.10, 0.22);
      beepOne(ctx, now + 0.16, 880, 0.10, 0.22);
      break;
    case "chime":
      beepOne(ctx, now,        523, 0.14, 0.24, "sine");
      beepOne(ctx, now + 0.15, 659, 0.14, 0.24);
      beepOne(ctx, now + 0.30, 784, 0.18, 0.24);
      break;
    case "alarm":
      beepOne(ctx, now,        880, 0.16, 0.28, "square");
      beepOne(ctx, now + 0.18, 1180, 0.18, 0.28);
      beepOne(ctx, now + 0.38, 660, 0.22, 0.28);
      break;
    case "siren": {
      const sweep = (t0, a, b, dur) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(a, t0);
        o.frequency.exponentialRampToValueAtTime(b, t0 + dur);
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.start(t0); o.stop(t0 + dur + 0.05);
      };
      sweep(now, 520, 1200, 0.30);
      sweep(now + 0.32, 1200, 520, 0.30);
      sweep(now + 0.66, 520, 1200, 0.30);
      sweep(now + 0.98, 1200, 520, 0.30);
      break;
    }
    case "buzz":
      beepOne(ctx, now, 220, 0.18, 0.28, "sawtooth");
      break;
    default: beepOne(ctx, now, 880, 0.12, 0.2);
  }
  };
  if (ctx.state === "suspended") {
    ctx.resume().then(run).catch(() => {});
    return;
  }
  run();
}

export function playForAlert(kind) {
  const prefs = loadSoundPrefs();
  const pattern = prefs[kind] || DEFAULT_SOUND_PREFS[kind] || "beep";
  if (pattern === "none") return;
  const run = () => {
    if (isIosLike()) {
      playHtmlBeep();
      if (pattern === "double" || pattern === "alarm" || pattern === "chime" || pattern === "siren") {
        setTimeout(playHtmlBeep, 170);
      }
      if (pattern === "alarm" || pattern === "siren") setTimeout(playHtmlBeep, 340);
      return;
    }
    playPattern(pattern);
  };
  const ctx = ensureCtx();
  if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
    ctx.resume().then(run).catch(() => { if (isIosLike()) playHtmlBeep(); });
    return;
  }
  run();
}
