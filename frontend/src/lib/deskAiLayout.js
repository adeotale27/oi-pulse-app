import { loadIdOrder, saveIdOrder, moveIdBefore, moveIdByOffset, orderByIds } from "@/lib/tabOrder";

export const DESK_AI_LAYOUT_KEY = "oiDeskAiTileOrder.v1";
export const RADAR_AI_LAYOUT_KEY = "oiRadarAiTileOrder.v1";

export const DESK_AI_TILES = [
  { id: "movers", label: "Heavyweights" },
  { id: "breadth", label: "Breadth" },
  { id: "news", label: "News" },
  { id: "watch", label: "Calendar" },
  { id: "coach", label: "What to do" },
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
  const cut = t.split(/(?<=[.!?])\s/)[0] || t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}
