import { useEffect, useState } from "react";
import { credentialsStatus, saveCredentials, setMode } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KeyRound, ExternalLink } from "lucide-react";

export default function CredentialsModal({ open, onOpenChange, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [genMode, setGenMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!open) return;
    credentialsStatus().then(setStatus).catch(() => {});
  }, [open]);

  const submit = async () => {
    if (genMode) {
      if (!apiKey || !apiSecret || !requestToken) {
        toast.error("Enter API key, API secret and request token");
        return;
      }
      setSaving(true);
      try {
        const { api } = await import("@/lib/api");
        const r = await api.post("/kite/generate-session", {
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
          request_token: requestToken.trim(),
        });
        toast.success(`LIVE mode active. Kite user: ${r.data.user_id}`);
        onSaved?.();
        onOpenChange(false);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Token generation failed");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!apiKey || !token) {
      toast.error("Enter both API key and Access token");
      return;
    }
    setSaving(true);
    try {
      await saveCredentials(apiKey.trim(), token.trim());
      toast.success("Kite credentials saved. Switched to LIVE mode.");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const useDemo = async () => {
    try {
      await setMode("mock");
      toast.success("Switched to DEMO mode");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not switch mode");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="credentials-modal" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Zerodha KiteConnect Credentials
          </DialogTitle>
          <DialogDescription>
            Enter your Kite API Key and daily Access Token to fetch live NSE OI data.
            Access tokens expire every trading day around 6 AM IST.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="flex gap-1 border-b border-slate-200 pb-2">
            <button
              data-testid="tab-paste-token"
              onClick={() => setGenMode(false)}
              className={`text-xs px-3 py-1 rounded-sm ${!genMode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              I have access_token
            </button>
            <button
              data-testid="tab-generate-token"
              onClick={() => setGenMode(true)}
              className={`text-xs px-3 py-1 rounded-sm ${genMode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Generate from request_token
            </button>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">API Key</Label>
            <Input
              data-testid="input-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="e.g. xxxxxxxxxxxxxxxx"
              className="font-mono-data"
            />
          </div>
          {!genMode ? (
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Access Token</Label>
              <Input
                data-testid="input-access-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="daily access_token"
                className="font-mono-data"
              />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">API Secret</Label>
                <Input
                  data-testid="input-api-secret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="from your Kite Connect app"
                  className="font-mono-data"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Request Token</Label>
                <Input
                  data-testid="input-request-token"
                  value={requestToken}
                  onChange={(e) => setRequestToken(e.target.value)}
                  placeholder="from the ?request_token=… URL after login"
                  className="font-mono-data"
                />
              </div>
              <a
                href={`https://kite.zerodha.com/connect/login?api_key=${apiKey || "YOUR_KEY"}&v=3`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
              >
                1) Click here to login and get request_token <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
          {status?.configured && (
            <div className="text-xs text-slate-500 font-mono-data">
              Current key: {status.api_key_hint} · updated {status.updated_at?.slice(0, 19).replace("T", " ")}
            </div>
          )}
          <a
            href="https://kite.trade/docs/connect/v3/user/#login-flow"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
            data-testid="link-kite-docs"
          >
            How to generate access token <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Button
            data-testid="btn-use-demo"
            variant="outline"
            onClick={useDemo}
            className="rounded-sm"
          >
            Use Demo data
          </Button>
          <Button
            data-testid="btn-save-credentials"
            onClick={submit}
            disabled={saving}
            className="rounded-sm bg-slate-900 hover:bg-slate-800"
          >
            {saving ? "Saving..." : "Save & Go Live"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
