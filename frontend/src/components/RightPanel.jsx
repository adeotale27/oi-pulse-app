import { useEffect, useMemo } from "react";
import { X, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlertsPanel from "@/components/AlertsPanel";
import StrikeTable from "@/components/StrikeTable";
import BuildupTable from "@/components/BuildupTable";
import ActivityFeed from "@/components/ActivityFeed";
import PositionsPanel from "@/components/PositionsPanel";
import OIChart from "@/components/OIChart";
import EventRiskWidget from "@/components/EventRiskWidget";
import StraddleChart from "@/components/StraddleChart";

// Content picker options for the right (side-by-side) panel.
// pageId maps to the same dashboard-visible_page keys used by settings.
export const RIGHT_PANEL_VIEWS = [
  { key: "alerts",   label: "Alerts", pageId: "alerts" },
  { key: "strike",   label: "Strike Table", pageId: "strike-table" },
  { key: "buildup",  label: "Build-up", pageId: "buildup" },
  { key: "activity", label: "Activity Feed", pageId: "activity" },
  { key: "positions", label: "Positions", pageId: "positions" },
  { key: "oichart", label: "OI Chart (mini)", pageId: null },
  { key: "straddle", label: "Straddle", pageId: "straddle" },
  { key: "index-events", label: "Index Risk", pageId: "index-events" },
];

export default function RightPanel({
  view,
  onChangeView,
  onClose,
  visiblePages = [],
  isAdmin = false,
  // props for panel contents
  alerts,
  onClearAlerts,
  canClearAlerts = true,
  activeIndex,
  filteredCurrent,
  current,
  previous,
  atm,
  timeframeMin,
  timeframeLabel,
  oiSettings,
  lotSize,
  selectedExpiry,
  vixNow,
  activity,
  activityFilter,
  setActivityFilter,
  clearActivity,
  isKiteMode,
  status,
  showOI,
  suggestion,
}) {
  const allowedViews = useMemo(
    () => RIGHT_PANEL_VIEWS.filter((item) => {
      if (item.pageId == null) return true;
      return isAdmin || visiblePages.includes(item.pageId);
    }),
    [visiblePages, isAdmin]
  );

  const selectedView = allowedViews.some((item) => item.key === view)
    ? view
    : allowedViews[0]?.key || view;

  useEffect(() => {
    if (allowedViews.length === 0) return;
    if (!allowedViews.some((item) => item.key === view)) {
      onChangeView(allowedViews[0].key);
    }
  }, [allowedViews, view, onChangeView]);

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="right-panel">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 bg-slate-50">
        <GripVertical className="w-3.5 h-3.5 text-slate-400" />
        <select
          value={selectedView}
          onChange={(e) => onChangeView(e.target.value)}
          data-testid="right-panel-select"
          className="text-xs font-semibold bg-transparent focus:outline-none flex-1 truncate cursor-pointer"
        >
          {allowedViews.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-slate-500 hover:text-slate-900"
          onClick={onClose}
          data-testid="right-panel-close"
          title="Close side panel"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {view === "alerts" && (
          <AlertsPanel alerts={alerts} onClear={onClearAlerts} activeIndex={activeIndex} canClear={canClearAlerts} />
        )}
        {view === "strike" && (
          <StrikeTable
            current={filteredCurrent}
            previous={previous}
            atm={atm}
            timeframeMin={timeframeMin}
            oiSettings={oiSettings}
            lotSize={lotSize}
            expiry={selectedExpiry}
            vixNow={vixNow}
          />
        )}
        {view === "buildup" && (
          <BuildupTable
            current={filteredCurrent}
            previous={previous}
            atm={atm}
            timeframeLabel={timeframeLabel}
          />
        )}
        {view === "activity" && (
          <ActivityFeed
            events={(activity || []).filter((e) => e.index === activeIndex)}
            activeIndex={activeIndex}
            onClear={clearActivity}
            filter={activityFilter}
            onSetFilter={setActivityFilter}
          />
        )}
        {view === "positions" && (
          <PositionsPanel
            isKiteMode={isKiteMode}
            current={current}
            vix={vixNow}
            oiSettings={oiSettings}
            activeIndex={activeIndex}
            expiry={selectedExpiry}
          />
        )}
        {view === "oichart" && (
          <OIChart
            current={filteredCurrent}
            previous={previous}
            atm={atm}
            mode={status?.mode}
            showOI={showOI}
            currentTime={current?.timestamp}
            prevTime={previous?.timestamp}
          />
        )}
        {view === "straddle" && (
          <div className="p-3">
            <StraddleChart index={activeIndex} expiry={selectedExpiry} position={"long"} qty={1} pollMs={30000} />
          </div>
        )}
        {view === "index-events" && (
          <EventRiskWidget activeIndex={activeIndex} />
        )}
      </div>
      {/* Persistent suggestion block — stays regardless of the selected view.
          Only disappears when the whole right panel is closed. */}
      {suggestion && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950" data-testid="right-panel-suggestion">
          {suggestion}
        </div>
      )}
    </div>
  );
}