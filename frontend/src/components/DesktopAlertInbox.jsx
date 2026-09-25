import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

/** Expandable desktop queue for alerts received while the desk tab was hidden. */
export default function DesktopAlertInbox() {
  const [queue, setQueue] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onSummary = (event) => {
      const detail = event?.detail;
      if (!detail?.title) return;
      setQueue({
        ...detail,
        alerts: Array.isArray(detail.alerts) && detail.alerts.length ? detail.alerts : [detail],
      });
      setOpen(false);
    };
    const onPointerDown = (event) => {
      if (open && ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
        setQueue(null);
      }
    };
    window.addEventListener("oi-desktop-alert-summary", onSummary);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("oi-desktop-alert-summary", onSummary);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!queue) return null;
  const alerts = queue.alerts;
  const dismiss = () => {
    setOpen(false);
    setQueue(null);
  };

  return (
    <div ref={ref} className="fixed right-4 top-4 z-[120] hidden w-[min(27rem,calc(100vw-2rem))] md:block" data-testid="desktop-alert-inbox">
      {open ? (
        <section className="rounded-xl border border-slate-200 bg-white/95 p-3 text-slate-800 shadow-2xl backdrop-blur-md" style={{ opacity: "var(--oi-alert-toast-opacity, 0.9)" }} role="status" aria-live="polite">
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                {queue.title}
              </div>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                {alerts.map((alert, index) => (
                  <div key={`${alert.title}-${index}`} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                    <div className={`text-xs font-semibold ${alert.variant === "success" ? "text-emerald-700" : alert.variant === "error" ? "text-rose-700" : "text-slate-700"}`}>
                      {alert.title}
                    </div>
                    {alert.description ? <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{alert.description}</div> : null}
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Dismiss all alerts" onClick={dismiss}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-lg backdrop-blur-md"
          style={{ opacity: "var(--oi-alert-toast-opacity, 0.9)" }}
          onClick={() => setOpen(true)}
          aria-label={`Show ${alerts.length} alerts`}
        >
          <Bell className="h-3.5 w-3.5" /> Alerts · {alerts.length}
        </button>
      )}
    </div>
  );
}
