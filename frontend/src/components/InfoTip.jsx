import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** True when the event landed on an InfoTip (trigger or portaled bubble). */
export function eventFromInfoTip(target) {
  if (!(target instanceof Element)) return false;
  return !!(
    target.closest("[data-info-tip]") ||
    target.closest("[data-radix-popper-content-wrapper]")
  );
}

// Hover opens; click pins. Close only on outside click — never toggle-off on the icon.
export default function InfoTip({ children, title, className = "", size = "sm", testId }) {
  const [open, setOpen] = useState(false);
  const sizeCls = size === "lg" ? "w-4 h-4" : size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-info-tip="trigger"
          data-testid={testId || "info-tip"}
          className={`inline-flex items-center justify-center shrink-0 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors ${className}`}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          title={title}
          aria-label={title || "More information"}
        >
          <Info className={sizeCls} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-info-tip="content"
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={16}
        className="z-[200] w-72 max-w-[min(18rem,calc(100vw-1.5rem))] text-xs text-slate-700 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-700"
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
