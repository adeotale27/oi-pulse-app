import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { formatTime } from "@/components/AlertsPanel";
import { AlertTriangle, Zap, TrendingUp, TrendingDown, Target, Circle, Info, RefreshCw, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const SIGNAL_COLORS = {
  iceberg: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", icon: "🧊", label: "Iceberg" },
  sweep: { bg: "bg-red-50", border: "border-red-200", text: "text-red-900", icon: "🌊", label: "Sweep" },
  block_trade: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-900", icon: "🔴", label: "Block" },
  delta_neutral: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-900", icon: "⚖️", label: "Delta-Neutral" },
  aggressive_build: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-900", icon: "🎯", label: "Aggressive" },
  trapped_writers: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-900", icon: "⚠️", label: "Trapped" },
};

const SEVERITY_COLORS = {
  info: { bg: "bg-slate-100", text: "text-slate-700" },
  warning: { bg: "bg-amber-100", text: "text-amber-800" },
  critical: { bg: "bg-red-100", text: "text-red-800" },
};

const SIDE_COLORS = {
  CE: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  PE: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  BOTH: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
};

function formatNotional(cr) {
  if (cr >= 100) return `₹${cr.toFixed(0)}Cr`;
  if (cr >= 10) return `₹${cr.toFixed(1)}Cr`;
  return `₹${cr.toFixed(2)}Cr`;
}

function formatOI(oi) {
  const abs = Math.abs(oi);
  const sign = oi > 0 ? "+" : oi < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${abs/1e7:.1f}Cr`;
  if (abs >= 1e5) return `${sign}${abs/1e5:.1f}L`;
  if (abs >= 1e3) return `${sign}${abs/1e3:.1f}K`;
  return `${sign}${abs}`;
}

export default function OrderFlowPanel({ activeIndex, isAdmin = false }) {
  const [signals, setSignals] = useState([]);
  const [summary, setSummary] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    signalType: "all",
    severity: "all",
    side: "all",
    windowMinutes: 60,
    minNotional: 0,
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    if (!activeIndex) return;
    try {
      setLoading(true);
      setError(null);
      
      // Build query params
      const params = new URLSearchParams({
        limit: "200",
        minutes: String(filters.windowMinutes),
      });
      if (filters.signalType !== "all") params.append("signal_type", filters.signalType);
      if (filters.severity !== "all") params.append("severity", filters.severity);
      if (filters.side !== "all") params.append("side", filters.side);
      
      const [signalsRes, summaryRes, heatmapRes] = await Promise.all([
        api.get(`/flow/${activeIndex}?${params.toString()}`),
        api.get(`/flow/${activeIndex}/summary?minutes=${filters.windowMinutes}`),
        api.get(`/flow/${activeIndex}/heatmap?minutes=${filters.windowMinutes}`),
      ]);
      
      setSignals(signalsRes.data.signals || []);
      setSummary(summaryRes.data);
      setHeatmap(heatmapRes.data.heatmap || []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load flow signals");
      console.error("[OrderFlowPanel] fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [activeIndex, filters]);

  // Auto-refresh every 30 seconds when market is open
  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh]);

  // Filter signals by minNotional client-side
  const filteredSignals = useMemo(() => {
    return signals.filter(s => (s.notional_cr || 0) >= filters.minNotional);
  }, [signals, filters.minNotional]);

  // Group signals by type for summary cards
  const signalsByType = useMemo(() => {
    const groups = {};
    for (const s of filteredSignals) {
      const type = s.signal_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(s);
    }
    return groups;
  }, [filteredSignals]);

  if (!activeIndex) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        Select an index to view order flow signals
      </div>
    );
  }

  const signalTypes = useMemo(() => {
    const types = new Set(filteredSignals.map(s => s.signal_type));
    return Array.from(types).sort();
  }, [filteredSignals]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-600" />
            <span className="text-sm font-semibold">Order Flow — {activeIndex}</span>
            <Badge variant="secondary" className="text-[10px]">
              {filteredSignals.length} signals
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={fetchData}
                    disabled={loading}
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh now</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? (
                <>
                  <Circle className="w-4 h-4 text-emerald-600" />
                  <span className="ml-1 text-[11px]">Auto</span>
                </>
              ) : (
                <>
                  <Circle className="w-4 h-4 text-slate-400" />
                  <span className="ml-1 text-[11px]">Paused</span>
                </>
              )}
            </Button>
            {lastRefresh && (
              <span className="text-[10px] text-slate-500 font-mono">
                {formatTime(lastRefresh.toISOString())}
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Window</Label>
            <Select value={String(filters.windowMinutes)} onValueChange={v => setFilters(f => ({...f, windowMinutes: parseInt(v)}))}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue placeholder="60m" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
                <SelectItem value="480">8 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Type</Label>
            <Select value={filters.signalType} onValueChange={v => setFilters(f => ({...f, signalType: v}))}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {signalTypes.map(t => {
                  const c = SIGNAL_COLORS[t] || { icon: "●", label: t };
                  return (
                    <SelectItem key={t} value={t}>
                      <span className="flex items-center gap-2">
                        <span>{c.icon}</span>
                        <span>{c.label}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Severity</Label>
            <Select value={filters.severity} onValueChange={v => setFilters(f => ({...f, severity: v}))}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Side</Label>
            <Select value={filters.side} onValueChange={v => setFilters(f => ({...f, side: v}))}>
              <SelectTrigger className="w-[90px] h-8 text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="CE">CE</SelectItem>
                <SelectItem value="PE">PE</SelectItem>
                <SelectItem value="BOTH">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Min ₹Cr</Label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={filters.minNotional}
              onChange={e => setFilters(f => ({...f, minNotional: parseFloat(e.target.value) || 0}))}
              className="w-[70px] h-8 text-xs font-mono px-2 border border-slate-300 rounded dark:border-slate-600 dark:bg-slate-800"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-3 border-b border-rose-200 bg-rose-50 text-rose-700 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={fetchData}>Retry</Button>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SummaryCard
              title="Total Signals"
              value={filteredSignals.length}
              icon={Zap}
              color="text-amber-600"
            />
            <SummaryCard
              title="Total Notional"
              value={formatNotional(summary.by_type_severity?.reduce((a, b) => a + (b.total_notional_cr || 0), 0) || 0)}
              icon={Target}
              color="text-emerald-600"
            />
            <SummaryCard
              title="Critical Alerts"
              value={summary.by_type_severity?.filter(b => b._id?.severity === "critical").reduce((a, b) => a + (b.count || 0), 0) || 0}
              icon={AlertTriangle}
              color="text-rose-600"
            />
            <SummaryCard
              title="Signal Types"
              value={Object.keys(signalsByType).length}
              icon={Info}
              color="text-sky-600"
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Tabs defaultValue="signals" className="h-full">
          <TabsList className="border-b border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-900">
            <TabsTrigger value="signals" className="text-xs px-3 py-1.5">
              Signals ({filteredSignals.length})
            </TabsTrigger>
            <TabsTrigger value="heatmap" className="text-xs px-3 py-1.5">
              Heatmap ({heatmap.length})
            </TabsTrigger>
            <TabsTrigger value="summary" className="text-xs px-3 py-1.5">
              Summary
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signals" className="h-full p-0">
            {loading && !signals.length ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                Loading signals...
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                No signals in this window. Try expanding the time window or reducing filters.
              </div>
            ) : (
              <ScrollArea className="h-full p-2">
                <div className="space-y-2">
                  {Object.entries(signalsByType)
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([type, typeSignals]) => {
                      const config = SIGNAL_COLORS[type] || { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-900", icon: "●", label: type };
                      return (
                        <SignalGroup
                          key={type}
                          type={type}
                          config={config}
                          signals={typeSignals}
                        />
                      );
                    })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="heatmap" className="h-full p-2">
            {heatmap.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                No heatmap data. Signals will appear here as they're detected.
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="space-y-1">
                  {heatmap.map((h, i) => (
                    <HeatmapRow key={`${h.strike}_${h.side}`} data={h} index={i} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="summary" className="h-full p-2">
            {summary && (
              <ScrollArea className="h-full">
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    By Type & Severity
                  </div>
                  <div className="space-y-1">
                    {summary.by_type_severity?.map((item, i) => (
                      <SummaryRow key={i} item={item} />
                    ))}
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Top Signals by Notional
                    </div>
                    <div className="space-y-1">
                      {summary.top_signals?.map((s, i) => (
                        <TopSignalRow key={i} signal={s} />
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, color }) {
  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{title}</span>
      </div>
      <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}

function SignalGroup({ type, config, signals }) {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <div className={`${config.bg} ${config.border} border rounded-lg overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        <span className="text-base">{config.icon}</span>
        <span className={`font-medium ${config.text}`}>{config.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {signals.length}
        </Badge>
        <ChevronDown className={`ml-auto w-3 h-3 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="p-3 space-y-2 border-t">
          {signals
            .sort((a, b) => new Date(b.ts) - new Date(a.ts))
            .map((s, i) => (
              <SignalCard key={`${s.ts}_${i}`} signal={s} />
            ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal }) {
  const config = SIGNAL_COLORS[signal.signal_type] || { text: "text-slate-900", icon: "●" };
  const sevConfig = SEVERITY_COLORS[signal.severity] || { bg: "bg-slate-100", text: "text-slate-700" };
  const sideConfig = SIDE_COLORS[signal.side] || { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };
  
  return (
    <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-100 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sevConfig.bg} ${sevConfig.text}`}>
              {signal.severity.toUpperCase()}
            </span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sideConfig.bg} ${sideConfig.text} ${sideConfig.border}`}>
              {signal.side}
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {signal.strike?.toLocaleString("en-IN")}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {formatTime(signal.ts)}
            </span>
          </div>
          <div className="mt-1 text-sm {config.text}">{signal.message}</div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
            <span>₹{signal.notional_cr?.toFixed(2) || 0}Cr</span>
            <span>{formatOI(signal.oi_change)} OI</span>
            {signal.volume && <span>{signal.volume.toLocaleString()} vol</span>}
            {signal.oi_to_volume_ratio && <span>vol/OI: {signal.oi_to_volume_ratio.toFixed(2)}</span>}
            <span>conf: {(signal.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
        
        {/* Details tooltip */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded">
                <Info className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" align="start" className="max-w-xs p-2">
              <div className="text-[10px] space-y-1">
                {Object.entries(signal.details || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-500 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {typeof v === "number" ? v.toFixed(v % 1 === 0 ? 0 : 2) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function HeatmapRow({ data, index }) {
  const sevConfig = SEVERITY_COLORS[data.max_severity] || { bg: "bg-slate-100", text: "text-slate-700" };
  const sideConfig = SIDE_COLORS[data.side] || { bg: "bg-slate-50", text: "text-slate-700" };
  
  const intensity = Math.min(1, data.total_notional / 50); // Normalize to 50Cr max
  const bgOpacity = 0.1 + intensity * 0.6;
  
  return (
    <div 
      className="flex items-center gap-2 px-2 py-1.5 rounded dark:hover:bg-slate-800 hover:bg-slate-50 cursor-default"
      style={{ backgroundColor: data.side === "CE" ? `rgba(239, 68, 68, ${bgOpacity})` : data.side === "PE" ? `rgba(16, 185, 129, ${bgOpacity})` : `rgba(168, 85, 247, ${bgOpacity})` }}
    >
      <div className="w-24 text-right font-mono text-[11px] text-slate-600">
        {data.strike.toLocaleString("en-IN")}
      </div>
      <div className={`w-16 px-1.5 py-0.5 text-center text-[10px] font-medium rounded ${sideConfig.bg} ${sideConfig.text} ${sideConfig.border}`}>
        {data.side}
      </div>
      <div className="flex-1 flex items-center gap-2 text-[10px]">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${sevConfig.bg} ${sevConfig.text}`}>
          {data.max_severity.toUpperCase()}
        </span>
        <span className="font-mono text-slate-700 dark:text-slate-300">
          ₹{data.total_notional.toFixed(1)}Cr
        </span>
        <span className="text-slate-500">{data.signal_count} signals</span>
      </div>
      <div className="w-20 text-right font-mono text-[10px] text-slate-500">
        {data.signals.map(s => s.type).join(", ")}
      </div>
    </div>
  );
}

function SummaryRow({ item }) {
  const sevConfig = SEVERITY_COLORS[item._id?.severity] || { bg: "bg-slate-100", text: "text-slate-700" };
  const config = SIGNAL_COLORS[item._id?.signal_type] || { icon: "●", label: item._id?.signal_type };
  
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-900 rounded border border-slate-100 dark:border-slate-800">
      <span className="w-6 text-center">{config.icon}</span>
      <span className="w-28 text-sm font-medium text-slate-700 dark:text-slate-300">{config.label}</span>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sevConfig.bg} ${sevConfig.text} w-20`}>
        {item._id?.severity?.toUpperCase()}
      </span>
      <span className="flex-1 text-right font-mono text-sm text-slate-600 dark:text-slate-400">
        {item.count} signals
      </span>
      <span className="w-28 text-right font-mono text-sm font-semibold text-emerald-600">
        ₹{(item.total_notional_cr || 0).toFixed(1)}Cr
      </span>
      <span className="w-20 text-right font-mono text-[10px] text-slate-500">
        {(item.max_confidence * 100).toFixed(0)}% conf
      </span>
    </div>
  );
}

function TopSignalRow({ signal }) {
  const config = SIGNAL_COLORS[signal.signal_type] || { icon: "●", text: "text-slate-900" };
  const sevConfig = SEVERITY_COLORS[signal.severity] || { bg: "bg-slate-100", text: "text-slate-700" };
  
  return (
    <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{config.icon}</span>
          <div>
            <div className="flex items-center gap-1.5 text-sm">
              <span className={`${config.text} font-medium`}>{signal.index} {signal.strike?.toLocaleString()} {signal.side}</span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sevConfig.bg} ${sevConfig.text}`}>
                {signal.severity.toUpperCase()}
              </span>
            </div>
            <div className="text-[10px] text-slate-500">{signal.message}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-right text-[10px]">
          <span className="font-mono text-emerald-600">₹{signal.notional_cr?.toFixed(1)}Cr</span>
          <span className="font-mono text-slate-500">{formatOI(signal.oi_change)} OI</span>
          <span className="font-mono text-slate-500">{(signal.confidence * 100).toFixed(0)}%</span>
          <span className="text-slate-400 font-mono">{formatTime(signal.ts)}</span>
        </div>
      </div>
    </div>
  );
}