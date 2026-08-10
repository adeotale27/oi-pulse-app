import { KeyRound, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * KiteTokenBanner — visible warning when Kite credentials/token are missing or dead.
 * Especially important pre-open (before 09:15 IST) so admin fixes login before the bell.
 */
export default function KiteTokenBanner({ status, isAdmin = false, onOpenCreds }) {
  // Guests never see credential / token troubleshooting — admin-only ops surface.
  if (!isAdmin || !status) return null;

  const market = status.market || {};
  const phase = market.phase;
  const kiteOk = status.kite_ok === true || (status.mode === "kite" && !status.last_error && status.has_kite_credentials);
  // Spurious reconnect: ignore transient mode=offline while credentials are still present.
  const tokenIssue = status.kite_token_issue === true
    || !status.has_kite_credentials
    || (typeof status.last_error === "string" && /token|api_key|unauthorized|forbidden|incorrect/i.test(status.last_error));

  if (kiteOk && !tokenIssue) return null;
  // Don't nag endlessly after close / weekend unless explicitly a token/credential issue
  if ((phase === "weekend" || phase === "holiday" || phase === "post_close") && status.has_kite_credentials && !status.kite_token_issue && !status.last_error) {
    return null;
  }

  const preOpen = phase === "pre_open" || phase === "open";
  const title = !status.has_kite_credentials
    ? "Kite not connected — live OI will not update"
    : status.last_error
      ? "Kite token looks dead — reconnect before the session"
      : "Kite is offline — live OI paused";

  const detail = !status.has_kite_credentials
    ? "Add API key + access token in Credentials. Access tokens usually expire each morning (~6 AM IST)."
    : status.last_error
      ? String(status.last_error).slice(0, 160)
      : preOpen
        ? "Fix credentials now so NIFTY / SENSEX are warm at the open."
        : "Reconnect Kite to resume live snapshots.";

  return (
    <div
      data-testid="kite-token-banner"
      className="w-full border-b border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100 px-4 py-2"
      role="alert"
    >
      <div className="flex items-start sm:items-center gap-3 flex-wrap">
        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5 sm:mt-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">{title}</div>
          <div className="text-xs opacity-80 mt-0.5 leading-snug">{detail}</div>
        </div>
        {isAdmin && onOpenCreds && (
          <Button
            data-testid="kite-banner-open-creds"
            size="sm"
            className="h-8 rounded-md bg-rose-700 hover:bg-rose-800 text-white shrink-0"
            onClick={onOpenCreds}
          >
            <KeyRound className="w-3.5 h-3.5 mr-1.5" />
            Fix credentials
          </Button>
        )}
      </div>
    </div>
  );
}
