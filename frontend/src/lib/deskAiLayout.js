import { loadIdOrder, saveIdOrder, moveIdBefore, orderByIds } from "@/lib/tabOrder";

export const DESK_AI_LAYOUT_KEY = "oiDeskAiTileOrder.v1";

export const DESK_AI_TILES = [
  { id: "movers", label: "Heavyweights" },
  { id: "breadth", label: "Breadth" },
  { id: "news", label: "News" },
  { id: "watch", label: "Calendar" },
  { id: "coach", label: "What to do" },
];

export function loadDeskAiTileOrder() {
  const saved = loadIdOrder(DESK_AI_LAYOUT_KEY);
  return orderByIds(DESK_AI_TILES, saved).map((t) => t.id);
}

export function saveDeskAiTileOrder(ids) {
  saveIdOrder(DESK_AI_LAYOUT_KEY, ids);
}

export function reorderDeskAiTiles(order, dragId, dropId) {
  const next = moveIdBefore(order, dragId, dropId);
  saveDeskAiTileOrder(next);
  return next;
}

export function firstSentence(text, max = 180) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cut = t.split(/(?<=[.!?])\s/)[0] || t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}
