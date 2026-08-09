import { useEffect, useMemo } from "react";
import { X, GripVertical, ChevronDown } from "lucide-react";
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
  // straddle poll interval (ms) supplied by parent/dashboard
  straddlePollMs = 60000,
  uploadRefreshKey = 0,
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
    <div className="oi-panel h-full min-h-0 flex flex-col overflow-hidden" data-testid="right-panel">
      <div className="flex items-center gap-2 border-b border-slate-200/80 dark:border-slate-700/80 px-3 py-2 bg-emerald-50/40 dark:bg-emerald-950/20 shrink-0 relative z-20">
        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="relative flex-1 min-w-0">
          <select
            value={selectedView}
            onChange={(e) => onChangeView(e.target.value)}
            data-testid="right-panel-select"
            className="w-full appearance-none text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-sm pl-2 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
          >
            {allowedViews.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-slate-500 hover:text-slate-900 shrink-0"
          onClick={onClose}
          data-testid="right-panel-close"
          title="Close side panel"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Content scrolls inside the panel; suggestion stays pinned under the fold edge. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2"
          data-testid="right-panel-scroll"
        >
          {selectedView === "alerts" && (
            <AlertsPanel
              alerts={alerts}
              onClear={onClearAlerts}
              activeIndex={activeIndex}
              canClear={canClearAlerts}
              embed
            />
          )}
          {selectedView === "strike" && (
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
          {selectedView === "buildup" && (
            <BuildupTable
              current={filteredCurrent}
              previous={previous}
              atm={atm}
              timeframeLabel={timeframeLabel}
            />
          )}
          {selectedView === "activity" && (
            <ActivityFeed
              events={(activity || []).filter((e) => e.index === activeIndex)}
              activeIndex={activeIndex}
              onClear={clearActivity}
              filter={activityFilter}
              onSetFilter={setActivityFilter}
            />
          )}
          {selectedView === "positions" && (
            <PositionsPanel
              isKiteMode={isKiteMode}
              current={current}
              vix={vixNow}
              oiSettings={oiSettings}
              activeIndex={activeIndex}
              expiry={selectedExpiry}
            />
          )}
          {selectedView === "oichart" && (
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
          {selectedView === "straddle" && (
            <div className="p-3">
              <StraddleChart index={activeIndex} expiry={selectedExpiry} position={"long"} qty={1} pollMs={straddlePollMs} />
            </div>
          )}
          {selectedView === "index-events" && (
            <EventRiskWidget
              activeIndex={activeIndex}
              refreshKey={uploadRefreshKey}
              isAdmin={isAdmin}
            />
          )}
        </div>

        {suggestion && (
          <div
            className="shrink-0 border-t border-slate-200 dark:border-slate-700 p-2 bg-white dark:bg-slate-900"
            data-testid="right-panel-suggestion"
          >
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
              {suggestion}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
