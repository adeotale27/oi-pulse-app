/** OI Change / huge-shift / board-alert lines for toasts and the shift modal. */

export function formatOiDelta(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/** Writer-side read: adding PE OI ≈ put selling (support / bullish further). */
export function oiSellerRead(bullish) {
  return bullish
    ? "Put selling increase — bullish further"
    : "Call selling increase — bearish further";
}

export function oiPressureLine(bullish) {
  return bullish
    ? "Bullish pressure (Put OI building)"
    : "Bearish pressure (Call OI building)";
}

export function oiPressureCopy({ index, bullish, windowLabel, pe, ce }) {
  const tilt = bullish ? "Puts adding — bullish" : "Calls adding — bearish";
  const lines = [
    oiSellerRead(bullish),
    `${oiPressureLine(bullish)} in last ${windowLabel}`,
  ];
  if (pe != null && ce != null) {
    lines.push(`PE ${formatOiDelta(pe)} · CE ${formatOiDelta(ce)}`);
  }
  return {
    title: `${index} · ${tilt}`,
    description: lines.join("\n"),
  };
}

export function oiBoardAlertCopy({ index, direction, windowLabel, strikes, pe, ce }) {
  const dir = direction || "OI reversal spike";
  const win = windowLabel || "15 mins";
  let peSum = pe;
  let ceSum = ce;
  if ((peSum == null || ceSum == null) && Array.isArray(strikes) && strikes.length) {
    peSum = strikes.reduce((s, x) => s + Number(x.pe_abs || 0), 0);
    ceSum = strikes.reduce((s, x) => s + Number(x.ce_abs || 0), 0);
  }
  const bits = [];
  if (peSum != null && ceSum != null) {
    bits.push(`PE ${formatOiDelta(peSum)} · CE ${formatOiDelta(ceSum)}`);
  }
  const bullish = /bullish/i.test(dir);
  if (/put oi building|bullish/i.test(dir)) bits.unshift(oiSellerRead(true));
  else if (/call oi building|bearish/i.test(dir)) bits.unshift(oiSellerRead(false));
  return {
    title: `${index}: ${dir} in last ${win}`,
    description: bits.join(" · "),
  };
}

export function oiPctCopy({ index, side, pct, windowLabel, pe, ce }) {
  const name = side === "CE" ? "Calls" : "Puts";
  const moved = pct >= 0 ? "up" : "down";
  const lines = [`Last ${windowLabel}`];
  if (pe != null && ce != null) {
    lines.push(`PE ${formatOiDelta(pe)} · CE ${formatOiDelta(ce)}`);
  }
  return {
    title: `${index} · ${name} ${moved} ${Math.abs(Number(pct) || 0).toFixed(1)}%`,
    description: lines.join(" · "),
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
