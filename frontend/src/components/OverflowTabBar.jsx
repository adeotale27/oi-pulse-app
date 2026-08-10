import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import useClickOutside from "@/hooks/useClickOutside";

/**
 * Progressive tab overflow: as width shrinks, trailing tabs move into a
 * trailing "More" dropdown one-by-one (never dump all tabs at once).
 *
 * Tabs are drag-and-drop reorderable when `onReorder` is provided.
 * Double-click favorites a tab to the first slot (`onFavorite`).
 * Alt+← / Alt+→ nudges the focused tab (`onMove`).
 */
export default function OverflowTabBar({
  tabs = [],
  value,
  onChange,
  onReorder,
  onFavorite,
  onMove,
  onResetLayout,
  className = "",
  testId = "dashboard-tab-bar",
}) {
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const moreMeasureRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClickRef = useRef(false);
  const menuRef = useRef(null);

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const canReorder = typeof onReorder === "function";
  const canFavorite = typeof onFavorite === "function";
  const canMove = typeof onMove === "function";

  const recalculate = useCallback(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure || !tabs.length) {
      setVisibleCount(tabs.length);
      return;
    }
    const avail = wrap.clientWidth;
    const moreW = moreMeasureRef.current?.offsetWidth || 88;
    const buttons = Array.from(measure.querySelectorAll("[data-tab-measure]"));
    if (!buttons.length) {
      setVisibleCount(tabs.length);
      return;
    }
    const widths = buttons.map((el) => el.offsetWidth);
    const gap = 4; // gap-1

    // Try to fit all without More button.
    let total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
    if (total <= avail) {
      setVisibleCount(tabs.length);
      return;
    }

    // Collapse from the right until remaining + More fit.
    let count = tabs.length;
    while (count > 1) {
      count -= 1;
      const sum =
        widths.slice(0, count).reduce((a, b) => a + b, 0) +
        gap * Math.max(0, count - 1) +
        moreW +
        gap;
      if (sum <= avail) break;
    }
    // Ensure active tab stays reachable: if it's in overflow, still ok via More.
    setVisibleCount(Math.max(1, count));
  }, [tabs]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, tabs, value]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", recalculate);
      return () => window.removeEventListener("resize", recalculate);
    }
    const ro = new ResizeObserver(() => recalculate());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recalculate]);

  useEffect(() => {
    setMenuOpen(false);
  }, [value]);

  const visible = useMemo(() => tabs.slice(0, visibleCount), [tabs, visibleCount]);
  const overflow = useMemo(() => tabs.slice(visibleCount), [tabs, visibleCount]);
  const activeInOverflow = overflow.some((t) => t.v === value);

  const triggerCls = (active, id) => {
    const isOver = canReorder && overId === id && draggingId && draggingId !== id;
    const isDrag = canReorder && draggingId === id;
    return `rounded-none border-b-2 px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors ${
      canReorder ? "cursor-grab active:cursor-grabbing" : ""
    } ${isDrag ? "opacity-40" : ""} ${
      isOver
        ? "border-emerald-400 bg-emerald-50/80 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        : active
          ? "border-emerald-500 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300 bg-transparent shadow-none"
          : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
    }`;
  };

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
    e.stopPropagation();
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
    onChange?.(id);
  };

  const onTabDoubleClick = (e, id) => {
    if (!canFavorite) return;
    e.preventDefault();
    e.stopPropagation();
    skipClickRef.current = true;
    onFavorite(id);
    onChange?.(id);
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
    <div ref={wrapRef} className={`relative min-w-0 flex-1 overflow-visible ${className}`} data-testid={testId}>
      {/* Off-flow measure row — must not overlay sibling tiles (absolute overlays broke clicks) */}
      <div className="h-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden>
        <div ref={measureRef} className="inline-flex gap-1 whitespace-nowrap">
          {tabs.map((t) => (
            <span
              key={t.v}
              data-tab-measure
              className="px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-medium"
            >
              {t.l}
            </span>
          ))}
          <span
            ref={moreMeasureRef}
            className="inline-flex items-center gap-1 px-2.5 py-2 text-[13px] sm:text-sm font-medium"
          >
            More <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      <div
        className="flex items-end gap-1 border-b border-slate-200/80 dark:border-slate-700/80 min-w-0 overflow-visible"
        role="tablist"
        aria-label="Dashboard views — drag, double-click, or Alt+arrows to reorder"
      >
        {visible.map((t) => (
          <button
            key={t.v}
            type="button"
            role="tab"
            aria-selected={t.v === value}
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
            className={triggerCls(t.v === value, t.v)}
          >
            {t.l}
          </button>
        ))}

        {overflow.length > 0 && (
          <div className="relative shrink-0 z-20" ref={menuRef}>
            <button
              type="button"
              data-testid="tab-more"
              onClick={() => setMenuOpen((v) => !v)}
              className={`${triggerCls(activeInOverflow, "__more__")} inline-flex items-center gap-1 cursor-pointer`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={`${overflow.length} more page${overflow.length === 1 ? "" : "s"}`}
            >
              {activeInOverflow
                ? overflow.find((t) => t.v === value)?.l || "More"
                : "More"}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                data-testid="tab-more-menu"
                className="absolute left-0 top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                {overflow.map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    role="menuitem"
                    data-testid={`tab-more-${t.v}`}
                    draggable={canReorder}
                    onDragStart={(e) => onDragStart(e, t.v)}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => onDragOverTab(e, t.v)}
                    onDrop={(e) => onDropTab(e, t.v)}
                    onClick={() => {
                      onTabClick(t.v);
                      setMenuOpen(false);
                    }}
                    onDoubleClick={(e) => {
                      onTabDoubleClick(e, t.v);
                      setMenuOpen(false);
                    }}
                    onKeyDown={(e) => onTabKeyDown(e, t.v)}
                    title={tabTitle}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                      canReorder ? "cursor-grab active:cursor-grabbing" : ""
                    } ${draggingId === t.v ? "opacity-40" : ""} ${
                      overId === t.v && draggingId && draggingId !== t.v
                        ? "bg-emerald-50 dark:bg-emerald-950/40"
                        : ""
                    } ${
                      t.v === value
                        ? "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {typeof onResetLayout === "function" && (
          <button
            type="button"
            data-testid="btn-reset-layout"
            onClick={onResetLayout}
            className="mb-0.5 ml-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Reset tab order, tile order, and expiry list height"
          >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden lg:inline">Reset</span>
          </button>
        )}
      </div>
    </div>
  );
}
