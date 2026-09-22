import { api } from "@/lib/api";

// Both the desk page and right rail can display ADRs. Keep one short-lived
// snapshot so mounting the second view neither duplicates the request nor
// leaves it waiting for a poll owned by the first view.
const TTL_MS = 15_000;
let cachedSnapshot = null;
let cachedAt = 0;
let inFlight = null;
const listeners = new Set();

export function readAdrSnapshot() {
  return cachedSnapshot;
}

export function subscribeAdrSnapshot(listener) {
  listeners.add(listener);
  if (cachedSnapshot) listener(cachedSnapshot);
  return () => listeners.delete(listener);
}

function publish(snapshot) {
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
  listeners.forEach((listener) => listener(snapshot));
}

export async function fetchAdrSnapshot({ force = false } = {}) {
  if (!force && cachedSnapshot && Date.now() - cachedAt < TTL_MS) return cachedSnapshot;
  if (inFlight) return inFlight;
  inFlight = api.get("/adrs", { timeout: 15000 })
    .then(({ data }) => {
      publish(data);
      return data;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
