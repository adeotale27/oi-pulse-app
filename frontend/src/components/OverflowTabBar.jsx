import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import useClickOutside from "@/hooks/useClickOutside";

/**
 * Progressive tab overflow: as width shrinks, trailing tabs move into a
 * trailing "More" dropdown one-by-one (never dump all tabs at once).
 */
export default function OverflowTabBar({
  tabs = [],
  value,
  onChange,
  className = "",
  testId = "dashboard-tab-bar",
}) {
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const moreMeasureRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

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

  const triggerCls = (active) =>
    `rounded-none border-b-2 px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors ${
      active
        ? "border-emerald-500 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300 bg-transparent shadow-none"
        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
    }`;

  return (
    <div ref={wrapRef} className={`relative min-w-0 flex-1 ${className}`} data-testid={testId}>
      {/* Hidden measure row — all tabs at natural width */}
      <div
        ref={measureRef}
        className="absolute left-0 top-0 -z-10 flex gap-1 opacity-0 pointer-events-none whitespace-nowrap"
        aria-hidden
      >
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

      <div className="flex items-end gap-1 border-b border-slate-200/80 dark:border-slate-700/80 min-w-0">
        {visible.map((t) => (
          <button
            key={t.v}
            type="button"
            role="tab"
            aria-selected={t.v === value}
            data-testid={`tab-${t.v}`}
            onClick={() => onChange?.(t.v)}
            className={triggerCls(t.v === value)}
          >
            {t.l}
          </button>
        ))}

        {overflow.length > 0 && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              data-testid="tab-more"
              onClick={() => setMenuOpen((v) => !v)}
              className={`${triggerCls(activeInOverflow)} inline-flex items-center gap-1`}
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
                className="absolute right-0 top-full z-40 mt-1 min-w-[11rem] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                {overflow.map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    role="menuitem"
                    data-testid={`tab-more-${t.v}`}
                    onClick={() => {
                      onChange?.(t.v);
                      setMenuOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm ${
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
      </div>
    </div>
  );
}
