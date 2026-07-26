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
import { loadOISettings, saveOISettings, DEFAULT_OI_SETTINGS } from "@/lib/oiSettings";
import InfoTip from "@/components/InfoTip";

const ALL_INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const DASHBOARD_PAGES = [
  { id: "oi-change", label: "OI Change" },
  { id: "open-interest", label: "Open Interest" },
  { id: "strike-table", label: "Strike Table" },
  { id: "sell-candidates", label: "Sell Candidates" },
  { id: "buildup", label: "Build-up" },
  { id: "positions", label: "Positions" },
  { id: "alerts", label: "Alerts" },
  { id: "activity", label: "Activity" },
  { id: "holidays", label: "Events" },
  { id: "straddle", label: "Straddle" },
  { id: "index-events", label: "Index Risk" },
];

export default function SettingsModal({ open, onOpenChange, onSaved, onLocalSaved, isAdmin = false }) {
  const [settings, setSettings] = useState(null);
  const [local, setLocal] = useState(loadOISettings());
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setSettings(null);
    api.get("/settings")
      .then((r) => setSettings(r.data))
      .catch((e) => {
        setLoadError(e?.response?.data?.detail || e.message || "Failed to load settings");
        // Provide sensible defaults so the modal is still usable.
        setSettings({
          threshold_pct: 15,
          compare_minutes: 3,
          cooldown_seconds: 120,
          enabled_indices: ["NIFTY", "SENSEX"],
          visible_pages: DASHBOARD_PAGES.map((p) => p.id),
        });
      });
    setLocal(loadOISettings());
  }, [open]);

  const toggleIndex = (idx) => {
    const cur = new Set(settings.enabled_indices || []);
    if (cur.has(idx)) cur.delete(idx);
    else cur.add(idx);
    setSettings({ ...settings, enabled_indices: Array.from(cur) });
  };

  const toggleStraddleIndex = (idx) => {
    const cur = new Set(settings.straddle_enabled_indices || []);
    if (cur.has(idx)) cur.delete(idx);
    else cur.add(idx);
    setSettings({ ...settings, straddle_enabled_indices: Array.from(cur) });
  };

  const toggleVisiblePage = (pageId) => {
    const cur = new Set(Array.isArray(settings.visible_pages) ? settings.visible_pages : DASHBOARD_PAGES.map((p) => p.id));
    if (cur.has(pageId)) cur.delete(pageId);
    else cur.add(pageId);
    setSettings({ ...settings, visible_pages: Array.from(cur) });
  };

  const setLocalField = (k, v) => setLocal((prev) => ({ ...prev, [k]: v }));
  const setLot = (idx, v) => setLocal((prev) => ({ ...prev, lotSize: { ...prev.lotSize, [idx]: v } }));

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/settings", settings);
      saveOISettings(local);
      toast.success("Alert settings saved");
      onSaved?.(settings);
      onLocalSaved?.(local);
      onOpenChange(false);
    } catch (e) {
      toast.error("Failed to save settings: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const resetLocal = () => {
    setLocal({ ...DEFAULT_OI_SETTINGS });
    toast.info("Frontend thresholds reset to defaults (not yet saved)");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settings-modal" className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
              {isAdmin ? "Admin Settings" : "Settings"}
          </DialogTitle>
          <DialogDescription>
              Configure your alert thresholds and, if you are an admin, backend polling and public page visibility.
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2">
            ⚠️ {loadError} — using defaults. Save will retry.
          </div>
        )}

        {!settings ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading settings…</div>
        ) : (
        <>
        <div className="space-y-6 pt-2">
          {/* ------------- Backend reversal engine ------------- */}
          <section className="space-y-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Server-side OI reversal engine
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  OI change threshold
                  <InfoTip title="OI Change Threshold" testId="tip-threshold-pct">
                    The minimum % change in Call or Put OI that must occur (between the current snapshot and the compared one) before a reversal alert fires. Lower = more alerts, higher = only meaningful shifts.
                  </InfoTip>
                </Label>
                <span className="text-xs font-mono-data font-semibold">
                  {settings.threshold_pct ?? 15}%
                </span>
              </div>
              <Slider
                data-testid="slider-threshold"
                min={5}
                max={50}
                step={1}
                value={[settings.threshold_pct ?? 15]}
                onValueChange={(v) => setSettings({ ...settings, threshold_pct: v[0] })}
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  Compare with snapshot from
                  <InfoTip title="Compare Window" testId="tip-compare-min">
                    How many minutes back the reversal detector should look for the &quot;before&quot; snapshot. 3 min = quick reactions, 15+ min = smoother signals. Match this to your trading style.
                  </InfoTip>
                </Label>
                <span className="text-xs font-mono-data font-semibold">
                  {settings.compare_minutes ?? 3} min ago
                </span>
              </div>
              <Slider
                data-testid="slider-compare"
                min={1}
                max={30}
                step={1}
                value={[settings.compare_minutes ?? 3]}
                onValueChange={(v) => setSettings({ ...settings, compare_minutes: v[0] })}
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  Alert cooldown
                  <InfoTip title="Cooldown between alerts" testId="tip-cooldown">
                    Silences repeat alerts of the same kind for N seconds. Prevents notification spam when OI is trending. Start with 120 s (2 min); raise if you get too many, lower if you want faster warnings.
                  </InfoTip>
                </Label>
                <span className="text-xs font-mono-data font-semibold">
                  {settings.cooldown_seconds ?? 120}s
                </span>
              </div>
              <Slider
                data-testid="slider-cooldown"
                min={30}
                max={600}
                step={30}
                value={[settings.cooldown_seconds ?? 120]}
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
          </section>

          {/* ------------- Data Collection Poll Intervals ------------- */}
          {isAdmin && (
            <>
              <section className="space-y-4 pt-2 border-t border-slate-200">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Data Collection (Admin Only)
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block flex items-center gap-1">
                    OI Data Pull Interval
                    <InfoTip title="OI Poll Interval">
                      How frequently to pull OI data from the market. Options: 15s (frequent), 30s (balanced), 60s (conservative).
                    </InfoTip>
                  </Label>
                  <div className="flex gap-2">
                    {[15, 30, 60].map((val) => (
                      <Button
                        key={val}
                        variant={settings.oi_poll_interval_seconds === val ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSettings({ ...settings, oi_poll_interval_seconds: val })}
                        className="flex-1 text-xs"
                      >
                        {val}s
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block flex items-center gap-1">
                    Straddle Data Pull Interval
                    <InfoTip title="Straddle Poll Interval">
                      How frequently to pull straddle premium data. Default 60s (1 minute).
                    </InfoTip>
                  </Label>
                  <div className="flex gap-2">
                    {[30, 60, 120].map((val) => (
                      <Button
                        key={val}
                        variant={settings.straddle_poll_interval_seconds === val ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSettings({ ...settings, straddle_poll_interval_seconds: val })}
                        className="flex-1 text-xs"
                      >
                        {val}s
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">
                    Straddle Data — Tracked Indices
                  </Label>
                  <div className="space-y-1.5">
                    {ALL_INDICES.map((idx) => (
                      <label
                        key={idx}
                        className="flex items-center gap-2 py-1 px-2 rounded-sm hover:bg-slate-50 cursor-pointer"
                      >
                        <Checkbox
                          data-testid={`straddle-enabled-${idx}`}
                          checked={settings.straddle_enabled_indices?.includes(idx)}
                          onCheckedChange={() => toggleStraddleIndex(idx)}
                        />
                        <span className="text-sm font-medium">{idx}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-2 border-t border-slate-200">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Public dashboard pages
                </div>
                <div className="text-xs text-slate-500">
                  Choose which dashboard pages should be visible to public visitors. Admin users still see all pages.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DASHBOARD_PAGES.map((page) => (
                    <label
                      key={page.id}
                      className="flex items-center gap-2 py-2 px-3 rounded-sm hover:bg-slate-50 cursor-pointer border border-slate-200"
                    >
                      <Checkbox
                        data-testid={`visible-page-${page.id}`}
                        checked={(Array.isArray(settings.visible_pages) ? settings.visible_pages : DASHBOARD_PAGES.map((p) => p.id)).includes(page.id)}
                        onCheckedChange={() => toggleVisiblePage(page.id)}
                      />
                      <div>
                        <div className="text-sm font-medium">{page.label}</div>
                        {page.id === "sell-candidates" || page.id === "positions" ? (
                          <div className="text-[10px] text-slate-500">Admin-only page</div>
                        ) : null}
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            </>
          )}
          <section className="space-y-3 pt-2 border-t border-slate-200">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1">
              Huge OI shift popup (ATM ± 1 strikes)
              <InfoTip title="Huge OI Shift Popup">
                Blocking modal that fires when the total change in Call OR Put OI across the ATM strike and its neighbours (ATM+step, ATM-step) crosses your threshold in any monitored window. Meant to catch massive institutional footprints you should NEVER miss.
              </InfoTip>
            </div>
            <NumberField
              label="Threshold (per side, aggregate |ΔOI|)"
              hint="Sum of CE or PE ΔOI across ATM, ATM+step and ATM-step. In OI contracts."
              value={local.hugeShiftAbs}
              onChange={(v) => setLocalField("hugeShiftAbs", v)}
              testId="huge-shift-abs"
              min={100000}
              step={100000}
              suffix={local.hugeShiftAbs >= 1e7 ? `${(local.hugeShiftAbs / 1e7).toFixed(2)} Cr` : `${(local.hugeShiftAbs / 1e5).toFixed(2)} L`}
            />
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">
                Windows monitored
              </Label>
              <div className="flex gap-2 flex-wrap">
                {[1, 3, 5, 10, 15].map((w) => {
                  const checked = local.hugeShiftWindows.includes(w);
                  return (
                    <label key={w} className="inline-flex items-center gap-1 text-xs cursor-pointer">
                      <Checkbox
                        data-testid={`huge-shift-window-${w}`}
                        checked={checked}
                        onCheckedChange={(ck) => {
                          const set = new Set(local.hugeShiftWindows);
                          if (ck) set.add(w); else set.delete(w);
                          setLocalField("hugeShiftWindows", Array.from(set).sort((a, b) => a - b));
                        }}
                      />
                      {w}m
                    </label>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ------------- Gamma wall ------------- */}
          <section className="space-y-3 pt-2 border-t border-slate-200">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1">
              Gamma wall detection
              <InfoTip title="Gamma Wall">
                A single strike where institutions dump a huge amount of OI in a short window — usually to defend that price. Once flagged as a &quot;wall&quot;, the market often struggles to cross it. Threshold: how much CE or PE OI must build on ONE strike within the window below.
              </InfoTip>
            </div>
            <NumberField
              label="Min single-strike ΔOI"
              hint="Absolute OI added on either side of a single strike within the window below."
              value={local.gammaWallAbs}
              onChange={(v) => setLocalField("gammaWallAbs", v)}
              testId="gamma-wall-abs"
              min={10000}
              step={10000}
              suffix={local.gammaWallAbs >= 1e5 ? `${(local.gammaWallAbs / 1e5).toFixed(2)} L` : `${(local.gammaWallAbs / 1e3).toFixed(1)} K`}
            />
            <NumberField
              label="Window (minutes)"
              hint="If active timeframe ≥ window, threshold applies as-is. Smaller timeframes scale proportionally."
              value={local.gammaWallMinutes}
              onChange={(v) => setLocalField("gammaWallMinutes", v)}
              testId="gamma-wall-min"
              min={1}
              step={1}
            />
          </section>

          {/* ------------- Velocity badges ------------- */}
          <section className="space-y-3 pt-2 border-t border-slate-200">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1">
              OI velocity badges (per strike)
              <InfoTip title="OI Velocity">
                Rate of OI change per minute. Fast build-up = fresh aggressive positioning; Medium = normal; Slow = little conviction. Helps identify which strikes are getting the most fresh money right now.
              </InfoTip>
            </div>
            <NumberField
              label="🔥 Fast build-up ≥"
              hint="OI change per minute (absolute)"
              value={local.velocityFastMin}
              onChange={(v) => setLocalField("velocityFastMin", v)}
              testId="vel-fast"
              min={1000}
              step={1000}
            />
            <NumberField
              label="🟢 Medium ≥"
              value={local.velocityMediumMin}
              onChange={(v) => setLocalField("velocityMediumMin", v)}
              testId="vel-med"
              min={100}
              step={100}
            />
          </section>

          {/* ------------- Institutional detector ------------- */}
          <section className="space-y-3 pt-2 border-t border-slate-200">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1">
              🏦 Institutional activity detector
              <InfoTip title="Institutional Activity">
                Flags strikes where all THREE conditions hit at once: high open interest, above-average volume, and total premium value (LTP × OI × lot size) ≥ ₹X Crore. When all three trigger, an institution is almost certainly parked on that strike.
              </InfoTip>
            </div>
            <NumberField
              label="Min OI"
              value={local.instOiMin}
              onChange={(v) => setLocalField("instOiMin", v)}
              testId="inst-oi-min"
              min={1000}
              step={1000}
            />
            <NumberField
              label="Min premium (₹ Cr) — LTP × OI × lot"
              value={local.instPremiumCr}
              onChange={(v) => setLocalField("instPremiumCr", v)}
              testId="inst-prem-cr"
              min={1}
              step={1}
              suffix="Cr"
            />
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">
                Lot sizes
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {ALL_INDICES.map((idx) => (
                  <div key={idx} className="flex flex-col">
                    <span className="text-[10px] text-slate-500 mb-0.5">{idx}</span>
                    <Input
                      type="number"
                      min={1}
                      value={local.lotSize?.[idx] ?? ""}
                      onChange={(e) => setLot(idx, Number(e.target.value) || 0)}
                      className="h-8 text-xs"
                      data-testid={`lot-${idx}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-slate-200">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetLocal}
            className="text-xs text-slate-500 hover:text-slate-800"
            data-testid="btn-reset-local"
          >
            Reset thresholds
          </Button>
          <Button
            data-testid="btn-save-settings"
            onClick={submit}
            disabled={saving}
            className="rounded-sm bg-slate-900 hover:bg-slate-800"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NumberField({ label, hint, value, onChange, testId, min, step, suffix }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <Label className="text-xs text-slate-700">{label}</Label>
        {suffix && (
          <span className="text-[10px] text-slate-500 font-mono-data">{suffix}</span>
        )}
      </div>
      <Input
        data-testid={testId}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 text-xs font-mono-data"
      />
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
