import { useMemo, useState, useRef, useCallback } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";
import useClickOutside from "@/hooks/useClickOutside";

const INDEX_LABEL = {
  NIFTY: "NIFTY",
  SENSEX: "SENSEX",
  BANKNIFTY: "BANKNIFTY",
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
  const [open, setOpen] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClickRef = useRef(false);
  const wrapRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  const canReorder = typeof onReorder === "function";
  const canFavorite = typeof onFavorite === "function";
  const canMove = typeof onMove === "function";
  const label = INDEX_LABEL[activeIndex] || activeIndex;
  const spot =
    spotPrice != null && Number.isFinite(Number(spotPrice))
      ? Number(spotPrice).toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : null;
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
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <OiPulseLogo className="h-6 w-6 rounded-md" />
          <div className="leading-none">
            <div className="text-[12px] font-semibold tracking-tight bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">
              OI Pulse
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[8px] uppercase tracking-wider text-slate-400">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  marketOpen ? "bg-emerald-500 live-dot" : "bg-slate-300"
                }`}
              />
              {marketOpen ? "Live" : "Closed"}
            </div>
          </div>
        </div>

        <div className="relative min-w-0 flex-1" ref={wrapRef}>
          <button
            type="button"
            data-testid="mobile-index-switcher"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-left dark:border-slate-700 dark:bg-slate-900"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${INDEX_DOT[activeIndex] || "bg-slate-400"}`}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="block text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                {label}
              </span>
              <span className="block font-mono-data text-[10px] tabular-nums text-slate-500">
                {spot || "—"}
                {pct != null && (
                  <span className={`ml-1 ${pctCls}`}>
                    {pct > 0 ? "+" : ""}
                    {pct.toFixed(2)}%
                  </span>
                )}
              </span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>

          {open && (
            <div
              data-testid="mobile-index-menu"
              className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              {list.map((idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onSelectIndex?.(idx);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${
                    idx === activeIndex
                      ? "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${INDEX_DOT[idx] || "bg-slate-400"}`} />
                  {INDEX_LABEL[idx] || idx}
                </button>
              ))}
            </div>
          )}
        </div>
        {pnlSlot ? (
          <div className="shrink-0 pl-1.5 border-l border-slate-200 dark:border-slate-700" data-testid="mobile-sticky-pnl">
            {pnlSlot}
          </div>
        ) : null}
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
          </div>
        </div>
      )}

      {typeof onToggleInfoTiles === "function" && (
        <div
          className="border-t border-slate-100 dark:border-slate-800"
          data-testid="mobile-info-tiles-bar"
        >
          {infoTilesOpen ? (
            <div className="px-2 py-2">
              <div
                className="min-w-0 relative z-30"
                data-testid="mobile-info-tiles-wrap"
              >
                {infoTiles}
              </div>
              <button
                type="button"
                onClick={() => onToggleInfoTiles(false)}
                title="Hide info tiles — more room for charts"
                aria-label="Hide info tiles"
                aria-expanded="true"
                data-testid="btn-toggle-info-tiles-mobile"
                className="mt-1.5 w-full inline-flex items-center justify-center gap-1 h-8 rounded-md text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-emerald-700 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                Hide events
              </button>
            </div>
          ) : (
            <div className="flex justify-end px-2 py-1">
              <button
                type="button"
                onClick={() => onToggleInfoTiles(true)}
                title="Show holiday / FII / event tiles"
                aria-label="Show info tiles"
                aria-expanded="false"
                data-testid="btn-toggle-info-tiles-mobile"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-emerald-700 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Events
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
