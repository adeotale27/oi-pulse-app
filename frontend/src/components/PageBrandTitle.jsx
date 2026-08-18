import OiPulseLogo from "@/components/OiPulseLogo";

/**
 * In-page title with the desk mark — same treatment as Kite Positions.
 * Optional kicker (index name) sits above the title, logo centered on both lines.
 */
export default function PageBrandTitle({
  kicker,
  title,
  className = "",
  titleClassName = "text-sm font-semibold text-slate-900",
  testId = "page-brand-title",
  children,
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`} data-testid={testId}>
      <OiPulseLogo className="w-5 h-5 overflow-hidden rounded-md shrink-0" pulse={false} />
      <div className="min-w-0 leading-tight">
        {kicker ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 truncate">
            {kicker}
          </div>
        ) : null}
        <div className={`${titleClassName} leading-tight`}>{title}</div>
      </div>
      {children}
    </div>
  );
}
