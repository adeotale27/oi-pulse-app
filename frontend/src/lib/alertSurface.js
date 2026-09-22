/** Collapse in-app toasts while the desk tab is in the background. */

let hiddenCount = 0;
let hiddenLast = null;
let pendingSound = null;

export function deskTabHidden() {
  return typeof document !== "undefined" && document.hidden;
}

function deskPhone() {
  try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; }
}

function showPhoneAlert(detail) {
  try { window.dispatchEvent(new CustomEvent("oi-mobile-alert", { detail })); } catch { /* noop */ }
}

export function surfaceAlert({
  toastFn,
  title,
  description,
  duration = 7000,
  soundKind,
  playSound,
  pushFn,
  pushTitle,
  pushBody,
  skipToast = false,
}) {
  try { pushFn?.(pushTitle, pushBody); } catch { /* noop */ }
  if (deskTabHidden()) {
    if (!skipToast) {
      hiddenCount += 1;
      hiddenLast = { toastFn, title, description, duration };
    }
    pendingSound = soundKind || pendingSound;
    return "queued";
  }
  if (!skipToast) {
    // OI alerts need to be readable without hiding the mobile index/header
    // workspace. The app-owned tray retains a compact alert count instead of
    // stacking normal Sonner notifications from the top edge.
    if (deskPhone()) {
      showPhoneAlert({ title, description, duration });
      try { if (soundKind) playSound?.(soundKind); } catch { /* noop */ }
      return "shown";
    }
    toastFn(title, { description, duration });
  }
  try { if (soundKind) playSound?.(soundKind); } catch { /* noop */ }
  return skipToast ? "sound" : "shown";
}

export function flushHiddenAlerts({ toast, playSound }) {
  if (!hiddenCount) return 0;
  const n = hiddenCount;
  const last = hiddenLast;
  const sound = pendingSound;
  hiddenCount = 0;
  hiddenLast = null;
  pendingSound = null;
  if (n === 1 && last) {
    if (deskPhone()) showPhoneAlert(last);
    else last.toastFn(last.title, { description: last.description, duration: last.duration });
  } else if (last) {
    if (deskPhone()) showPhoneAlert({
      title: `${n} alerts while you were away`,
      description: last.title,
      duration: 9000,
    });
    else toast.message(`${n} alerts while you were away`, {
      description: last.title,
      duration: 9000,
    });
  }
  try { if (sound) playSound(sound); } catch { /* noop */ }
  return n;
}
