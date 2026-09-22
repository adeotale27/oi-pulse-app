import { api } from "@/lib/api";

const TTL_MS = 45_000;
let cached = null;
let cachedAt = 0;
let inFlight = null;

export async function fetchGlobalMarkets({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = api.get("/global-markets/overview", { timeout: 12000 })
    .then(({ data }) => { cached = data; cachedAt = Date.now(); return data; })
    .finally(() => { inFlight = null; });
  return inFlight;
}
