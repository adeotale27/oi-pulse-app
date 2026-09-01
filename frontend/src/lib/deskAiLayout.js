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
  const skip = /^(session focus)\b|^(tape|book|journal|memory|what changed|why it matters|option buyer|option seller|watch next)\s*:?$|^(do|don't|dont)\s*:?$/i;
  const parts = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const cut = parts.find((s) => s && !skip.test(s)) || parts[0] || t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

/** Split rules/LLM coach into DO / DON'T lists for the strip. */
export function parseGuideSections(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const doLines = [];
  const dontLines = [];
  let mode = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const head = t.replace(/:$/, "").toUpperCase();
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
  }
  return { do: doLines.slice(0, 8), dont: dontLines.slice(0, 8) };
}
