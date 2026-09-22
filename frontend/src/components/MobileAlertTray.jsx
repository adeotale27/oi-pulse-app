import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

/** OI-only phone alert surface. Keeps the live desk unobscured at the top. */
export default function MobileAlertTray() {
  const [latest, setLatest] = useState(null);
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
      setCount((n) => n + 1);
      setOpen(true);
      timerRef.current = window.setTimeout(() => setOpen(false), Math.max(4000, Number(next.duration) || 7000));
    };
    window.addEventListener("oi-mobile-alert", onAlert);
    return () => {
      clear();
      window.removeEventListener("oi-mobile-alert", onAlert);
    };
  }, []);

  if (!latest || !count) return null;
  const label = `Alerts · ${count}`;
  return (
    <div className="md:hidden fixed inset-x-2 z-[90] pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }} data-testid="mobile-alert-tray">
      {open ? (
        <section className="pointer-events-auto mx-auto max-w-md rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/95" role="status" aria-live="polite">
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
              <div className="mt-0.5 text-xs font-semibold leading-snug text-slate-900 dark:text-slate-100">{latest.title}</div>
              {latest.description ? <div className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{latest.description}</div> : null}
            </div>
            <button type="button" className="-mr-1 -mt-1 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100" aria-label="Collapse alert tray" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className="pointer-events-auto ml-auto flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200" onClick={() => setOpen(true)}>
          <Bell className="h-3.5 w-3.5 text-amber-600" /> {label}
        </button>
      )}
    </div>
  );
}
