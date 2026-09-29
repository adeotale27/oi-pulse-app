import { ChevronLeft, ChevronRight } from "lucide-react";

function requestCycle(direction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("oi-admin-dialog-cycle", { detail: { direction } }));
}

export default function AdminDialogNavigation() {
  return (
    <span
      role="group"
      aria-label="Admin dialog navigation"
      className="inline-flex shrink-0 items-center gap-0.5"
    >
      <button
        type="button"
        aria-label="Previous admin dialog"
        title="Previous admin dialog"
        aria-keyshortcuts="ArrowLeft"
        onClick={() => requestCycle(-1)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 md:h-7 md:w-7"
      >
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next admin dialog"
        title="Next admin dialog"
        aria-keyshortcuts="ArrowRight"
        onClick={() => requestCycle(1)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 md:h-7 md:w-7"
      >
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
