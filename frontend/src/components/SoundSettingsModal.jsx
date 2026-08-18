import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Volume2, Play } from "lucide-react";
import { toast } from "sonner";
import { SOUND_PATTERNS, DEFAULT_SOUND_PREFS, loadSoundPrefs, saveSoundPrefs, playPattern, unlockSounds } from "@/lib/sounds";

const ALERT_KINDS = [
  { key: "reversal",    label: "OI Reversal (server alerts)",       hint: "Fires when the backend detects a directional OI reversal on the currently viewed index." },
  { key: "huge_shift",  label: "HUGE OI Shift (≥ 1 Cr ATM band)",     hint: "Blocking modal fires when aggregate ΔOI across ATM ± 1 crosses your threshold." },
  { key: "gamma_wall",  label: "Gamma Wall detected",                 hint: "Fires when a single strike CE or PE gains ≥ gamma-wall threshold within its window." },
  { key: "institution", label: "Institutional footprint",             hint: "Fires when OI + Volume + Premium all cross the institutional thresholds on one strike." },
  { key: "velocity",    label: "Fast OI velocity",                    hint: "Fires when a single strike's ROI change per minute crosses the 🔥 Fast threshold." },
  { key: "adjustment",  label: "Position adjustment breach",          hint: "Fires when your short-strike position breaches the configured band-covered percentage." },
];

export default function SoundSettingsModal({ open, onOpenChange }) {
  const [prefs, setPrefs] = useState(loadSoundPrefs());

  useEffect(() => {
    if (open) setPrefs(loadSoundPrefs());
  }, [open]);

      const setKind = (k, v) => setPrefs((p) => ({ ...p, [k]: v }));

  const preview = async (id) => {
    await unlockSounds();
    playPattern(id);
  };

  const save = () => {
    saveSoundPrefs(prefs);
    toast.success("Sound preferences saved");
    onOpenChange(false);
  };

  const reset = () => {
    setPrefs({ ...DEFAULT_SOUND_PREFS });
    toast.info("Reset to defaults (click Save to apply)");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sound-settings-modal" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="w-4 h-4" />
            Alert Sound Preferences
          </DialogTitle>
          <DialogDescription>
            Pick a distinct sound for each alert type. Click ▶ to preview each pattern.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {ALERT_KINDS.map((k) => (
            <div key={k.key} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{k.label}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{k.hint}</div>
              </div>
              <select
                value={prefs[k.key] || "beep"}
                onChange={(e) => setKind(k.key, e.target.value)}
                data-testid={`sound-${k.key}`}
                className="h-8 text-xs px-2 border border-slate-200 dark:border-slate-700 rounded-sm bg-white dark:bg-slate-800 dark:text-slate-100"
              >
                {SOUND_PATTERNS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <Button
                size="sm" variant="outline"
                className="h-8 rounded-sm dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                onClick={() => preview(prefs[k.key] || "beep")}
                data-testid={`sound-play-${k.key}`}
                title="Preview"
              >
                <Play className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-slate-700">
          <Button variant="ghost" size="sm" onClick={reset} className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-300" data-testid="btn-sound-reset">
            Reset
          </Button>
          <Button onClick={save} className="rounded-sm bg-slate-900 hover:bg-slate-800" data-testid="btn-sound-save">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
