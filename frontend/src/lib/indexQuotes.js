/** Per-index LTP. Never reuse another index's OI snapshot price. */
export function pickIndexLtp({ idx, live, tickerLtp, current } = {}) {
  const liveN = live == null ? null : Number(live);
  if (liveN != null && Number.isFinite(liveN) && liveN !== 0) return liveN;
  const tickN = tickerLtp == null ? null : Number(tickerLtp);
  if (tickN != null && Number.isFinite(tickN) && tickN !== 0) return tickN;
  const curIdx = String(current?.index || "").toUpperCase();
  const want = String(idx || "").toUpperCase();
  if (want && curIdx === want) {
    const c = Number(current?.price);
    if (Number.isFinite(c) && c !== 0) return c;
  }
  return null;
}
