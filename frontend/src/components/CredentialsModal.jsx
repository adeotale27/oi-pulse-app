import { useCallback, useEffect, useState } from "react";
import {
  credentialsStatus,
  kiteVaultStatus,
  refreshKiteSession,
  saveCredentials,
  saveKiteVault,
} from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KeyRound, ExternalLink, X, ShieldCheck } from "lucide-react";

/** Masked vault field with clear (×) — never hydrates plaintext secret from the server. */
function VaultSecretField({
  id,
  label,
  value,
  onChange,
  stored,
  hint,
  onClear,
  placeholder,
  testId,
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-slate-500 inline-flex items-center gap-1.5">
        {label}
        {stored ? (
          <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-sm">
            <ShieldCheck className="w-3 h-3" />
            Saved · encrypted
          </span>
        ) : null}
      </Label>
      <div className="relative mt-1">
        <Input
          id={id}
          data-testid={testId}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            stored
              ? `••••••••••••${hint ? `  ${hint}` : ""} — type to replace`
              : placeholder
          }
          autoComplete="off"
          className="font-mono-data pr-9 tracking-widest"
        />
        {(stored || value) && (
          <button
            type="button"
            data-testid={`${testId}-clear`}
            title={stored ? "Clear saved value" : "Clear"}
            aria-label={`Clear ${label}`}
            onClick={onClear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-sm text-slate-400 hover:text-rose-700 hover:bg-rose-50"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function CredentialsModal({ open, onOpenChange, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [genMode, setGenMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [vault, setVault] = useState(null);
  const [keyStored, setKeyStored] = useState(false);
  const [secretStored, setSecretStored] = useState(false);

  const loadVault = useCallback(async () => {
    try {
      const [st, v] = await Promise.all([
        credentialsStatus().catch(() => null),
        kiteVaultStatus().catch(() => null),
      ]);
      if (st) setStatus(st);
      if (v) {
        setVault(v);
        setKeyStored(!!v.has_api_key);
        setSecretStored(!!v.has_api_secret);
        setApiKey("");
        setApiSecret("");
      }
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setToken("");
    setRequestToken("");
    loadVault();
  }, [open, loadVault]);

  const clearApiKey = async () => {
    setApiKey("");
    if (keyStored) {
      try {
        const v = await saveKiteVault({ clear_api_key: true });
        setVault(v);
        setKeyStored(!!v.has_api_key);
        toast.message("API key cleared from vault");
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Failed to clear API key");
      }
    }
  };

  const clearApiSecret = async () => {
    setApiSecret("");
    if (secretStored) {
      try {
        const v = await saveKiteVault({ clear_api_secret: true });
        setVault(v);
        setSecretStored(!!v.has_api_secret);
        toast.message("API secret cleared from vault");
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Failed to clear API secret");
      }
    }
  };

  const persistKeySecretIfTyped = async () => {
    const payload = {};
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    if (apiSecret.trim()) payload.api_secret = apiSecret.trim();
    if (!Object.keys(payload).length) return vault;
    const v = await saveKiteVault(payload);
    setVault(v);
    setKeyStored(!!v.has_api_key);
    setSecretStored(!!v.has_api_secret);
    setApiKey("");
    setApiSecret("");
    return v;
  };

  const openKiteLogin = async (e) => {
    e?.preventDefault?.();
    try {
      let v = vault;
      if (apiKey.trim() || apiSecret.trim()) {
        v = await persistKeySecretIfTyped();
        toast.success("API key / secret saved encrypted");
      }
      const url = v?.login_url || null;
      if (!url) {
        toast.error("Save an API key first, then click login");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not open Kite login");
    }
  };

  const submit = async () => {
    if (genMode) {
      if (!requestToken.trim()) {
        toast.error("Paste the request_token from the Kite login redirect URL");
        return;
      }
      setSaving(true);
      try {
        if (keyStored && secretStored && !apiKey.trim() && !apiSecret.trim()) {
          const r = await refreshKiteSession(requestToken.trim());
          toast.success(`LIVE mode active. Kite user: ${r.user_id || "ok"}`);
          onSaved?.();
          onOpenChange(false);
          return;
        }
        if (apiKey.trim() && apiSecret.trim()) {
          const { api } = await import("@/lib/api");
          const r = await api.post("/kite/generate-session", {
            api_key: apiKey.trim(),
            api_secret: apiSecret.trim(),
            request_token: requestToken.trim(),
            remember: true,
          });
          toast.success(`LIVE mode active. Kite user: ${r.data.user_id}`);
          setApiKey("");
          setApiSecret("");
          onSaved?.();
          onOpenChange(false);
          return;
        }
        if ((keyStored || apiKey.trim()) && (secretStored || apiSecret.trim())) {
          await persistKeySecretIfTyped();
          const r = await refreshKiteSession(requestToken.trim());
          toast.success(`LIVE mode active. Kite user: ${r.user_id || "ok"}`);
          onSaved?.();
          onOpenChange(false);
          return;
        }
        toast.error("Enter API key and API secret (or keep the saved vault values)");
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Token generation failed");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!token.trim()) {
      toast.error("Enter Access token");
      return;
    }
    setSaving(true);
    try {
      if (apiKey.trim()) {
        if (apiSecret.trim()) {
          await saveKiteVault({ api_key: apiKey.trim(), api_secret: apiSecret.trim() });
        } else if (!keyStored) {
          await saveKiteVault({ api_key: apiKey.trim() });
        }
        await saveCredentials(apiKey.trim(), token.trim());
      } else if (keyStored) {
        const { api } = await import("@/lib/api");
        await api.post("/credentials/access-token", { access_token: token.trim() });
      } else {
        toast.error("Enter API key (or keep the saved vault key)");
        setSaving(false);
        return;
      }
      toast.success("Kite credentials saved. Switched to LIVE mode.");
      setApiKey("");
      setApiSecret("");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save credentials");
    } finally {
      setSaving(false);
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
            API key and secret are saved encrypted once. Each trading day, click login, paste the
            request_token, and go live — tokens expire around 6 AM IST.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="flex gap-1 border-b border-slate-200 pb-2">
            <button
              type="button"
              data-testid="tab-paste-token"
              onClick={() => setGenMode(false)}
              className={`text-xs px-3 py-1 rounded-sm ${!genMode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              I have access_token
            </button>
            <button
              type="button"
              data-testid="tab-generate-token"
              onClick={() => setGenMode(true)}
              className={`text-xs px-3 py-1 rounded-sm ${genMode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Generate from request_token
            </button>
          </div>

          <VaultSecretField
            id="kite-api-key"
            label="API Key"
            testId="input-api-key"
            value={apiKey}
            onChange={setApiKey}
            stored={keyStored && !apiKey}
            hint={vault?.api_key_hint}
            onClear={clearApiKey}
            placeholder="e.g. xxxxxxxxxxxxxxxx"
          />

          {!genMode ? (
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Access Token</Label>
              <Input
                data-testid="input-access-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="daily access_token"
                className="font-mono-data mt-1"
                autoComplete="off"
              />
            </div>
          ) : (
            <>
              <VaultSecretField
                id="kite-api-secret"
                label="API Secret"
                testId="input-api-secret"
                value={apiSecret}
                onChange={setApiSecret}
                stored={secretStored && !apiSecret}
                hint={null}
                onClear={clearApiSecret}
                placeholder="from your Kite Connect app"
              />
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Request Token</Label>
                <Input
                  data-testid="input-request-token"
                  value={requestToken}
                  onChange={(e) => setRequestToken(e.target.value)}
                  placeholder="from the ?request_token=… URL after login"
                  className="font-mono-data mt-1"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                data-testid="link-kite-login"
                onClick={openKiteLogin}
                className="text-xs text-sky-700 hover:text-sky-900 inline-flex items-center gap-1 hover:underline"
              >
                1) Click here to login and get request_token <ExternalLink className="w-3 h-3" />
              </button>
              {keyStored && secretStored ? (
                <p className="text-[11px] text-slate-500">
                  Key &amp; secret are vaulted — login opens with your saved API key. Paste request_token, then Save &amp; Go Live.
                </p>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Enter key + secret once. They are stored as Fernet ciphertext; daily refresh only needs request_token.
                </p>
              )}
            </>
          )}

          {(status?.configured || vault?.has_api_key) && (
            <div className="text-xs text-slate-500 font-mono-data">
              Current key: {vault?.api_key_hint || status?.api_key_hint}
              {status?.updated_at ? ` · updated ${String(status.updated_at).slice(0, 19).replace("T", " ")}` : ""}
              {vault?.storage ? " · Fernet vault" : ""}
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
        <div className="flex items-center justify-between pt-2 gap-2 flex-wrap">
          <Button
            data-testid="btn-save-credentials"
            onClick={submit}
            disabled={saving}
            className="rounded-sm bg-slate-900 hover:bg-slate-800"
          >
            {saving ? "Saving..." : "Save & Go Live"}
          </Button>
          {genMode && (apiKey.trim() || apiSecret.trim()) && (
            <Button
              type="button"
              variant="outline"
              data-testid="btn-save-vault-only"
              disabled={saving}
              className="rounded-sm"
              onClick={async () => {
                setSaving(true);
                try {
                  const v = await persistKeySecretIfTyped();
                  if (v?.needs_reauth) {
                    toast.message("API key updated — login with request_token (or paste access_token) to go live");
                    onSaved?.();
                  } else {
                    toast.success("API key / secret saved encrypted");
                  }
                } catch (e) {
                  toast.error(e?.response?.data?.detail || "Vault save failed");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save key &amp; secret
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
