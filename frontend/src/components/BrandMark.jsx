import OiPulseLogo from "@/components/OiPulseLogo";
import { APP_NAME, APP_VERSION_LABEL, openAboutApp } from "@/lib/appVersion";

/**
 * Clickable brand + version. Opens the About modal (what the desk is).
 */
export default function BrandMark({
  compact = false,
  subtitle,
  className = "",
  logoClassName,
  showVersion = true,
}) {
  return (
    <button
      type="button"
      onClick={openAboutApp}
      className={`flex items-center gap-1.5 min-w-0 text-left rounded-md hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${className}`}
      data-testid="brand-about-trigger"
      title={`About ${APP_NAME} ${APP_VERSION_LABEL}`}
    >
      <OiPulseLogo className={logoClassName || (compact ? "w-6 h-6 overflow-hidden rounded-[0.4rem]" : "w-8 h-8 overflow-hidden rounded-lg")} />
      <div className="leading-tight min-w-0">
        <div
          className={`${compact ? "text-sm" : "text-base"} font-semibold tracking-tight bg-gradient-to-r from-emerald-600 via-emerald-700 to-sky-600 bg-clip-text text-transparent`}
        >
          {APP_NAME}
        </div>
        {(showVersion || subtitle) && (
          <div className="text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400 truncate">
            {showVersion ? APP_VERSION_LABEL : null}
            {showVersion && subtitle ? " · " : null}
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}
