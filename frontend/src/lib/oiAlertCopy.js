/** Short OI Change / huge-shift lines for toasts and the shift modal. */

export function oiPressureCopy({ index, bullish, windowLabel }) {
  const tilt = bullish ? "Puts adding — bullish" : "Calls adding — bearish";
  return {
    title: `${index} · ${tilt}`,
    description: `Last ${windowLabel}`,
  };
}

export function oiPctCopy({ index, side, pct, windowLabel }) {
  const name = side === "CE" ? "Calls" : "Puts";
  const moved = pct >= 0 ? "up" : "down";
  return {
    title: `${index} · ${name} ${moved} ${Math.abs(Number(pct) || 0).toFixed(1)}%`,
    description: `Last ${windowLabel}`,
  };
}

export function hugeShiftCopy(side, value) {
  const build = Number(value) > 0;
  if (side === "CE" && build) {
    return {
      headline: "Calls added near ATM",
      read: "Call sellers stepping in — resistance, bearish tilt.",
      tone: "rose",
    };
  }
  if (side === "CE" && !build) {
    return {
      headline: "Calls cut near ATM",
      read: "Call sellers leaving — resistance fading, bullish tilt.",
      tone: "emerald",
    };
  }
  if (side === "PE" && build) {
    return {
      headline: "Puts added near ATM",
      read: "Put sellers stepping in — support, bullish tilt.",
      tone: "emerald",
    };
  }
  return {
    headline: "Puts cut near ATM",
    read: "Put sellers leaving — support fading, bearish tilt.",
    tone: "rose",
  };
}

export function hugeShiftToastCopy({ index, side, value, window }) {
  const { headline } = hugeShiftCopy(side, value);
  return {
    title: `${index} · ${headline}`,
    description: `${window} min window`,
  };
}
