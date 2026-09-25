import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

/** OI-only phone alert surface. Keeps the live desk unobscured at the top. */
export default function MobileAlertTray() {
  const [latest, setLatest] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const onAlert = (event) => {
      const next = event?.detail;
      if (!next?.title) return;
      clear();
      setLatest(next);
      setAlerts((previous) => [...previous, ...(Array.isArray(next.alerts) ? next.alerts : [next])].slice(-20));
      setCount((n) => n + (Array.isArray(next.alerts) ? next.alerts.length : 1));
      setOpen(true);
      timerRef.current = window.setTimeout(() => setOpen(false), Math.max(4000, Number(next.duration) || 7000));
    };
    window.addEventListener("oi-mobile-alert", onAlert);
    const onPointerDown = (event) => {
      if (open && !event.target.closest?.('[data-testid="mobile-alert-tray"]')) dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      clear();
      window.removeEventListener("oi-mobile-alert", onAlert);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!latest || !count) return null;
  const label = `Alerts · ${count}`;
  const bullish = latest.variant === "success";
  const tone = bullish
    ? {
      border: "border-emerald-200/80",
      icon: "text-emerald-600",
      title: "text-emerald-800",
      count: "text-emerald-700",
    }
    : {
      border: "border-rose-200/80",
      icon: "text-rose-600",
      title: "text-rose-800",
      count: "text-rose-700",
    };
  const visibleAlerts = alerts.length ? alerts : [latest];
  const dismiss = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
    setLatest(null);
    setAlerts([]);
    setCount(0);
  };
  return (
    <div className="md:hidden fixed inset-x-2 z-[90] pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }} data-testid="mobile-alert-tray">
      {open ? (
        <section className={`pointer-events-auto mx-auto max-w-md rounded-xl border ${tone.border} bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-md dark:bg-slate-900/95`} style={{ opacity: "var(--oi-alert-toast-opacity, 0.9)" }} role="status" aria-live="polite">
          <div className="flex items-start gap-2">
            <Bell className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-[10px] font-semibold uppercase tracking-widest ${tone.count}`}>{label}</div>
              <div className={`mt-0.5 text-xs font-semibold leading-snug ${tone.title} dark:text-slate-100`}>{latest.title}</div>
              <div className="mt-1 max-h-52 space-y-2 overflow-y-auto pr-1">
                {visibleAlerts.map((alert, index) => (
                  <div key={`${alert.title}-${index}`} className="border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0 dark:border-slate-700">
                    <div className={`text-[11px] font-semibold leading-snug ${alert.variant === "success" ? "text-emerald-700" : alert.variant === "error" ? "text-rose-700" : "text-slate-700"} dark:text-slate-200`}>{alert.title}</div>
                    {alert.description ? <div className="text-[10px] leading-snug text-slate-600 dark:text-slate-300">{alert.description}</div> : null}
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className="-mr-1 -mt-1 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100" aria-label="Dismiss all alerts" onClick={dismiss}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className={`pointer-events-auto ml-auto flex items-center gap-1.5 rounded-full border ${tone.border} bg-white/95 px-3 py-1.5 text-[11px] font-semibold ${tone.count} shadow-sm backdrop-blur-md dark:bg-slate-900/95`} style={{ opacity: "var(--oi-alert-toast-opacity, 0.9)" }} onClick={() => setOpen(true)}>
          <Bell className={`h-3.5 w-3.5 ${tone.icon}`} /> {label}
        </button>
      )}
    </div>
  );
}
