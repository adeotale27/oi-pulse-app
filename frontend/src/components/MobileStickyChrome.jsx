import { useMemo, useState, useRef, useCallback } from "react";
import { ChevronDown } from "lucide-react";
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
  marketOpen = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

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

  return (
    <div
      data-testid="mobile-sticky-chrome"
      className="sticky top-0 z-30 border-b border-emerald-900/10 bg-white/95 backdrop-blur-md dark:border-slate-700 dark:bg-slate-950/95"
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
      </div>

      {tabs.length > 0 && (
        <div
          data-testid="mobile-sticky-tabs"
          className="tabs-scroll flex items-stretch gap-0.5 overflow-x-auto border-t border-slate-100 px-1 dark:border-slate-800"
          role="tablist"
          aria-label="Dashboard views"
        >
          {tabs.map((t) => {
            const active = t.v === activeTab;
            return (
              <button
                key={t.v}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`tab-${t.v}`}
                onClick={() => onChangeTab?.(t.v)}
                className={`shrink-0 whitespace-nowrap border-b-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "border-emerald-500 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {t.l}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
