import { loadIdOrder, saveIdOrder, moveIdBefore, moveIdByOffset, orderByIds } from "./tabOrder.js";

export const DESK_AI_LAYOUT_KEY = "oiDeskAiTileOrder.v3";
export const RADAR_AI_LAYOUT_KEY = "oiRadarAiTileOrder.v1";

export const DESK_AI_TILES = [
  { id: "coach", label: "What to do" },
  { id: "tape", label: "OI tape" },
  { id: "book", label: "Your book" },
  { id: "movers", label: "Heavyweights" },
  { id: "breadth", label: "Breadth" },
  { id: "news", label: "News" },
  { id: "watch", label: "Calendar" },
];

export function loadDeskAiTileOrder(key = DESK_AI_LAYOUT_KEY) {
  const saved = loadIdOrder(key);
  return orderByIds(DESK_AI_TILES, saved).map((t) => t.id);
}

export function saveDeskAiTileOrder(ids, key = DESK_AI_LAYOUT_KEY) {
  saveIdOrder(key, ids);
}

export function reorderDeskAiTiles(order, dragId, dropId, key = DESK_AI_LAYOUT_KEY) {
  const next = moveIdBefore(order, dragId, dropId);
  saveDeskAiTileOrder(next, key);
  return next;
}

export function nudgeDeskAiTile(order, id, delta, key = DESK_AI_LAYOUT_KEY) {
  const next = moveIdByOffset(order, id, delta);
  saveDeskAiTileOrder(next, key);
  return next;
}

export function firstSentence(text, max = 180) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const skip = /^(session focus)\b|^(tape|book|journal|memory|what changed|why it matters|option buyer|option seller|watch next|base case|contrary case|gap up|gap down|reassess if)\s*:?$|^(do|don't|dont)\s*:?$/i;
  const parts = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const cut = parts.find((s) => s && !skip.test(s)) || parts[0] || t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

export function formatEvidenceAsOf(value) {
  const numeric = typeof value === "number" || /^\d{10,13}$/.test(String(value || ""));
  const stamp = numeric
    ? Number(value) * (Number(value) < 10_000_000_000 ? 1000 : 1)
    : value;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)} IST`;
}

export function formatSessionDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return value || "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== match[0]) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function signedPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function buildSessionBrief({ market, extras, outside, oi = [], journal } = {}) {
  const phase = market?.phase;
  if (!phase) return null;
  const oiRows = Array.isArray(oi) ? oi : [];
  const corporate = Array.isArray(outside?.corporate) ? outside.corporate : [];
  const newsRows = Array.isArray(outside?.news) ? outside.news : [];

  const opening = phase === "pre_market" || phase === "pre_open";
  const closing = phase === "post_close" || phase === "holiday" || phase === "weekend";
  const title = opening
    ? "Before-open brief"
    : closing
      ? "Session closeout"
      : "Session brief";
  const items = [];
  const gift = extras?.gift_nifty;
  const giftChange = gift?.change_pct == null ? null : signedPercent(gift.change_pct);

  if (opening && giftChange) {
    items.push({
      id: "gift",
      label: "GIFT Nifty",
      text: `${giftChange} vs its previous close.`,
      source: `${gift?.source || "GIFT feed"}${gift?.is_proxy ? " proxy" : ""}`,
      asOf: gift?.ts,
      timeKind: "Fetched",
    });
  }

  for (const event of corporate.slice(0, opening ? 2 : 0)) {
    if (!event || !event.symbol) continue;
    const days = Number(event.days);
    items.push({
      id: `event-${event.symbol}-${event.days}`,
      label: "Scheduled company event",
      text: `${event.symbol} · ${event.event_type || "company event"}${Number.isFinite(days) ? (days === 0 ? " today" : ` in ${days}d`) : ""}${event.weightage ? ` · ${Number(event.weightage).toFixed(1)}% index weight` : ""}.`,
      source: "NSE corporate calendar",
    });
  }

  for (const news of newsRows.slice(0, opening ? 1 : 0)) {
    if (!news || !news.title) continue;
    items.push({
      id: `news-${news.title}`,
      label: "Latest wire",
      text: news.title,
      source: news.source || "News feed",
      asOf: news.published,
      timeKind: "Published",
    });
  }

  const sessionIsLive = !opening && !closing;
  if (sessionIsLive || closing) {
    for (const row of oiRows.slice(0, 2)) {
      if (!row?.idx) continue;
      items.push({
        id: `oi-${row.idx}`,
        label: `${row.idx} open-interest changes`,
        text: `Put-to-call OI ratio (PCR): ${Number.isFinite(Number(row.pcr)) ? Number(row.pcr).toFixed(2) : "—"} · Call OI change: ${Number.isFinite(Number(row.ceChg)) ? Number(row.ceChg).toLocaleString("en-IN") : "—"} · Put OI change: ${Number.isFinite(Number(row.peChg)) ? Number(row.peChg).toLocaleString("en-IN") : "—"}.`,
        source: "OI snapshot",
        asOf: row.asOf,
        timeKind: "Snapshot",
        status: row.dataStatus || null,
      });
    }
  }

  if (sessionIsLive) {
    const mover = outside?.movers?.[0];
    if (mover?.symbol && mover.pct != null && Number.isFinite(Number(mover.pct))) {
      const change = Number(mover.pct);
      items.push({
        id: `mover-${mover.symbol}`,
        label: "Cash heavyweight",
        text: `${mover.symbol} ${change >= 0 ? "+" : ""}${change.toFixed(2)}% vs previous close.`,
        source: outside?.quote_source || "Cash quote",
        asOf: outside?.at ? new Date(Number(outside.at) * 1000).toISOString() : null,
        timeKind: "Snapshot refreshed",
      });
    }
  }

  if (closing) {
    const bookedPct = phase === "post_close" ? journal?.day_booked_pct : null;
    if (bookedPct != null && Number.isFinite(Number(bookedPct))) {
      const value = Number(bookedPct);
      items.push({
        id: "journal",
        label: "Journal",
        text: `Booked ${value >= 0 ? "+" : ""}${value.toFixed(2)}% of wallet today.`,
        source: "Admin trade journal",
      });
    }
    items.push({
      id: "plan-followups",
      label: "Trade-plan follow-ups",
      text: "No trade-plan follow-up records are connected to Desk AI yet.",
    });
  }

  if (!items.length) {
    items.push({
      id: "coverage",
      label: opening ? "Pre-open data" : "Session data",
      text: opening
        ? "No GIFT move, timestamped headline, or tracked company event is available in this snapshot."
        : "No timestamped session evidence is available for this phase.",
    });
  }

  return {
    title,
    sessionDate: market?.session_anchor_date || null,
    phase,
    items: items.slice(0, 4),
    outsideAsOf: outside?.at ? new Date(Number(outside.at) * 1000).toISOString() : null,
    outsideSource: outside?.quote_source || null,
  };
}

export function findEvidenceConflicts({ extras, outside } = {}) {
  const gift = extras?.gift_nifty;
  const giftPct = Number(gift?.change_pct);
  const breadth = outside?.breadth?.NIFTY;
  const advancing = Number(breadth?.adv);
  const declining = Number(breadth?.dec);
  if (
    gift?.change_pct == null
    || !Number.isFinite(giftPct)
    || !Number.isFinite(advancing)
    || !Number.isFinite(declining)
    || advancing === declining
    || (giftPct === 0)
  ) {
    return [];
  }
  const giftUp = giftPct > 0;
  const breadthUp = advancing > declining;
  if (giftUp === breadthUp) return [];
  return [{
    id: "gift-nifty-breadth",
    text: `Mixed direction: GIFT Nifty is ${giftUp ? "up" : "down"} ${Math.abs(giftPct).toFixed(2)}% vs its previous close, while NIFTY breadth has ${advancing > declining ? "more advances" : "more declines"} (${advancing} / ${declining}).`,
    sources: [
      `${gift?.source || "GIFT feed"}${gift?.ts ? ` · fetched ${formatEvidenceAsOf(gift.ts)}` : ""}`,
      `NIFTY cash breadth${outside?.at ? ` · refreshed ${formatEvidenceAsOf(Number(outside.at) * 1000)}` : ""}`,
    ],
  }];
}

/** Split coach output into scenario and action sections. */
export function parseGuideSections(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const doLines = [];
  const dontLines = [];
  const scenarios = {
    baseCase: [],
    contraryCase: [],
    gapUp: [],
    gapDown: [],
    reassessIf: [],
    watchNext: [],
  };
  let mode = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const head = t.replace(/:$/, "").toUpperCase();
    const scenario = {
      "BASE CASE": "baseCase",
      "CONTRARY CASE": "contraryCase",
      "GAP UP": "gapUp",
      "GAP DOWN": "gapDown",
      "REASSESS IF": "reassessIf",
      "WATCH NEXT": "watchNext",
    }[head];
    if (scenario) {
      mode = scenario;
      continue;
    }
    if (head === "DO") {
      mode = "do";
      continue;
    }
    if (head === "DON'T" || head === "DONT" || head === "DO NOT") {
      mode = "dont";
      continue;
    }
    if (/^(TAPE|BOOK|JOURNAL|WHAT CHANGED|WHY IT MATTERS|OPTION BUYER|OPTION SELLER|WATCH NEXT)$/i.test(head)) {
      mode = null;
      continue;
    }
    const item = t.replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "");
    if (mode === "do") doLines.push(item);
    else if (mode === "dont") dontLines.push(item);
    else if (mode) scenarios[mode].push(item);
  }
  return {
    do: doLines.slice(0, 8),
    dont: dontLines.slice(0, 8),
    scenarios: Object.fromEntries(
      Object.entries(scenarios).map(([key, lines]) => [key, lines.slice(0, 2)]),
    ),
  };
}
