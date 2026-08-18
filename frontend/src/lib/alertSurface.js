/** Collapse in-app toasts while the desk tab is in the background. */

let hiddenCount = 0;
let hiddenLast = null;
let pendingSound = null;

export function deskTabHidden() {
  return typeof document !== "undefined" && document.hidden;
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
    last.toastFn(last.title, { description: last.description, duration: last.duration });
  } else if (last) {
    toast.message(`${n} alerts while you were away`, {
      description: last.title,
      duration: 9000,
    });
  }
  try { if (sound) playSound(sound); } catch { /* noop */ }
  return n;
}
