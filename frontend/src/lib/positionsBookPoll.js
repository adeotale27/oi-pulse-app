/** When GET /positions should keep running (session day, open through catch-up). */

import { istMinutesOfDay, getMarketOpenMinute, getPositionsCatchupMinute } from "./marketTimes.js";
import {
  isJournalSessionDayIST,
  specialSessionOpenMinute,
  specialSessionCatchupMinute,
} from "./holidays.js";

function isoIST(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export function shouldPollPositionsBook(now = new Date()) {
  const iso = isoIST(now);
  if (!isJournalSessionDayIST(iso)) return false;
  const mins = istMinutesOfDay(now);
  const open = specialSessionOpenMinute(iso) ?? getMarketOpenMinute();
  const catchup = specialSessionCatchupMinute(iso) ?? getPositionsCatchupMinute();
  if (mins < open) return false;
  return mins < catchup;
}

export function openLiveCount(payload) {
  const rows = payload?.positions;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => !r.exited && Number(r.quantity) !== 0).length;
}

export const POSITIONS_BOOK_LIVE_MS = 2000;
export const POSITIONS_BOOK_IDLE_MS = 15000;
export const POSITIONS_BOOK_BOOT_MS = 1500;
export const POSITIONS_BOOK_MIN_MS = 1000;
export const POSITIONS_BOOK_MAX_MS = 3_600_000;

export function clampPositionsBookPollMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return POSITIONS_BOOK_LIVE_MS;
  return Math.max(POSITIONS_BOOK_MIN_MS, Math.min(POSITIONS_BOOK_MAX_MS, Math.round(n)));
}

export function positionsBookPollDelayMs({
  hasPayload,
  sessionOpen,
  pollMs,
  requestStartedAt,
  now = Date.now(),
}) {
  if (!hasPayload) return POSITIONS_BOOK_BOOT_MS;
  if (!sessionOpen) return 60_000;
  if (!requestStartedAt) return pollMs;
  return Math.max(0, pollMs - (now - requestStartedAt));
}
