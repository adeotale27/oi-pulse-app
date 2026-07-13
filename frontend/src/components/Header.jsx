import { Activity, KeyRound, Bell, BellOff, Settings2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import HolidayBadge from "@/components/HolidayBadge";
import MarketEventsBadge from "@/components/MarketEventsBadge";

export default function Header({
  status,
  current,
  onOpenCreds,
  onOpenSettings,
  onDownloadCsv,
  notifEnabled,
  onToggleNotif,
  onOpenHolidays,
  onOpenEvents,
}) {
  const price = current?.price ?? 0;
  const atm = current?.atm ?? 0;
  const pcr = current?.pcr ?? 0;
  const vix = current?.vix ?? 0;
  const mode = status?.mode ?? "mock";
  const lastUpdated = status?.last_updated_at
    ? new Date(status.last_updated_at).toLocaleTimeString()
    : "—";

  return (
    <header
      data-testid="dashboard-header"
      className="w-full bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between relative"
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-900 rounded-sm flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">OI Pulse</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">
              NSE Open Interest Tracker
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6 pl-6 border-l border-slate-200">
          <Metric label={current?.index || "—"} value={price.toLocaleString(undefined, { maximumFractionDigits: 2 })} accent />
          <Metric label="ATM" value={atm.toLocaleString()} />
          <Metric label="PCR" value={pcr.toFixed(2)} tone={pcr > 1 ? "green" : "red"} />
          <Metric label="INDIA VIX" value={vix.toFixed(2)} tone="amber" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono-data" data-testid="last-updated">
          <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 live-dot" : "bg-slate-300"}`} />
          <span>{lastUpdated}</span>
        </div>
        <Badge
          data-testid="mode-badge"
          className={`rounded-sm ${mode === "kite" ? "bg-emerald-600 hover:bg-emerald-600" : "bg-amber-500 hover:bg-amber-500"}`}
        >
          {mode === "kite" ? "LIVE · Kite" : "DEMO"}
        </Badge>
        <Button
          data-testid="btn-toggle-notifications"
          variant="outline"
          size="sm"
          className="rounded-sm"
          onClick={onToggleNotif}
          title={notifEnabled ? "Notifications on" : "Enable notifications"}
        >
          {notifEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </Button>
        <Button
          data-testid="btn-download-csv"
          variant="outline"
          size="sm"
          className="rounded-sm"
          onClick={onDownloadCsv}
          title="Download current OI as CSV"
        >
          <Download className="w-4 h-4" />
        </Button>
        <Button
          data-testid="btn-open-settings"
          variant="outline"
          size="sm"
          className="rounded-sm"
          onClick={onOpenSettings}
          title="Alert settings"
        >
          <Settings2 className="w-4 h-4" />
        </Button>
        <Button
          data-testid="btn-open-credentials"
          variant="outline"
          size="sm"
          className="rounded-sm"
          onClick={onOpenCreds}
        >
          <KeyRound className="w-4 h-4 mr-1.5" />
          Kite API
        </Button>
      </div>
    <div className="hidden md:flex absolute right-6 top-full mt-1 z-30 gap-2 items-stretch">
      <div className="w-60">
        <HolidayBadge onClick={onOpenHolidays} />
      </div>
      <div className="w-72">
        <MarketEventsBadge onClick={onOpenEvents} />
      </div>
    </div>
    </header>
  );
}

function Metric({ label, value, tone, accent }) {
  const toneCls = {
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
  }[tone] || (accent ? "text-slate-900" : "text-slate-800");
  return (
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-sm font-semibold font-mono-data ${toneCls}`}>{value}</div>
    </div>
  );
}
