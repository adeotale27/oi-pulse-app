import { LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Small amber banner shown when a guest is browsing the app.
 * "Guest access via <admin name>" + read-only note + Exit button.
 */
export default function GuestBanner({ guestName, adminName }) {
  const exit = () => {
    try {
      sessionStorage.removeItem("oi_guest_token");
      sessionStorage.removeItem("oi_guest_name");
    } catch (_) { /* ignore */ }
    toast.success("Exited guest session");
    window.location.reload();
  };
  return (
    <div
      data-testid="guest-banner"
      className="w-full px-4 py-1.5 text-xs bg-amber-50 border-b border-amber-200 text-amber-900 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-amber-700" />
        <span className="truncate">
          {guestName ? <b>{guestName}</b> : "Guest"} — <b>Guest access via {adminName || "Adeotale"}</b>
          {" · "}
          Read-only view. Configuration and alerts are managed by the admin.
        </span>
      </div>
      <button
        onClick={exit}
        className="flex items-center gap-1 text-amber-800 hover:text-rose-700 shrink-0"
        data-testid="guest-exit"
      >
        <LogOut className="w-3 h-3" /> Exit
      </button>
    </div>
  );
}
