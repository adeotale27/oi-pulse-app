import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeUserKiteSession } from "@/lib/api";
import { friendlyKiteConnectError } from "@/lib/kiteConnectError";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { APP_NAME } from "@/lib/appVersion";

const CANONICAL_HOST = "striklenz.com";

function isLegacyKiteHost(host) {
  return String(host || "").toLowerCase().includes("aaisnamkeen");
}

/**
 * Kite Connect redirect target. Exchange request_token server-side
 * (never stored in the browser) then return to Positions.
 */
export default function KiteCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [msg, setMsg] = useState("Connecting your Zerodha account…");

  useEffect(() => {
    if (typeof window !== "undefined" && isLegacyKiteHost(window.location.hostname)) {
      const dest = new URL(`https://${CANONICAL_HOST}/kite-callback`);
      dest.search = window.location.search;
      window.location.replace(dest.toString());
      return undefined;
    }
    const status = params.get("status");
    const token = params.get("request_token");
    if (status && status !== "success") {
      setMsg("Kite login was cancelled.");
      toast.error("Kite login cancelled");
      const t = setTimeout(() => navigate("/", { replace: true }), 1200);
      return () => clearTimeout(t);
    }
    if (!token) {
      setMsg("Missing request token. Return to Positions and try Connect Zerodha again.");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await completeUserKiteSession(token);
        if (cancelled) return;
        toast.success(`Zerodha connected${data?.kite_user_id ? ` · ${data.kite_user_id}` : ""}`);
        navigate("/?kite=connected", { replace: true });
      } catch (e) {
        if (cancelled) return;
        const detail = friendlyKiteConnectError(e?.response?.data?.detail || e.message || "Could not complete Kite login");
        setMsg(String(detail));
        toast.error(String(detail));
      }
    })();
    return () => { cancelled = true; };
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <OiPulseLogo className="h-12 w-12" />
      <div className="text-sm font-semibold text-slate-800">{APP_NAME}</div>
      <p className="text-[13px] text-slate-600 max-w-sm" data-testid="kite-callback-status">{msg}</p>
    </div>
  );
}
