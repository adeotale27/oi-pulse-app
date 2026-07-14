import { useEffect, useState } from "react";
import { Activity, KeyRound, Bell, BellOff, Settings2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import HolidayBadge from "@/components/HolidayBadge";
import MarketEventsBadge from "@/components/MarketEventsBadge";
import TickerStrip from "@/components/TickerStrip";

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
  vixSessionOpen,
  activeIndex,
  onSelectIndex,
  tickerData,
}) {
  const price = current?.price ?? 0;
  const atm = current?.atm ?? 0;
  const pcr = current?.pcr ?? 0;
  const vix = current?.vix ?? 0;
  const mode = status?.mode ?? "mock";

  // Continuous 1-second clock (independent of the 30s poll).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowLabel = now.toLocaleTimeString();

  // Pull today's change for the active index from the ticker payload — this is
  // "yesterday-close vs live LTP", i.e. today's real % change.
  const myTicker = (tickerData || []).find((t) => t.index === current?.index);

  return (
    <header
      data-testid="dashboard-header"
      className="w-full bg-white border-b border-slate-200 relative"
    >
      {/* --- Top row: brand, secondary metrics, action buttons --- */}
      <div className="px-6 pt-2 pb-1 flex items-center justify-between gap-4 flex-wrap">
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

          <div className="hidden md:flex items-center gap-5 pl-4 border-l border-slate-200">
            <Metric label="ATM" value={atm.toLocaleString()} />
            <Metric label="PCR" value={pcr.toFixed(2)} tone={pcr > 1 ? "green" : "red"} />
            <VixMetric value={vix} sessionOpen={vixSessionOpen} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 font-mono-data" data-testid="last-updated">
            <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 live-dot" : "bg-slate-300"}`} />
            <span data-testid="live-clock">{nowLabel}</span>
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
      </div>

      {/* --- Bottom row: index ticker strip + calendar badges --- */}
      <div className="px-6 pb-2 pt-1 flex items-stretch gap-2 flex-wrap justify-between">
        <TickerStrip activeIndex={activeIndex} onSelectIndex={onSelectIndex} />
        <div className="flex items-stretch gap-2">
          <div className="w-56">
            <HolidayBadge onClick={onOpenHolidays} />
          </div>
          <div className="w-64">
            <MarketEventsBadge onClick={onOpenEvents} />
          </div>
        </div>
      </div>
    </header>
  );
}

function VixMetric({ value, sessionOpen }) {
  const v = value ?? 0;
  let arrow = null, tone = "amber", chgLabel = "";
  if (sessionOpen && sessionOpen > 0 && v > 0) {
    const chg = v - sessionOpen;
    const pct = (chg / sessionOpen) * 100;
    if (pct > 0.05) { arrow = "▲"; tone = "rose"; }
    else if (pct < -0.05) { arrow = "▼"; tone = "emerald"; }
    else { arrow = "▬"; tone = "slate"; }
    chgLabel = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  }
  const toneCls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : tone === "slate" ? "text-slate-500" : "text-amber-600";
  return (
    <div className="flex flex-col" data-testid="vix-metric">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">INDIA VIX</div>
      <div className="flex items-baseline gap-1.5">
        <div className={`text-sm font-semibold font-mono-data ${toneCls}`} data-testid="vix-value">{v.toFixed(2)}</div>
        {arrow && (
          <div className={`text-[10px] font-mono-data ${toneCls}`} data-testid="vix-change">
            <span className="mr-0.5">{arrow}</span>{chgLabel}
          </div>
        )}
      </div>
    </div>
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
