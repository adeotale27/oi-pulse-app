import { Wrench } from "lucide-react";

/**
 * Surface Zerodha / Kite maintenance the way Kite's own toaster does —
 * when /status reports kite_maintenance.active from API errors or bulletin.
 */
export default function KiteMaintenanceBanner({ status }) {
  const maint = status?.kite_maintenance;
  if (!maint?.active || !maint?.message) return null;

  return (
    <div
      data-testid="kite-maintenance-banner"
      className="w-full border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-50 px-4 py-2"
      role="status"
    >
      <div className="flex items-start sm:items-center gap-3 flex-wrap">
        <Wrench className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300 mt-0.5 sm:mt-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Zerodha / Kite maintenance</div>
          <div className="text-xs opacity-85 mt-0.5 leading-snug">{String(maint.message).slice(0, 220)}</div>
        </div>
        {maint.url ? (
          <a
            href={maint.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold underline underline-offset-2 shrink-0"
            data-testid="kite-maintenance-link"
          >
            Bulletin
          </a>
        ) : null}
      </div>
    </div>
  );
}
