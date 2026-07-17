import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Send, Sparkles, BellOff } from "lucide-react";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const TYPE_ROWS = [
  { key: "oi_reversal", label: "OI reversal alerts", hint: "Backend detects PE/CE % spikes vs N-min ago" },
  { key: "huge_shift", label: "Huge OI shift popup", hint: "Same events that trigger the on-screen popup" },
  { key: "huge_shift_major_only", label: "…but only MAJOR shifts (≥ threshold below)", hint: "Filters out small shifts", nested: true },
  { key: "market_open", label: "Market open ping", hint: "One message at 9:00 AM IST" },
  { key: "market_close", label: "Market close ping", hint: "One message at 3:30 PM IST" },
  { key: "daily_digest", label: "Daily digest at 3:30 PM", hint: "Total alerts + biggest reversals + closing OI" },
  { key: "kite_token", label: "Kite token issue", hint: "8:45 AM check-in if daily token has expired" },
  { key: "tracker_errors", label: "Tracker errors / stops", hint: "Critical — recommended ON" },
];

const PRESETS = [
  { name: "everything",         label: "Everything ON",     tone: "slate"   },
  { name: "nifty_only",         label: "NIFTY only",        tone: "blue"    },
  { name: "sensex_only",        label: "SENSEX only",       tone: "amber"   },
  { name: "banknifty_only",     label: "BANKNIFTY only",    tone: "purple"  },
  { name: "morning_only",       label: "Morning only (9-10:30)", tone: "emerald" },
  { name: "digest_only",        label: "Digest & critical only", tone: "slate" },
  { name: "major_shifts_only",  label: "Major shifts only", tone: "rose" },
  { name: "off",                label: "Mute all",          tone: "slate"   },
];

const toneClasses = {
  slate:   "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300",
  blue:    "bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200",
  amber:   "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200",
  purple:  "bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200",
  emerald: "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200",
  rose:    "bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200",
};

// Convert raw contracts → lakh string for the threshold input UX.
const toLakh = (raw) => (raw ? (raw / 100000).toFixed(0) : "0");
const fromLakh = (l) => Math.max(0, Math.round(Number(l) * 100000));

export default function TelegramPrefsModal({ open, onOpenChange }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [majorLakh, setMajorLakh] = useState("200"); // 2 Cr default

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [{ data: p }, { data: s }] = await Promise.all([
          api.get("/telegram/prefs"),
          api.get("/telegram/status"),
        ]);
        setPrefs(p);
        setStatus(s);
        setMajorLakh(toLakh(p.major_abs_threshold));
      } catch (e) {
        toast.error("Could not load Telegram preferences");
      }
    })();
  }, [open]);

  const save = async (patch) => {
    setSaving(true);
    try {
      const { data } = await api.post("/telegram/prefs", patch);
      setPrefs(data);
      setMajorLakh(toLakh(data.major_abs_threshold));
      toast.success("Preferences saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const applyPreset = async (name) => {
    setSaving(true);
    try {
      const { data } = await api.post(`/telegram/prefs/preset/${name}`);
      setPrefs(data);
      setMajorLakh(toLakh(data.major_abs_threshold));
      toast.success(`Applied preset: ${name.replace(/_/g, " ")}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preset failed");
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    try {
      await api.post("/telegram/test");
      toast.success("Test message sent to Telegram");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test send failed");
    }
  };

  if (!prefs) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Telegram Preferences</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
        </DialogContent>
      </Dialog>
    );
  }

  const toggleIndex = (idx) => save({ indices: { ...prefs.indices, [idx]: !prefs.indices[idx] } });
  const toggleType  = (key) => save({ types:   { ...prefs.types,   [key]: !prefs.types[key]   } });
  const toggleQuiet = ()    => save({ quiet_hours: { ...prefs.quiet_hours, enabled: !prefs.quiet_hours.enabled } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="tg-prefs-modal" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            Telegram Preferences
          </DialogTitle>
          <DialogDescription>
            Pick exactly what you want to receive. Change any time — takes effect on the next alert.
            {status && !status.configured && (
              <span className="block mt-1 text-rose-600">
                Bot not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in backend/.env.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Master switch ---- */}
        <div className="flex items-center justify-between p-3 rounded-sm border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            {prefs.enabled ? <Send className="w-4 h-4 text-emerald-600" /> : <BellOff className="w-4 h-4 text-slate-400" />}
            <div>
              <div className="text-sm font-semibold">Master switch</div>
              <div className="text-xs text-slate-500">
                {prefs.enabled ? "Telegram alerts ON" : "All alerts muted (except critical errors)"}
              </div>
            </div>
          </div>
          <Switch
            data-testid="tg-master-toggle"
            checked={!!prefs.enabled}
            onCheckedChange={() => save({ enabled: !prefs.enabled })}
            disabled={saving}
          />
        </div>

        {/* ---- Presets ---- */}
        <div>
          <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Quick presets
          </Label>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                data-testid={`tg-preset-${p.name}`}
                onClick={() => applyPreset(p.name)}
                disabled={saving}
                className={`text-xs px-2 py-2 rounded-sm border ${toneClasses[p.tone]} transition text-left`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Indices ---- */}
        <div>
          <Label className="text-xs uppercase tracking-wider text-slate-500">Indices</Label>
          <div className="grid grid-cols-3 gap-2 mt-1.5">
            {INDICES.map((idx) => (
              <button
                key={idx}
                data-testid={`tg-idx-${idx}`}
                onClick={() => toggleIndex(idx)}
                disabled={saving}
                className={`text-xs px-2 py-2 rounded-sm border transition ${
                  prefs.indices[idx]
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                {prefs.indices[idx] ? "✓ " : ""}{idx}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Alert types ---- */}
        <div>
          <Label className="text-xs uppercase tracking-wider text-slate-500">Alert types</Label>
          <div className="space-y-1.5 mt-1.5">
            {TYPE_ROWS.map((row) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-2 p-2 rounded-sm border ${
                  row.nested ? "border-slate-100 bg-slate-50/60 ml-4" : "border-slate-200"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm">{row.label}</div>
                  {row.hint && <div className="text-[11px] text-slate-500">{row.hint}</div>}
                </div>
                <Switch
                  data-testid={`tg-type-${row.key}`}
                  checked={!!prefs.types?.[row.key]}
                  onCheckedChange={() => toggleType(row.key)}
                  disabled={saving}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ---- Major shift threshold ---- */}
        <div className="p-3 rounded-sm border border-slate-200 bg-white">
          <Label className="text-xs uppercase tracking-wider text-slate-500">
            Major shift threshold (lakhs) — triggers BUY / SELL banner
          </Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              data-testid="tg-major-threshold"
              type="number"
              min="1"
              value={majorLakh}
              onChange={(e) => setMajorLakh(e.target.value)}
              onBlur={() => save({ major_abs_threshold: fromLakh(majorLakh) })}
              className="font-mono-data w-32"
            />
            <span className="text-xs text-slate-500">
              lakhs contracts &nbsp;·&nbsp; current: <b>{toLakh(prefs.major_abs_threshold)} L</b> ({(prefs.major_abs_threshold / 10000000).toFixed(2)} Cr)
            </span>
          </div>
        </div>

        {/* ---- Quiet hours ---- */}
        <div className="p-3 rounded-sm border border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Quiet hours (IST) — morning-only mode</Label>
              <div className="text-xs text-slate-500 mt-0.5">
                When ON, alerts are sent only inside this window.
              </div>
            </div>
            <Switch
              data-testid="tg-quiet-toggle"
              checked={!!prefs.quiet_hours?.enabled}
              onCheckedChange={toggleQuiet}
              disabled={saving}
            />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Input
              data-testid="tg-quiet-start"
              value={prefs.quiet_hours?.start || "09:00"}
              onChange={(e) => setPrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, start: e.target.value } })}
              onBlur={(e) => save({ quiet_hours: { ...prefs.quiet_hours, start: e.target.value } })}
              className="font-mono-data w-24"
              placeholder="HH:MM"
            />
            <span className="text-xs text-slate-500">to</span>
            <Input
              data-testid="tg-quiet-end"
              value={prefs.quiet_hours?.end || "10:30"}
              onChange={(e) => setPrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, end: e.target.value } })}
              onBlur={(e) => save({ quiet_hours: { ...prefs.quiet_hours, end: e.target.value } })}
              className="font-mono-data w-24"
              placeholder="HH:MM"
            />
            <span className="text-xs text-slate-400">(24-hr IST)</span>
          </div>
        </div>

        {/* ---- Test button ---- */}
        <div className="flex items-center justify-between pt-1">
          <Button
            data-testid="tg-send-test"
            variant="outline"
            className="rounded-sm"
            onClick={sendTest}
            disabled={!status?.configured}
          >
            <Send className="w-3 h-3 mr-1.5" />
            Send test message
          </Button>
          <div className="text-xs text-slate-400">
            {saving ? "Saving…" : "Changes save automatically"}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
