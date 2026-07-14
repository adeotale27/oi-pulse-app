import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Consistent hover / click info tooltip used across the app for beginner-friendly
// explanations. On desktop it opens on hover (via Popover open state), on mobile
// it opens on tap.
export default function InfoTip({ children, title, className = "", size = "sm", testId }) {
  const sizeCls = size === "lg" ? "w-4 h-4" : size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId || "info-tip"}
          className={`inline-flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors ${className}`}
          onMouseEnter={(e) => { e.currentTarget.click?.(); }}
          title={title}
          aria-label={title}
        >
          <Info className={sizeCls} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 text-xs text-slate-700 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-700">
        {title && <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm mb-1">{title}</div>}
        <div className="leading-relaxed">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
