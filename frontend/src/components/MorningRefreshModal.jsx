import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * Morning Refresh Modal
 *
 * Zerodha Kite access tokens expire daily around 6 AM IST. Instead of the full
 * credentials modal, this one-tap flow uses the vault (stored api_key + encrypted
 * api_secret) so the user only needs to paste today's fresh request_token.
 *
 * Flow:
 *   1) Open modal -> checks GET /api/kite/vault.
 *      - If vault has api_key + api_secret -> ready for one-tap refresh.
 *      - Else -> point user to full CredentialsModal.
 *   2) User clicks "Login to Kite" -> new tab opens Kite OAuth.
 *   3) After Kite redirects back with ?request_token=..., user pastes it.
 *   4) Clicks "Refresh Token" -> POST /api/kite/refresh -> LIVE mode restored.
 */
export default function MorningRefreshModal({ open, onOpenChange, onRefreshed, onNeedFullSetup }) {
  const [vault, setVault] = useState(null);
  const [requestToken, setRequestToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!open) return;
    setRequestToken("");
    setVault(null);
    setStatus(null);
    (async () => {
      try {
        const { data: v } = await api.get("/kite/vault");
        setVault(v);
        try {
          const { data: s } = await api.get("/status");
          setStatus(s);
        } catch (_) { /* noop */ }
      } catch (e) {
        toast.error("Could not read vault status");
      }
    })();
  }, [open]);

  const kiteLoginUrl =
    vault?.login_url
    || "https://kite.zerodha.com/connect/login?v=3";

  const doRefresh = async () => {
    if (!requestToken.trim()) {
      toast.error("Paste the request_token from the Kite redirect URL first.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/kite/refresh", { request_token: requestToken.trim() });
      toast.success(`LIVE mode active${r.data.user_id ? ` · ${r.data.user_id}` : ""}`);
      onRefreshed?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const vaultReady = vault && vault.has_api_key && vault.has_api_secret;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="morning-refresh-modal" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Morning Kite Refresh
          </DialogTitle>
          <DialogDescription>
            Kite access tokens expire every trading day ~6 AM IST. One tap to renew.
          </DialogDescription>
        </DialogHeader>

        {vault === null ? (
          <div className="text-sm text-slate-500 py-6 text-center">Checking vault…</div>
        ) : !vaultReady ? (
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-2 text-sm p-3 rounded-sm bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5" />
              <div className="text-amber-900">
                One-tap refresh requires api_key + api_secret stored in the vault.
                Please do the full setup once (with &quot;Remember&quot; enabled) then use this button daily.
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                data-testid="btn-open-full-setup"
                onClick={() => { onOpenChange(false); onNeedFullSetup?.(); }}
                className="rounded-sm bg-slate-900 hover:bg-slate-800"
              >
                Open full setup
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-2 text-sm p-3 rounded-sm bg-emerald-50 border border-emerald-200">
              <ShieldCheck className="w-4 h-4 text-emerald-700 mt-0.5" />
              <div className="text-emerald-900">
                Vault ready · api_key <span className="font-mono-data">{vault.api_key_hint}</span> · secret encrypted
                {status?.mode && (
                  <span className="ml-1">· mode: <b>{status.mode.toUpperCase()}</b></span>
                )}
              </div>
            </div>

            <a
              href={kiteLoginUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-sm bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              data-testid="btn-kite-login"
            >
              1) Login to Kite <ExternalLink className="w-4 h-4" />
            </a>
            <div className="text-xs text-slate-500 -mt-1">
              After Kite login, you&apos;ll land on a URL like
              <code className="mx-1 px-1 bg-slate-100 rounded-sm">https://…?request_token=<b>xxx</b>&…</code>
              Copy that value below.
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">
                2) Paste request_token
              </Label>
              <Input
                data-testid="input-morning-request-token"
                value={requestToken}
                onChange={(e) => setRequestToken(e.target.value)}
                placeholder="paste today's request_token"
                className="font-mono-data"
                autoFocus
              />
            </div>

            <Button
              data-testid="btn-do-refresh"
              onClick={doRefresh}
              disabled={busy || !requestToken.trim()}
              className="w-full rounded-sm bg-slate-900 hover:bg-slate-800 py-3 text-base"
            >
              {busy ? "Refreshing…" : "3) Refresh Token & Go Live"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
