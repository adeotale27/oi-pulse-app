import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";

const ALL_INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];

export default function SettingsModal({ open, onOpenChange, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get("/settings").then((r) => setSettings(r.data));
  }, [open]);

  if (!settings) return null;

  const toggleIndex = (idx) => {
    const cur = new Set(settings.enabled_indices || []);
    if (cur.has(idx)) cur.delete(idx);
    else cur.add(idx);
    setSettings({ ...settings, enabled_indices: Array.from(cur) });
  };

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/settings", settings);
      toast.success("Alert settings saved");
      onSaved?.(settings);
      onOpenChange(false);
    } catch (e) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settings-modal" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Alert Settings
          </DialogTitle>
          <DialogDescription>
            Configure when OI reversal alerts should trigger.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div>
            <div className="flex justify-between mb-1">
              <Label className="text-xs uppercase tracking-wider text-slate-500">
                OI change threshold
              </Label>
              <span className="text-xs font-mono-data font-semibold">
                {settings.threshold_pct}%
              </span>
            </div>
            <Slider
              data-testid="slider-threshold"
              min={5}
              max={50}
              step={1}
              value={[settings.threshold_pct]}
              onValueChange={(v) => setSettings({ ...settings, threshold_pct: v[0] })}
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <Label className="text-xs uppercase tracking-wider text-slate-500">
                Compare with snapshot from
              </Label>
              <span className="text-xs font-mono-data font-semibold">
                {settings.compare_minutes} min ago
              </span>
            </div>
            <Slider
              data-testid="slider-compare"
              min={1}
              max={30}
              step={1}
              value={[settings.compare_minutes]}
              onValueChange={(v) => setSettings({ ...settings, compare_minutes: v[0] })}
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <Label className="text-xs uppercase tracking-wider text-slate-500">
                Alert cooldown
              </Label>
              <span className="text-xs font-mono-data font-semibold">
                {settings.cooldown_seconds}s
              </span>
            </div>
            <Slider
              data-testid="slider-cooldown"
              min={30}
              max={600}
              step={30}
              value={[settings.cooldown_seconds]}
              onValueChange={(v) => setSettings({ ...settings, cooldown_seconds: v[0] })}
            />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">
              Tracked indices
            </Label>
            <div className="space-y-1.5">
              {ALL_INDICES.map((idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-2 py-1 px-2 rounded-sm hover:bg-slate-50 cursor-pointer"
                >
                  <Checkbox
                    data-testid={`enabled-${idx}`}
                    checked={settings.enabled_indices?.includes(idx)}
                    onCheckedChange={() => toggleIndex(idx)}
                  />
                  <span className="text-sm font-medium">{idx}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button
            data-testid="btn-save-settings"
            onClick={submit}
            disabled={saving}
            className="rounded-sm bg-slate-900 hover:bg-slate-800"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
