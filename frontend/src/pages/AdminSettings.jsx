import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save, Loader2, ChevronDown, ShieldCheck, KeyRound, IndianRupee, PlugZap } from "lucide-react";
import "@/styles/landing.css";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function AdminSettings() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [openBroker, setOpenBroker] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/platform/config");
        setCfg(normalise(data));
      } catch (err) {
        if (err?.response?.status === 401) {
          toast.error("Admin sign-in required");
          nav("/admin", { replace: true });
          return;
        }
        toast.error("Could not load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  function normalise(d) {
    return {
      pricing: {
        currency: d?.pricing?.currency || "INR",
        premium: {
          monthly: d?.pricing?.premium?.monthly ?? 999,
          quarterly: d?.pricing?.premium?.quarterly ?? 2499,
          yearly: d?.pricing?.premium?.yearly ?? 7999,
        },
      },
      google: {
        enabled: !!d?.google?.enabled,
        client_id: d?.google?.client_id || "",
        client_secret_set: d?.google?.client_secret === "set",
        client_secret: "",
        redirect_uri: d?.google?.redirect_uri || "https://striklenz.com/login",
      },
      razorpay: {
        enabled: !!d?.razorpay?.enabled,
        key_id: d?.razorpay?.key_id || "",
        key_secret_set: d?.razorpay?.key_secret === "set",
        key_secret: "",
      },
      brokers: (d?.brokers || []).map((b) => ({
        id: b.id, name: b.name, capabilities: b.capabilities || [],
        enabled: !!b.enabled,
        client_id: b.client_id || "",
        client_secret_set: b.client_secret === "set",
        client_secret: "",
        redirect_uri: b.redirect_uri || "",
      })),
    };
  }

  const set = (path, val) => setCfg((c) => {
    const n = JSON.parse(JSON.stringify(c));
    let o = n; const parts = path.split(".");
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
    return n;
  });
  const setBroker = (i, key, val) => setCfg((c) => {
    const n = JSON.parse(JSON.stringify(c));
    n.brokers[i][key] = val; return n;
  });

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        pricing: { currency: cfg.pricing.currency, premium: {
          monthly: Number(cfg.pricing.premium.monthly) || 0,
          quarterly: Number(cfg.pricing.premium.quarterly) || 0,
          yearly: Number(cfg.pricing.premium.yearly) || 0,
        } },
        google: {
          enabled: cfg.google.enabled,
          client_id: cfg.google.client_id,
          redirect_uri: cfg.google.redirect_uri,
          ...(cfg.google.client_secret ? { client_secret: cfg.google.client_secret } : {}),
        },
        razorpay: {
          enabled: cfg.razorpay.enabled,
          key_id: cfg.razorpay.key_id,
          ...(cfg.razorpay.key_secret ? { key_secret: cfg.razorpay.key_secret } : {}),
        },
        brokers: cfg.brokers.map((b) => ({
          id: b.id, enabled: b.enabled, client_id: b.client_id, redirect_uri: b.redirect_uri,
          ...(b.client_secret ? { client_secret: b.client_secret } : {}),
        })),
      };
      await api.post("/admin/platform/config", payload);
      toast.success("Settings saved");
      const { data } = await api.get("/admin/platform/config");
      setCfg(normalise(data));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="slz slz-light flex min-h-screen items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading settings…</div>;
  }
  if (!cfg) return null;

  return (
    <div className="slz slz-light min-h-screen pb-20">
      <header className="sticky top-0 z-30 slz-glass border-b border-slate-200">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <OiPulseLogo className="h-8 w-8" pulse={false} />
            <span className="text-lg font-bold text-slate-900">Strik<span className="text-emerald-600">lenz</span> <span className="text-slate-400">/ Admin Settings</span></span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
            <button onClick={save} disabled={saving} className="slz-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-5 pt-8">
        {/* Pricing */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2"><IndianRupee className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Premium pricing</h2></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Monthly (₹)"><input type="number" className={inputCls} value={cfg.pricing.premium.monthly} onChange={(e) => set("pricing.premium.monthly", e.target.value)} /></Field>
            <Field label="Quarterly (₹)"><input type="number" className={inputCls} value={cfg.pricing.premium.quarterly} onChange={(e) => set("pricing.premium.quarterly", e.target.value)} /></Field>
            <Field label="Yearly (₹)"><input type="number" className={inputCls} value={cfg.pricing.premium.yearly} onChange={(e) => set("pricing.premium.yearly", e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-xs text-slate-400">These prices drive the public pricing section instantly after saving.</p>
        </section>

        {/* Google */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Google Sign-In</h2></div>
            <Toggle checked={cfg.google.enabled} onChange={(v) => set("google.enabled", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client ID"><input className={inputCls} value={cfg.google.client_id} onChange={(e) => set("google.client_id", e.target.value)} placeholder="xxxx.apps.googleusercontent.com" /></Field>
            <Field label="Client Secret" hint={cfg.google.client_secret_set ? "A secret is saved. Leave blank to keep it." : "Not set yet."}>
              <input type="password" className={inputCls} value={cfg.google.client_secret} onChange={(e) => set("google.client_secret", e.target.value)} placeholder={cfg.google.client_secret_set ? "•••••••• (saved)" : "Paste secret"} />
            </Field>
            <Field label="Redirect URI" hint="Add this exact URI to your Google OAuth client."><input className={inputCls} value={cfg.google.redirect_uri} onChange={(e) => set("google.redirect_uri", e.target.value)} /></Field>
          </div>
        </section>

        {/* Razorpay */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-slate-900">Razorpay (Premium payments)</h2></div>
            <Toggle checked={cfg.razorpay.enabled} onChange={(v) => set("razorpay.enabled", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key ID"><input className={inputCls} value={cfg.razorpay.key_id} onChange={(e) => set("razorpay.key_id", e.target.value)} placeholder="rzp_live_xxx" /></Field>
            <Field label="Key Secret" hint={cfg.razorpay.key_secret_set ? "A secret is saved. Leave blank to keep it." : "Not set yet."}>
              <input type="password" className={inputCls} value={cfg.razorpay.key_secret} onChange={(e) => set("razorpay.key_secret", e.target.value)} placeholder={cfg.razorpay.key_secret_set ? "•••••••• (saved)" : "Paste secret"} />
            </Field>
          </div>
        </section>

        {/* Brokers */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2"><PlugZap className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Broker integrations</h2></div>
          <p className="mb-4 text-xs text-slate-400">Enable a broker and paste its OAuth credentials. Zerodha stays managed by the existing integration.</p>
          <div className="space-y-2">
            {cfg.brokers.map((b, i) => (
              <div key={b.id} className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between px-4 py-3">
                  <button className="flex items-center gap-2 text-left" onClick={() => setOpenBroker(openBroker === b.id ? null : b.id)}>
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition ${openBroker === b.id ? "rotate-180" : ""}`} />
                    <span className="font-semibold text-slate-800">{b.name}</span>
                    <span className="hidden gap-1 sm:flex">{b.capabilities.slice(0, 4).map((c) => <span key={c} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">{c}</span>)}</span>
                  </button>
                  <Toggle checked={b.enabled} onChange={(v) => setBroker(i, "enabled", v)} />
                </div>
                {openBroker === b.id && (
                  <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-2">
                    <Field label="Client / API Key"><input className={inputCls} value={b.client_id} onChange={(e) => setBroker(i, "client_id", e.target.value)} /></Field>
                    <Field label="API Secret" hint={b.client_secret_set ? "Saved. Leave blank to keep." : "Not set yet."}>
                      <input type="password" className={inputCls} value={b.client_secret} onChange={(e) => setBroker(i, "client_secret", e.target.value)} placeholder={b.client_secret_set ? "•••••••• (saved)" : "Paste secret"} />
                    </Field>
                    <Field label="Redirect URI"><input className={inputCls} value={b.redirect_uri} onChange={(e) => setBroker(i, "redirect_uri", e.target.value)} placeholder="https://striklenz.com/broker/callback" /></Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
