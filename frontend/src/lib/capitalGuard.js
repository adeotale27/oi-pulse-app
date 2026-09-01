/** Day-loss circuit for Positions + Desk AI. Wallet % after charges, not leftover margin. */

export const DAY_LOSS = {
  caution: -3,
  stopAdds: -5,
  defend: -8,
};

export function leftoverIsCrumbs(leftover, wallet) {
  const left = Number(leftover);
  const w = Number(wallet);
  return Number.isFinite(left) && Number.isFinite(w) && w >= 1 && left / w < 0.005;
}

export function classifyDayCapital({ bookedPct, leftover, wallet } = {}) {
  const pct = Number(bookedPct);
  const crumbs = leftoverIsCrumbs(leftover, wallet);
  let level = "ok";
  if (Number.isFinite(pct) && pct <= DAY_LOSS.defend) level = "defend";
  else if ((Number.isFinite(pct) && pct <= DAY_LOSS.stopAdds) || crumbs) level = "stopAdds";
  else if (Number.isFinite(pct) && pct <= DAY_LOSS.caution) level = "caution";

  const pctLabel = Number.isFinite(pct) ? `${pct.toFixed(2)}% of wallet` : null;
  if (level === "ok") {
    return {
      level,
      crumbs,
      headline: null,
      doLine: null,
      dontLines: [],
      stopSellIdeas: false,
    };
  }
  if (level === "caution") {
    return {
      level,
      crumbs,
      headline: `Soft day (${pctLabel}). Size down. Do not double the book to “win it back”.`,
      doLine: `Capital caution: booked ${pctLabel}. Cut size on any new short — revenge sizing is how −3% becomes −11%.`,
      dontLines: ["Do not add a second index or extra lots because the day is red."],
      stopSellIdeas: false,
    };
  }
  if (level === "stopAdds") {
    return {
      level,
      crumbs,
      headline: crumbs && !(Number.isFinite(pct) && pct <= DAY_LOSS.stopAdds)
        ? "Kite leftover is margin crumbs, not capital. Stop new shorts."
        : `Day stop (${pctLabel}). No new shorts. Only reduce or flatten.`,
      doLine: crumbs
        ? "Capital: leftover margin is tiny vs wallet — treat the day as done for new risk. Reduce if a short is too close."
        : `Capital stop: booked ${pctLabel}. Freeze new shorts and CAS Live. Only manage what is open.`,
      dontLines: [
        "Do not sell more premium to recover the day.",
        "Do not treat Funds available as dry powder — that is leftover SPAN room.",
      ],
      stopSellIdeas: true,
    };
  }
  return {
    level,
    crumbs,
    headline: `Capital event (${pctLabel}). The session is for defence, not ideas.`,
    doLine: `Capital event: booked ${pctLabel}. Stop the day. No new shorts, no Auto-Trade Live, no “one more lot”. Reduce stressed legs only.`,
    dontLines: [
      "Do not average losers or switch index to make it back.",
      "Do not confuse ₹ leftover with wallet — wallet already took the hit.",
    ],
    stopSellIdeas: true,
  };
}

/** Merge today's booked % / leftover from GET /positions onto the 30-day journal compact. */
export function attachDayCapital(journal, posData) {
  const pnl = posData?.pnl_today;
  const funds = posData?.funds && typeof posData.funds === "object" ? posData.funds : {};
  const day_booked_pct = pnl?.booked_pct ?? funds.booked_pct;
  const day_booked = pnl?.booked_after_charges ?? pnl?.booked;
  const wallet = funds.base ?? funds.total;
  const leftover = funds.net;
  const has =
    day_booked_pct != null || day_booked != null || wallet != null || leftover != null;
  if (!has) return journal || null;
  return {
    ...(journal || {}),
    day_booked_pct: day_booked_pct != null ? Number(day_booked_pct) : journal?.day_booked_pct ?? null,
    day_booked: day_booked != null ? Number(day_booked) : journal?.day_booked ?? null,
    wallet: wallet != null ? Number(wallet) : journal?.wallet ?? null,
    leftover: leftover != null ? Number(leftover) : journal?.leftover ?? null,
  };
}
