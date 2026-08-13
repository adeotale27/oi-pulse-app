import { BarChart3, Table2, Briefcase, Bell, SlidersHorizontal } from "lucide-react";

/**
 * Phone-only dock. Desktop is unaffected (md:hidden).
 */
export default function MobileBottomNav({
  activeTab,
  onChangeTab,
  onOpenDesk,
  deskOpen = false,
  isAdmin = false,
}) {
  const items = [
    { id: "oi-change", label: "Chart", icon: BarChart3 },
    { id: "strike-table", label: "Chain", icon: Table2 },
    ...(isAdmin ? [{ id: "positions", label: "Book", icon: Briefcase }] : []),
    { id: "alerts", label: "Alerts", icon: Bell },
  ];

  return (
    <nav
      data-testid="mobile-bottom-nav-fixed"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div
        className="grid px-1 pt-1"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id && !deskOpen;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}-mobile`}
              onClick={() => onChangeTab?.(item.id)}
              className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold tracking-wide ${
                active
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Icon className={`h-4.5 w-4.5 h-[18px] w-[18px] ${active ? "stroke-[2.25]" : ""}`} />
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          data-testid="nav-desk-mobile"
          onClick={onOpenDesk}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold tracking-wide ${
            deskOpen
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          Desk
        </button>
      </div>
    </nav>
  );
}
