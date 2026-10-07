/**
 * One Kite /positions GET for header Today P&L and the Positions page.
 * Two independent pollers were applying different quote snapshots (tens of rupees apart).
 */

import { api } from "./api";
import { publishTodayPnl } from "./todayPnl";
import {
  shouldPollPositionsBook,
  openLiveCount,
  POSITIONS_BOOK_LIVE_MS,
  clampPositionsBookPollMs,
  positionsBookPollDelayMs,
} from "./positionsBookPoll";

export {
  shouldPollPositionsBook,
  openLiveCount,
  POSITIONS_BOOK_LIVE_MS,
  clampPositionsBookPollMs,
};

let inflight = null;
let lastPayload = null;
let lastAt = 0;
let timer = null;
let startCount = 0;
let pollMs = POSITIONS_BOOK_LIVE_MS;
let lastRequestStartedAt = 0;
const listeners = new Set();

function notify(payload) {
  lastPayload = payload;
  lastAt = Date.now();
  const open = openLiveCount(payload);
  const total = payload?.pnl_today?.total;
  if (Number.isFinite(Number(total))) publishTodayPnl({ total: Number(total), open });
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  });
}

export function readPositionsBook() {
  return lastPayload;
}

export function subscribePositionsBook(fn) {
  listeners.add(fn);
  if (lastPayload) fn(lastPayload);
  return () => listeners.delete(fn);
}

export const KITE_CONNECTED_EVENT = "oi-kite-connected";

export function notifyKiteConnected() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(KITE_CONNECTED_EVENT));
}

/** Force a /positions pull after Kite login (Header may already own the poller). */
export function refreshPositionsBook() {
  lastAt = 0;
  if (inflight) return inflight.then(() => fetchPositionsBook({ force: true }));
  return fetchPositionsBook({ force: true });
}

export async function fetchPositionsBook({ force = false, settleExpiry = false } = {}) {
  if (inflight && !settleExpiry) return inflight;
  if (!force && !settleExpiry && lastPayload && Date.now() - lastAt < 900) return lastPayload;
  // Schedule from request start so a slow response doesn't add another full poll interval.
  lastRequestStartedAt = Date.now();
  const req = api
    .get("/positions", {
      timeout: 12000,
      params: { _: Date.now(), ...(settleExpiry ? { settle_expiry: 1 } : {}) },
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    })
    .then((r) => {
      const payload = r.data;
      notify(payload);
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = req;
  return inflight;
}

function scheduleNext() {
  if (startCount <= 0) return;
  if (timer) clearTimeout(timer);
  const session = shouldPollPositionsBook();
  const ms = positionsBookPollDelayMs({
    hasPayload: Boolean(lastPayload),
    sessionOpen: session,
    pollMs,
    requestStartedAt: lastRequestStartedAt,
  });
  timer = setTimeout(() => {
    const liveNow = shouldPollPositionsBook();
    const pull = liveNow || !lastPayload;
    const done = () => scheduleNext();
    if (pull) {
      fetchPositionsBook({ force: true }).catch(() => {}).finally(done);
    } else {
      done();
    }
  }, ms);
}

/** Admin Positions auto-refresh (ms). Used while the cash session is live. */
export function setPositionsBookPollMs(ms) {
  pollMs = clampPositionsBookPollMs(ms);
  if (startCount > 0) scheduleNext();
}

/** Keep GET /positions alive on every dashboard page while the cash session is live. */
export function startPositionsBookPolling() {
  startCount += 1;
  if (startCount !== 1) return;
  scheduleNext();
}

export function stopPositionsBookPolling() {
  startCount = Math.max(0, startCount - 1);
  if (startCount > 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
