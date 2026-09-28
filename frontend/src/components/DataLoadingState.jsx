import OiPulseLogo from "@/components/OiPulseLogo";

export default function DataLoadingState({
  label = "StrikLenz is brewing data…",
  variant = "fullscreen",
  className = "",
}) {
  if (variant === "inline") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={`inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 ${className}`.trim()}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </span>
    );
  }

  if (variant === "panel") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={`flex h-full min-h-[10rem] flex-col items-center justify-center gap-3 text-center text-sm text-slate-500 dark:text-slate-300 ${className}`.trim()}
      >
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 180}ms` }}
            />
          ))}
        </span>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`flex min-h-screen items-center justify-center bg-[#061018] px-6 text-emerald-100 ${className}`.trim()}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="data-loading-logo-frame relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 rounded-2xl border border-emerald-400/50 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
          <OiPulseLogo className="h-13 w-13" pulse={false} />
        </span>
        <span className="text-sm font-medium tracking-wide">{label}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 180}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
