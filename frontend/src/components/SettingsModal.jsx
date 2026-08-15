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

import { DESK_IDS, MCX_DESK_AVAILABLE, isMcxMajorId } from "@/lib/universe";

const ALL_INDICES = DESK_IDS;
const HARD_ADMIN_PAGES = new Set([]);
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
  { id: "cas", label: "CAS Expiry" },
];
const ALL_PAGE_IDS = DASHBOARD_PAGES.map((p) => p.id);

export default function SettingsModal({
  open,
  onOpenChange,
  onSaved,
  onLocalSaved,
  isAdmin = false,
}) {
  const [settings, setSettings] = useState(null);
  const [knownIndices, setKnownIndices] = useState(DESK_IDS);
  const [local, setLocal] = useState(loadOISettings());
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setSettings(null);
    api.get("/settings")
      .then((r) => {
        const d = r.data || {};
        setSettings(d);
        const known = Array.isArray(d.known_indices) ? d.known_indices : [];
        const enabled = Array.isArray(d.enabled_indices) ? d.enabled_indices : [];
        const pool = [...new Set([...DESK_IDS, ...known, ...enabled])]
          .filter((i) => MCX_DESK_AVAILABLE || !isMcxMajorId(i));
        if (pool.length) setKnownIndices(pool);
      })
      .catch((e) => {
        setLoadError(e?.response?.data?.detail || e.message || "Failed to load settings");
        // Provide sensible defaults so the modal is still usable.
        setSettings({
          threshold_pct: 15,
          compare_minutes: 3,
          cooldown_seconds: 120,
          enabled_indices: DESK_IDS,
          straddle_enabled_indices: ["NIFTY", "SENSEX"],
          oi_poll_interval_seconds: 15,
          straddle_poll_interval_seconds: 15,
          positions_poll_interval_seconds: 30,
          market_open_ist: "09:15",
          market_close_ist: "15:40",
          second_session_ist: "12:00",
          expire_admin_on_market_close: false,
          admin_session_ttl_minutes: 480,
          alert_enabled_indices: ["NIFTY"],
          show_strike_range: false,
          visible_pages: DASHBOARD_PAGES.filter((p) => !p.hardAdmin && p.id !== "cas").map((p) => p.id),
          admin_visible_pages: ALL_PAGE_IDS,
          show_writer_defense: true,
          show_suggestion: true,
          show_chart_signals: false,
        });
      });
    setLocal(loadOISettings());
  }, [open]);

  const toggleIndex = (idx) => {
    const cur = new Set(settings.enabled_indices || []);
    if (cur.has(idx)) {
      if (cur.size <= 1) {
        toast.error("Keep at least one tracked index");
        return;
      }
      cur.delete(idx);
    } else cur.add(idx);
    const pool = [...new Set([...knownIndices, ...(settings.enabled_indices || [])])];
    setSettings({ ...settings, enabled_indices: pool.filter((i) => cur.has(i)) });
  };

  const toggleAlertIndex = (idx) => {
    const cur = new Set(settings.alert_enabled_indices || []);
    if (cur.has(idx)) {
      if (cur.size <= 1) {
        toast.error("Keep at least one alert index");
        return;
      }
      cur.delete(idx);
    } else cur.add(idx);
    setSettings({ ...settings, alert_enabled_indices: Array.from(cur) });
  };

  const toggleStraddleIndex = (idx) => {
    const cur = new Set(settings.straddle_enabled_indices || []);
    if (cur.has(idx)) cur.delete(idx);
    else cur.add(idx);
    setSettings({ ...settings, straddle_enabled_indices: Array.from(cur) });
  };

  const toggleVisiblePage = (pageId) => {
    if (HARD_ADMIN_PAGES.has(pageId)) return;
    const cur = new Set(Array.isArray(settings.visible_pages) ? settings.visible_pages : ALL_PAGE_IDS);
    for (const id of HARD_ADMIN_PAGES) cur.delete(id);
    if (cur.has(pageId)) {
      if (cur.size <= 1) {
        toast.error("Keep at least one public page visible");
        return;
      }
      cur.delete(pageId);
    } else cur.add(pageId);
    setSettings({ ...settings, visible_pages: Array.from(cur) });
  };

  const toggleAdminPage = (pageId) => {
    const cur = new Set(
      Array.isArray(settings.admin_visible_pages) && settings.admin_visible_pages.length
        ? settings.admin_visible_pages
        : ALL_PAGE_IDS,
    );
    if (cur.has(pageId)) {
      if (cur.size <= 1) {
        toast.error("Keep at least one page on your dashboard");
        return;
      }
      cur.delete(pageId);
    } else cur.add(pageId);
    setSettings({ ...settings, admin_visible_pages: Array.from(cur) });
  };

  const setLocalField = (k, v) => setLocal((prev) => ({ ...prev, [k]: v }));
  const setLot = (idx, v) => setLocal((prev) => ({ ...prev, lotSize: { ...prev.lotSize, [idx]: v } }));

  const submit = async () => {
    setSaving(true);
    try {
      // Always persist local thresholds first so they aren't lost if server POST fails.
      saveOISettings(local);
      onLocalSaved?.(local);
      if (isAdmin) {
        let positionsPoll = parseInt(settings.positions_poll_interval_seconds, 10);
        if (!Number.isFinite(positionsPoll)) positionsPoll = 30;
        positionsPoll = Math.min(3600, Math.max(5, positionsPoll));
        const payload = {
          threshold_pct: settings.threshold_pct,
          cooldown_seconds: settings.cooldown_seconds,
          compare_minutes: settings.compare_minutes,
          enabled_indices: settings.enabled_indices,
          oi_poll_interval_seconds: settings.oi_poll_interval_seconds,
          straddle_poll_interval_seconds: settings.straddle_poll_interval_seconds,
          positions_poll_interval_seconds: positionsPoll,
          straddle_enabled_indices: settings.straddle_enabled_indices,
          market_open_ist: settings.market_open_ist,
          market_close_ist: settings.market_close_ist,
          second_session_ist: settings.second_session_ist,
          expire_admin_on_market_close: settings.expire_admin_on_market_close,
          admin_session_ttl_minutes: settings.admin_session_ttl_minutes,
          alert_enabled_indices: settings.alert_enabled_indices,
          show_strike_range: settings.show_strike_range,
          show_writer_defense: settings.show_writer_defense,
          show_suggestion: settings.show_suggestion,
          show_chart_signals: settings.show_chart_signals,
          visible_pages: Array.from(new Set(
            (Array.isArray(settings.visible_pages) ? settings.visible_pages : []).filter((id) => !HARD_ADMIN_PAGES.has(id)),
          )),
          admin_visible_pages: Array.from(new Set(
            (Array.isArray(settings.admin_visible_pages) && settings.admin_visible_pages.length
              ? settings.admin_visible_pages
              : ALL_PAGE_IDS
            ).filter((id) => !HARD_ADMIN_PAGES.has(id)),
          )),
        };
        if (!payload.visible_pages.length) {
          toast.error("Keep at least one public page visible");
          setSaving(false);
          return;
        }
        if (!payload.admin_visible_pages.length) {
          toast.error("Keep at least one page on your dashboard");
          setSaving(false);
          return;
        }
        const { data } = await api.post("/settings", payload);
        const saved = data || payload;
        setSettings(saved);
        toast.success("Settings saved — polling & alerts updated");
        onSaved?.(saved);
      } else {
        toast.success("Local thresholds saved");
      }
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
      <DialogContent data-testid="settings-modal" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
              {isAdmin ? "Admin configuration" : "Settings"}
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
                Tracked indices (polled every cycle)
              </Label>
              <div className="space-y-1.5">
                {knownIndices.map((idx) => (
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
              {isAdmin ? (
                <button
                  type="button"
                  className="mt-2 text-[11px] font-semibold text-emerald-700 hover:underline"
                  onClick={() => {
                    onOpenChange(false);
                    try { window.dispatchEvent(new CustomEvent("oi-admin-open-indices")); } catch (_) {}
                  }}
                >
                  Discover more indices from Kite…
                </button>
              ) : null}
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block flex items-center gap-1">
                Alert focus indices (today)
                <InfoTip title="Weekday alert defaults">
                  Defaults: Mon/Tue/Fri → NIFTY · Wed/Thu → SENSEX (weekly expiry focus).
                  Changing this saves an override for today only — resets to weekday default on the next day.
                  Tracked indices may still load OI for other indices; toast / sound / Telegram alerts fire only for the checked focus list.
                </InfoTip>
              </Label>
              <div className="text-[10px] text-slate-500 mb-2">
                {settings.alert_indices_override_date
                  ? `Manual override for ${settings.alert_indices_override_date} (resets tomorrow)`
                  : "Using weekday default — edit to override for today"}
              </div>
              <div className="space-y-1.5">
                {knownIndices.map((idx) => (
                  <label
                    key={`alert-${idx}`}
                    className="flex items-center gap-2 py-1 px-2 rounded-sm hover:bg-slate-50 cursor-pointer"
                  >
                    <Checkbox
                      data-testid={`alert-enabled-${idx}`}
                      checked={(settings.alert_enabled_indices || []).includes(idx)}
                      onCheckedChange={() => toggleAlertIndex(idx)}
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
                  Market hours &amp; admin policy (Admin Only)
                </div>
                <div className="text-xs text-slate-500">
                  Index F&amp;O closes at 15:40 IST under CAS rules (from 2026-08-03). Equity CAS stocks stop at 15:15; other equities at 15:30. This app polls OI until the close you set below.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Market open (IST)</Label>
                    <Input
                      data-testid="market-open-ist"
                      type="time"
                      value={settings.market_open_ist || "09:15"}
                      onChange={(e) => setSettings({ ...settings, market_open_ist: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Market close (IST)</Label>
                    <Input
                      data-testid="market-close-ist"
                      type="time"
                      value={settings.market_close_ist || "15:40"}
                      onChange={(e) => setSettings({ ...settings, market_close_ist: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">
                      2nd session notify (IST)
                    </Label>
                    <Input
                      data-testid="second-session-ist"
                      type="time"
                      value={settings.second_session_ist || "12:00"}
                      onChange={(e) => setSettings({ ...settings, second_session_ist: e.target.value })}
                      className="h-9 max-w-[12rem]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Big clock toast + desktop notify at this time (default 12:00).
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <Checkbox
                    data-testid="expire-admin-on-close"
                    checked={!!settings.expire_admin_on_market_close}
                    onCheckedChange={(ck) => setSettings({ ...settings, expire_admin_on_market_close: !!ck })}
                  />
                  <span className="text-sm">Expire admin sessions on market close (off by default)</span>
                </label>
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <Checkbox
                    data-testid="show-strike-range"
                    checked={!!settings.show_strike_range}
                    onCheckedChange={(ck) => setSettings({ ...settings, show_strike_range: !!ck })}
                  />
                  <span className="text-sm">Show Strike Range steppers in sidebar</span>
                </label>
                <div className="text-[10px] text-slate-500 -mt-1 pl-6">
                  Off by default. When on, Min/Max ± controls the OI chart window directly (step = index strike size).
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Admin session TTL (minutes)</Label>
                  <Input
                    data-testid="admin-session-ttl"
                    type="number"
                    min={30}
                    max={1440}
                    value={settings.admin_session_ttl_minutes ?? 480}
                    onChange={(e) => setSettings({ ...settings, admin_session_ttl_minutes: Number(e.target.value) || 480 })}
                    className="h-9"
                  />
                </div>
              </section>

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
                      How often to sample ATM straddle premium for the intraday chart. Default 15s (dense, FinanceDeft-style).
                    </InfoTip>
                  </Label>
                  <div className="flex gap-2">
                    {[15, 30, 60, 120].map((val) => (
                      <Button
                        key={val}
                        variant={settings.straddle_poll_interval_seconds === val ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSettings({ ...settings, straddle_poll_interval_seconds: val })}
                        className="flex-1 text-xs"
                        data-testid={`straddle-poll-${val}`}
                      >
                        {val}s
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block flex items-center gap-1">
                    Positions Auto-Refresh (seconds)
                    <InfoTip title="Positions Poll Interval">
                      How often the Positions desk reloads open Kite positions. Enter any whole number of seconds (5–3600). Countdown shows on the Refresh button. Default 30s.
                    </InfoTip>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={3600}
                      step={1}
                      value={settings.positions_poll_interval_seconds ?? 30}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setSettings({ ...settings, positions_poll_interval_seconds: "" });
                          return;
                        }
                        const n = parseInt(raw, 10);
                        if (!Number.isFinite(n)) return;
                        setSettings({ ...settings, positions_poll_interval_seconds: n });
                      }}
                      onBlur={() => {
                        let n = parseInt(settings.positions_poll_interval_seconds, 10);
                        if (!Number.isFinite(n)) n = 30;
                        n = Math.min(3600, Math.max(5, n));
                        setSettings({ ...settings, positions_poll_interval_seconds: n });
                      }}
                      className="w-28 h-8 text-sm font-mono-data"
                      data-testid="positions-poll-seconds"
                    />
                    <span className="text-xs text-slate-500">seconds</span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">
                    Straddle Data — Tracked Indices
                  </Label>
                  <div className="space-y-1.5">
                    {knownIndices.map((idx) => (
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
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-800">
                  Public / Admin dashboard pages
                </div>
                <div className="text-xs text-slate-500">
                  Tick <b>Public</b> to show a page to guests. Tick <b>Admin</b> to keep it on your own desk.
                  They are independent — you can hide a page from yourself without hiding it from guests, and the other way around.
                  Tick Positions (Public) so guests can Connect Zerodha. Last-upload stamps stay admin-only.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DASHBOARD_PAGES.map((page) => {
                    const hardAdmin = !!page.hardAdmin || HARD_ADMIN_PAGES.has(page.id);
                    const guestOn = hardAdmin
                      ? false
                      : (Array.isArray(settings.visible_pages) ? settings.visible_pages : ALL_PAGE_IDS).includes(page.id);
                    const adminList = Array.isArray(settings.admin_visible_pages) && settings.admin_visible_pages.length
                      ? settings.admin_visible_pages
                      : ALL_PAGE_IDS;
                    const adminOn = adminList.includes(page.id);
                    const hint = page.id === "index-events"
                      ? "Same Public / Admin ticks as every other page. Untick Admin to hide it on your desk; untick Public (or the header Public menu) to hide it from guests. Last-upload stamps stay admin-only."
                      : page.id === "positions"
                        ? "Guests see Connect Zerodha for their own book. Charts stay on your publisher token."
                        : page.id === "sell-candidates"
                          ? "Optional for guests — also on the Public icon menu."
                          : page.id === "cas"
                            ? "Guests can view; only admin can Activate / Live."
                            : null;
                    const tickClass = "rounded-full h-[18px] w-[18px] border-slate-300 shadow-none data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 data-[state=checked]:text-white";
                    return (
                    <div
                      key={page.id}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2.5 space-y-2"
                      data-testid={`dashboard-page-tile-${page.id}`}
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{page.label}</div>
                        {hint ? <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{hint}</div> : null}
                      </div>
                      <div className="flex items-center gap-5">
                        <label className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${hardAdmin ? "opacity-40" : "text-slate-700 cursor-pointer"}`}>
                          <Checkbox
                            data-testid={`visible-page-${page.id}`}
                            disabled={hardAdmin}
                            checked={guestOn}
                            onCheckedChange={() => toggleVisiblePage(page.id)}
                            aria-label={`${page.label} public`}
                            className={tickClass}
                          />
                          Public
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                          <Checkbox
                            data-testid={`admin-page-${page.id}`}
                            checked={adminOn}
                            onCheckedChange={() => toggleAdminPage(page.id)}
                            aria-label={`${page.label} admin`}
                            className={tickClass}
                          />
                          Admin
                        </label>
                      </div>
                    </div>
                    );
                  })}
                </div>

                <label
                  className="flex items-start gap-2 py-2 px-3 rounded-sm hover:bg-slate-50 cursor-pointer border border-slate-200"
                  data-testid="show-writer-defense-row"
                >
                  <Checkbox
                    data-testid="show-writer-defense"
                    className="mt-0.5"
                    checked={settings.show_writer_defense !== false}
                    onCheckedChange={(ck) => setSettings({ ...settings, show_writer_defense: !!ck })}
                  />
                  <div>
                    <div className="text-sm font-medium">Writer Defense map</div>
                    <div className="text-[10px] text-slate-500">
                      Show ATM± Put/Call OI held vs cracked on the Open Interest page only (below the OI last-pulled strip).
                    </div>
                  </div>
                </label>

                <label
                  className="flex items-start gap-2 py-2 px-3 rounded-sm hover:bg-slate-50 cursor-pointer border border-slate-200"
                  data-testid="show-suggestion-row"
                >
                  <Checkbox
                    data-testid="show-suggestion"
                    className="mt-0.5"
                    checked={settings.show_suggestion !== false}
                    onCheckedChange={(ck) => setSettings({ ...settings, show_suggestion: !!ck })}
                  />
                  <div>
                    <div className="text-sm font-medium">Suggestion window</div>
                    <div className="text-[10px] text-slate-500">
                      Show the OI posture suggestion card pinned under the right panel (with the session date it is based on).
                    </div>
                  </div>
                </label>

                <label
                  className="flex items-start gap-2 py-2 px-3 rounded-sm hover:bg-slate-50 cursor-pointer border border-slate-200"
                  data-testid="show-chart-signals-row"
                >
                  <Checkbox
                    data-testid="show-chart-signals"
                    className="mt-0.5"
                    checked={!!settings.show_chart_signals}
                    onCheckedChange={(ck) => setSettings({ ...settings, show_chart_signals: !!ck })}
                  />
                  <div>
                    <div className="text-sm font-medium">Chart signal chips (gamma / institution)</div>
                    <div className="text-[10px] text-slate-500">
                      Show CE/PE gamma-wall, institution, and velocity chips under the OI Change chart (and matching badges on Strike Table). Off by default — thresholds still live under local OI settings below.
                    </div>
                  </div>
                </label>
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
                {knownIndices.map((idx) => (
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
