/** Shared Today P&L so every header chip shows the same figure. */
export const TODAY_PNL_EVENT = "oi-today-pnl";

export function publishTodayPnl(payload) {
  if (typeof window === "undefined") return;
  const total = Number(payload?.total);
  if (!Number.isFinite(total)) return;
  const next = {
    total,
    open: Number.isFinite(Number(payload?.open)) ? Number(payload.open) : 0,
  };
  window.__oiTodayPnl = next;
  window.dispatchEvent(new CustomEvent(TODAY_PNL_EVENT, { detail: next }));
}

export function readTodayPnlCache() {
  if (typeof window === "undefined") return null;
  const cached = window.__oiTodayPnl;
  if (!cached || !Number.isFinite(Number(cached.total))) return null;
  return {
    total: Number(cached.total),
    open: Number(cached.open) || 0,
  };
}
