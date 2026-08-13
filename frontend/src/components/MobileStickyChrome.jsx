import { useMemo, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

const INDEX_SHORT = {
  NIFTY: "NIFTY",
  SENSEX: "SENSEX",
  BANKNIFTY: "BNF",
};

const INDEX_DOT = {
  NIFTY: "bg-sky-500",
  SENSEX: "bg-amber-500",
  BANKNIFTY: "bg-emerald-500",
};

/**
 * Mobile-only sticky context bar.
 * Keeps brand + selected index + dashboard tabs visible while VIX/GIFT
 * tiles and charts scroll underneath. Desktop is unaffected (md:hidden).
 *
 * Tabs support drag-and-drop reorder when `onReorder` is provided.
 */
export default function MobileStickyChrome({
  activeIndex,
  indices = ["NIFTY", "SENSEX", "BANKNIFTY"],
  onSelectIndex,
  spotPrice,
  spotPrices = {},
  atm,
  expiry,
  changePct,
  tabs = [],
  activeTab,
  onChangeTab,
  onReorder,
  onFavorite,
  onMove,
  onResetLayout,
  marketOpen = false,
  infoTilesOpen,
  onToggleInfoTiles,
  infoTiles,
  pnlSlot,
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClickRef = useRef(false);

  const canReorder = typeof onReorder === "function";
  const canFavorite = typeof onFavorite === "function";
  const canMove = typeof onMove === "function";
  const pct =
    changePct != null && Number.isFinite(Number(changePct))
      ? Number(changePct)
      : null;
  const pctCls =
    pct == null
      ? "text-slate-400"
      : pct > 0
        ? "text-emerald-600"
        : pct < 0
          ? "text-rose-600"
          : "text-slate-500";
  const expiryShort = useMemo(() => {
    if (!expiry) return null;
    try {
      const [y, m, d] = String(expiry).split("-").map(Number);
      if (!y || !m || !d) return expiry;
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
    } catch {
      return expiry;
    }
  }, [expiry]);

  const list = useMemo(() => indices.filter(Boolean), [indices]);

  const onDragStart = (e, id) => {
    if (!canReorder) return;
    skipClickRef.current = false;
    setDraggingId(id);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* noop */
    }
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const onDragOverTab = (e, id) => {
    if (!canReorder || !draggingId) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      /* noop */
    }
    if (overId !== id) setOverId(id);
  };

  const onDropTab = (e, dropId) => {
    if (!canReorder) return;
    e.preventDefault();
    let from = draggingId;
    try {
      from = e.dataTransfer.getData("text/plain") || from;
    } catch {
      /* noop */
    }
    setDraggingId(null);
    setOverId(null);
    if (from && dropId && from !== dropId) {
      skipClickRef.current = true;
      onReorder(from, dropId);
    }
  };

  const onTabClick = (id) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    onChangeTab?.(id);
  };

  const onTabDoubleClick = (e, id) => {
    if (!canFavorite) return;
    e.preventDefault();
    e.stopPropagation();
    skipClickRef.current = true;
    onFavorite(id);
    onChangeTab?.(id);
  };

  const onTabKeyDown = (e, id) => {
    if (!canMove || !e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(id, e.key === "ArrowLeft" ? -1 : 1);
  };

  const tipParts = [];
  if (canReorder) tipParts.push("Drag to reorder");
  if (canFavorite) tipParts.push("double-click to pin first");
  if (canMove) tipParts.push("Alt+←/→ to nudge");
  tipParts.push("click to open");
  const tabTitle = tipParts.join(" · ");

  return (
    <div
      data-testid="mobile-sticky-chrome"
      className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md dark:border-slate-700 dark:bg-slate-950/95"
    >
      <div className="px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-2">
        <div
          className="min-w-0 flex-1 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(list.length, 1)}, minmax(0, 1fr))` }}
          data-testid="mobile-index-switcher"
        >
          {list.map((idx) => {
            const active = idx === activeIndex;
            const raw = active
              ? (spotPrices?.[idx] ?? spotPrice)
              : spotPrices?.[idx];
            const spotN = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
            const spotTxt = spotN != null
              ? spotN.toLocaleString("en-IN", { maximumFractionDigits: 2 })
              : null;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectIndex?.(idx)}
                data-testid={`mobile-index-${idx}`}
                className={`min-w-0 rounded-xl border px-1.5 py-1.5 text-left transition-colors ${
                  active
                    ? "border-emerald-400 bg-emerald-50 shadow-sm dark:border-emerald-700 dark:bg-emerald-950/40"
                    : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                }`}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${INDEX_DOT[idx] || "bg-slate-400"}`} />
                  <span className={`truncate text-[10px] font-bold ${active ? "text-emerald-900 dark:text-emerald-100" : "text-slate-700 dark:text-slate-200"}`}>
                    {INDEX_SHORT[idx] || idx}
                  </span>
                </div>
                <div className={`mt-0.5 font-mono-data text-[10px] tabular-nums truncate ${active ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}`}>
                  {spotTxt || (active ? "—" : "tap")}
                </div>
              </button>
            );
          })}
        </div>
        {pnlSlot ? (
          <div className="shrink-0 pl-1.5 border-l border-slate-200 dark:border-slate-700" data-testid="mobile-sticky-pnl">
            {pnlSlot}
          </div>
        ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5 font-mono-data text-[10px] text-slate-500" data-testid="mobile-index-meta">
          {pct != null && (
            <span className={pctCls}>
              {pct > 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          )}
          {atm != null && <span>ATM {Number(atm).toLocaleString("en-IN")}</span>}
          {expiryShort && <span>Exp {expiryShort}</span>}
          {marketOpen ? <span className="text-emerald-600">Live</span> : <span>Last session</span>}
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1 px-1.5 py-1">
          <div
            data-testid="mobile-sticky-tabs"
            className="tabs-scroll flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Dashboard views — drag, double-click, or Alt+arrows to reorder"
          >
            {tabs.map((t) => {
              const active = t.v === activeTab;
              const isOver = canReorder && overId === t.v && draggingId && draggingId !== t.v;
              return (
                <button
                  key={t.v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`tab-${t.v}`}
                  draggable={canReorder}
                  onDragStart={(e) => onDragStart(e, t.v)}
                  onDragEnd={onDragEnd}
                  onDragOver={(e) => onDragOverTab(e, t.v)}
                  onDragLeave={() => {
                    if (overId === t.v) setOverId(null);
                  }}
                  onDrop={(e) => onDropTab(e, t.v)}
                  onClick={() => onTabClick(t.v)}
                  onDoubleClick={(e) => onTabDoubleClick(e, t.v)}
                  onKeyDown={(e) => onTabKeyDown(e, t.v)}
                  title={tabTitle}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors min-h-[32px] ${
                    canReorder ? "cursor-grab active:cursor-grabbing" : ""
                  } ${draggingId === t.v ? "opacity-40" : ""} ${
                    isOver ? "ring-2 ring-emerald-400" : ""
                  } ${
                    active
                      ? "bg-emerald-600 text-white dark:bg-emerald-500"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {t.l}
                </button>
              );
            })}
          </div>
          {typeof onResetLayout === "function" && (
            <button
              type="button"
              data-testid="btn-reset-layout-mobile"
              onClick={onResetLayout}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:hover:bg-slate-800"
              title="Reset tab order, tile order, and expiry list height"
              aria-label="Reset layout"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {typeof onToggleInfoTiles === "function" && (
            <button
              type="button"
              onClick={() => onToggleInfoTiles(!infoTilesOpen)}
              title={infoTilesOpen ? "Hide holiday / FII / event tiles" : "Show holiday / FII / event tiles"}
              aria-label={infoTilesOpen ? "Hide events" : "Show events"}
              aria-expanded={!!infoTilesOpen}
              data-testid="btn-toggle-info-tiles-mobile"
              className={`inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ${
                infoTilesOpen
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "text-slate-400 hover:bg-slate-50 hover:text-emerald-700 dark:hover:bg-slate-800"
              }`}
            >
              {infoTilesOpen ? <ChevronRight className="h-3.5 w-3.5 rotate-90" /> : <ChevronLeft className="h-3.5 w-3.5" />}
              Events
            </button>
          )}
          </div>
        </div>
      )}

      {typeof onToggleInfoTiles === "function" && infoTilesOpen && (
        <div
          className="border-t border-slate-100 px-2 py-2 dark:border-slate-800"
          data-testid="mobile-info-tiles-bar"
        >
          <div
            className="min-w-0 relative z-30"
            data-testid="mobile-info-tiles-wrap"
          >
            {infoTiles}
          </div>
        </div>
      )}
    </div>
  );
}
