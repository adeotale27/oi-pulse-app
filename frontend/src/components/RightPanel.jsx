import { useEffect, useMemo } from "react";
import { X, GripVertical, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlertsPanel from "@/components/AlertsPanel";
import StrikeTable from "@/components/StrikeTable";
import BuildupTable from "@/components/BuildupTable";
import ActivityFeed from "@/components/ActivityFeed";
import PositionsPanel from "@/components/PositionsPanel";
import DeskAiBar from "@/components/DeskAiBar";
import OIChart from "@/components/OIChart";
import EventRiskWidget from "@/components/EventRiskWidget";
import StraddleChart from "@/components/StraddleChart";

// Content picker options for the right (side-by-side) panel.
// pageId maps to the same dashboard-visible_page keys used by settings.
export const RIGHT_PANEL_VIEWS = [
  { key: "desk-ai", label: "Desk AI", pageId: null, requiresDeskAi: true },
  { key: "alerts",   label: "Alerts", pageId: "alerts" },
  { key: "strike",   label: "Strike Table", pageId: "strike-table" },
  { key: "buildup",  label: "Build-up", pageId: "buildup" },
  { key: "activity", label: "Activity Feed", pageId: "activity" },
  { key: "positions", label: "Positions", pageId: "positions" },
  { key: "oichart", label: "OI Chart (mini)", pageId: null },
  { key: "oi-change", label: "OI Change", pageId: "oi-change" },
  { key: "straddle", label: "Straddle", pageId: "straddle" },
  { key: "index-events", label: "Index Risk", pageId: "index-events" },
];

export default function RightPanel({
  view,
  onChangeView,
  onClose,
  visiblePages = [],
  adminPages = null,
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
  vixOpen = null,
  vrp = null,
  indexStep = 50,
  expiriesMeta = [],
  onPinNearestWeekly,
  positionsPollMs = 30000,
  onOpenKite,
  deskAiShow = false,
  deskAiAsk = true,
  deskAiPositions = false,
  deskAiRadar = true,
  canConfigureDeskAi = false,
  onDeskAiPositions,
  onDeskAiRadar,
  onOpenTelegramPrefs,
}) {
  const allowedViews = useMemo(
    () => RIGHT_PANEL_VIEWS.filter((item) => {
      if (item.requiresDeskAi && !deskAiShow) return false;
      if (item.pageId == null) return true;
      if (isAdmin) {
        if (!Array.isArray(adminPages) || adminPages.length === 0) return true;
        return adminPages.includes(item.pageId);
      }
      return Array.isArray(visiblePages) && visiblePages.includes(item.pageId);
    }),
    [visiblePages, adminPages, isAdmin, deskAiShow]
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
          className={`flex-1 min-h-0 overscroll-contain p-2 ${
            selectedView === "desk-ai" ? "overflow-hidden flex flex-col" : "overflow-y-auto"
          }`}
          data-testid="right-panel-scroll"
        >
          {selectedView === "desk-ai" && (
            <div className="flex-1 min-h-0">
              <DeskAiBar
                activeIndex={activeIndex}
                visible={deskAiShow}
                askAi={deskAiAsk}
                variant="panel"
              />
            </div>
          )}
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
              hasKiteCredentials={status?.has_kite_credentials != null
                ? !!status.has_kite_credentials
                : null}
              current={filteredCurrent || current}
              previous={previous}
              vix={vixNow}
              vixOpen={vixOpen}
              oiSettings={oiSettings}
              activeIndex={activeIndex}
              expiry={selectedExpiry}
              step={indexStep}
              vrp={vrp}
              expiriesMeta={expiriesMeta}
              onPinNearestWeekly={onPinNearestWeekly}
              positionsPollMs={positionsPollMs}
              onOpenKite={onOpenKite}
              deskAiShow={deskAiShow}
              deskAiAsk={deskAiAsk}
              deskAiPositions={deskAiPositions}
              deskAiRadar={deskAiRadar}
              canConfigureDeskAi={canConfigureDeskAi}
              onDeskAiPositions={onDeskAiPositions}
              onDeskAiRadar={onDeskAiRadar}
              onOpenTelegramPrefs={onOpenTelegramPrefs}
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
          {selectedView === "oi-change" && (
            <OIChart
              current={filteredCurrent}
              previous={previous}
              atm={atm}
              mode={status?.mode}
              showOI={false}
              currentTime={current?.timestamp}
              prevTime={previous?.timestamp}
            />
          )}
          {selectedView === "straddle" && (
            <div className="p-3">
              <StraddleChart
                key={`rp-${activeIndex}-${selectedExpiry || "auto"}`}
                index={activeIndex}
                expiry={selectedExpiry}
                position={"long"}
                qty={1}
                pollMs={straddlePollMs}
              />
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
