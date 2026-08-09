import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  evaluateUploadFreshness,
  formatUploadAge,
} from "@/lib/uploadFreshness";

const DISMISS_KEY = "oi_upload_advisor_dismissed_until";
const TOAST_DAY_KEY = "oi_upload_advisor_toast_day";

function todayIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Admin-only advisor: nudge to refresh NSE events (~15d) and constituents (~30d)
 * before Index Risk goes stale. Guests never see this.
 */
export default function AdminUploadAdvisor({
  isAdmin = false,
  refreshKey = 0,
  onOpenUpload,
}) {
  const [meta, setMeta] = useState(null);
  const [dismissedUntil, setDismissedUntil] = useState(() => {
    try {
      return Number(sessionStorage.getItem(DISMISS_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const toastedRef = useRef(false);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    api
      .get("/upload/meta")
      .then((r) => {
        if (!cancelled) setMeta(r.data || null);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  const staleItems = useMemo(() => {
    if (!meta) return [];
    return evaluateUploadFreshness(meta).filter((x) => x.stale);
  }, [meta]);

  const visible = isAdmin && staleItems.length > 0 && Date.now() > dismissedUntil;

  // One advisory toast per IST day (admin only).
  useEffect(() => {
    if (!isAdmin || !staleItems.length || toastedRef.current) return;
    let already = false;
    try {
      already = sessionStorage.getItem(TOAST_DAY_KEY) === todayIST();
    } catch (_) {
      /* ignore */
    }
    if (already) {
      toastedRef.current = true;
      return;
    }
    toastedRef.current = true;
    try {
      sessionStorage.setItem(TOAST_DAY_KEY, todayIST());
    } catch (_) {
      /* ignore */
    }

    const eventsStale = staleItems.find((x) => x.key === "events");
    const constStale = staleItems.filter((x) => x.key !== "events");
    const title = eventsStale
      ? "Update NSE event calendar"
      : "Refresh index constituents";
    const bits = [];
    if (eventsStale) {
      bits.push(
        `NSE events: ${formatUploadAge(eventsStale.ageDays, eventsStale.never)} (refresh every ${eventsStale.staleAfterDays}d).`,
      );
    }
    if (constStale.length) {
      bits.push(
        `Constituents: ${constStale.map((x) => x.shortLabel).join(", ")} overdue (refresh every 30d).`,
      );
    }
    toast.message(title, {
      id: "admin-upload-advisor",
      description: bits.join(" "),
      duration: 14_000,
      action: onOpenUpload
        ? {
            label: "Upload",
            onClick: () => onOpenUpload(),
          }
        : undefined,
    });
  }, [isAdmin, staleItems, onOpenUpload]);

  if (!visible) return null;

  const dismiss = () => {
    const until = Date.now() + 6 * 60 * 60 * 1000; // 6h
    try {
      sessionStorage.setItem(DISMISS_KEY, String(until));
    } catch (_) {
      /* ignore */
    }
    setDismissedUntil(until);
  };

  return (
    <div
      data-testid="admin-upload-advisor"
      className="w-full border-b border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100 px-3 sm:px-4 py-2"
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-xs font-semibold">
            Admin · data refresh advisory
          </div>
          <ul className="text-[11px] space-y-0.5 opacity-95">
            {staleItems.map((item) => (
              <li key={item.key} data-testid={`admin-upload-stale-${item.key}`}>
                <span className="font-semibold">{item.label}</span>
                {" — "}
                {formatUploadAge(item.ageDays, item.never)}
                {item.never
                  ? `. ${item.advice}`
                  : ` (threshold ${item.staleAfterDays}d). ${item.advice}`}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {onOpenUpload && (
              <button
                type="button"
                data-testid="admin-upload-advisor-open"
                onClick={onOpenUpload}
                className="inline-flex items-center gap-1 rounded-sm bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold px-2 py-1"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Open Upload
              </button>
            )}
            <span className="text-[10px] opacity-70">
              Guests never see this reminder.
            </span>
          </div>
        </div>
        <button
          type="button"
          data-testid="admin-upload-advisor-dismiss"
          onClick={dismiss}
          className="shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
          title="Dismiss for 6 hours"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
