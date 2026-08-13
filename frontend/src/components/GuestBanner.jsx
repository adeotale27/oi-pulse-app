import { LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { logoutGuest } from "@/lib/api";

/**
 * Small amber banner shown when a guest is browsing the app.
 * "Guest access via <admin name>" + read-only note + Exit button.
 */
export default function GuestBanner({ guestName, adminName }) {
  const exit = async () => {
    await logoutGuest();
    toast.success("Exited guest session");
    window.location.reload();
  };
  return (
    <div
      data-testid="guest-banner"
      className="w-full px-4 py-1.5 text-xs bg-gradient-to-r from-amber-50 to-emerald-50/60 border-b border-amber-200/80 text-amber-950 flex items-center justify-between gap-3 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-amber-700" />
        <span className="truncate">
          {guestName ? <b>{guestName}</b> : "Guest"}
          <span className="hidden sm:inline">
            {" — "}
            <b>Guest access via {adminName || "Adeotale"}</b>
            {" · "}
            Read-only OI. Connect your own Zerodha on Positions for your book.
          </span>
          <span className="sm:hidden text-amber-800/90"> · Guest · connect Kite on Positions</span>
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
