import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Info icons stay visible on hover and only close when the user clicks elsewhere.
export default function InfoTip({ children, title, className = "", size = "sm", testId }) {
  const [open, setOpen] = useState(false);
  const sizeCls = size === "lg" ? "w-4 h-4" : size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId || "info-tip"}
          className={`inline-flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors ${className}`}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          title={title}
          aria-label={title}
        >
          <Info className={sizeCls} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="z-[200] w-72 text-xs text-slate-700 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-700"
        onInteractOutside={() => setOpen(false)}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setOpen(true)}
        onFocusCapture={() => setOpen(true)}
      >
        {title && <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>}
        <div className="leading-relaxed">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
