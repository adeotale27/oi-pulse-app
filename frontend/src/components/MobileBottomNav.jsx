import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Table2,
  Briefcase,
  Bell,
  SlidersHorizontal,
  Activity,
  CalendarDays,
  Layers,
  Wrench,
} from "lucide-react";
import { DOCK_CATALOG, loadMobileDock, saveMobileDock } from "@/lib/mobileDock";

const ICONS = {
  "oi-change": BarChart3,
  straddle: Activity,
  positions: Briefcase,
  holidays: CalendarDays,
  "admin-tools": Wrench,
  "strike-table": Table2,
  alerts: Bell,
  "open-interest": Layers,
  desk: SlidersHorizontal,
};

/**
 * Phone-only dock. Desktop is unaffected (md:hidden).
 * Long-press (~450ms) or tap the Dock chip to edit which pages sit here.
 */
export default function MobileBottomNav({
  activeTab,
  onChangeTab,
  onOpenDesk,
  onOpenAdminTools,
  deskOpen = false,
  isAdmin = false,
}) {
  const [edit, setEdit] = useState(false);
  const [ids, setIds] = useState(() => loadMobileDock(isAdmin).map((d) => d.id));
  const [toolsOpen, setToolsOpen] = useState(false);
  const holdRef = useRef({ timer: null, suppressClick: false });

  useEffect(() => {
    const sync = (e) => setToolsOpen(!!e.detail?.open);
    window.addEventListener("oi-admin-tools-changed", sync);
    return () => window.removeEventListener("oi-admin-tools-changed", sync);
  }, []);

  useEffect(() => {
    setIds(loadMobileDock(isAdmin).map((d) => d.id));
  }, [isAdmin]);

  const items = useMemo(() => {
    const byId = new Map(DOCK_CATALOG.map((d) => [d.id, d]));
    return ids
      .map((id) => byId.get(id))
      .filter((d) => d && (isAdmin || !d.adminOnly))
      .slice(0, 5);
  }, [ids, isAdmin]);

  const clearHold = () => {
    if (holdRef.current.timer) {
      clearTimeout(holdRef.current.timer);
      holdRef.current.timer = null;
    }
  };

  const startHold = () => {
    holdRef.current.suppressClick = false;
    clearHold();
    holdRef.current.timer = setTimeout(() => {
      holdRef.current.timer = null;
      holdRef.current.suppressClick = true;
      setEdit(true);
    }, 450);
  };

  const toggleId = (id) => {
    setIds((prev) => {
      let next;
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev;
        next = prev.filter((x) => x !== id);
      } else {
        next = prev.length >= 5 ? [...prev.slice(0, 4), id] : [...prev, id];
      }
      saveMobileDock(next);
      return next;
    });
  };

  return (
    <nav
      data-testid="mobile-bottom-nav-fixed"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95"
    >
      {edit && (
        <div className="px-3 pt-2 pb-1 border-b border-slate-100" data-testid="mobile-dock-edit">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400">Dock (max 5) · long-press a tab</span>
            <button type="button" className="text-[11px] text-emerald-700 font-semibold" onClick={() => setEdit(false)}>
              Done
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {DOCK_CATALOG.filter((d) => isAdmin || !d.adminOnly).map((d) => {
              const on = ids.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleId(d.id)}
                  className={`h-7 px-2 rounded-full text-[10px] font-semibold border ${
                    on ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div
        className="grid px-1 pt-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(items.length + 1, 1)}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const Icon = ICONS[item.id] || BarChart3;
          const active = item.action === "desk"
            ? deskOpen
            : item.action === "admin-tools"
              ? toolsOpen
              : activeTab === item.tab && !deskOpen;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}-mobile`}
              onClick={() => {
                if (holdRef.current.suppressClick) {
                  holdRef.current.suppressClick = false;
                  return;
                }
                if (item.action === "desk") onOpenDesk?.();
                else if (item.action === "admin-tools") onOpenAdminTools?.();
                else onChangeTab?.(item.tab);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setEdit(true);
              }}
              onPointerDown={startHold}
              onPointerUp={clearHold}
              onPointerCancel={clearHold}
              onPointerMove={() => { /* keep hold unless we want cancel on scroll */ }}
              className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold tracking-wide select-none ${
                active
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          data-testid="nav-dock-edit-mobile"
          onClick={() => setEdit((v) => !v)}
          className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold tracking-wide text-slate-400"
          title="Edit dock"
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          Dock
        </button>
      </div>
    </nav>
  );
}
