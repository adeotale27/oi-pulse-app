import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import OIChart from "@/components/OIChart";
import TimeframePills from "@/components/TimeframePills";
import AlertsPanel from "@/components/AlertsPanel";
import StrikeTable from "@/components/StrikeTable";
import CredentialsModal from "@/components/CredentialsModal";
import SettingsModal from "@/components/SettingsModal";
import ReplayScrubber from "@/components/ReplayScrubber";
import SentimentBar from "@/components/SentimentBar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchOIChange, fetchAlerts, clearAlerts, fetchStatus, api } from "@/lib/api";
import { downloadOICsv } from "@/lib/csv";
import { toast } from "sonner";
import { useNotify } from "@/hooks/useNotify";
import { Play, HelpCircle } from "lucide-react";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const POLL_MS = 15000;

function formatDayLabel(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const [activeIndex, setActiveIndex] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState(15);
  const [current, setCurrent] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [status, setStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [strikesAround, setStrikesAround] = useState(10);
  const [strikeRange, setStrikeRange] = useState({ min: null, max: null });
  const [credsOpen, setCredsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [flash, setFlash] = useState(false);
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [replayFrame, setReplayFrame] = useState(null);
  const [showOI, setShowOI] = useState(true);
  const [replayOpen, setReplayOpen] = useState(false);

  const lastAlertIdRef = useRef(null);
  const { alarm, push, requestPermission } = useNotify();

  // Poll status
  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
    } catch (e) {
      console.error("loadStatus failed", e);
    }
  }, []);

  // Poll OI + previous for the active index
  const loadOI = useCallback(async () => {
    try {
      const params = { minutes: timeframe };
      if (selectedExpiry) params.expiry = selectedExpiry;
      const { data } = await api.get(`/oi/${activeIndex}/change`, { params });
      setCurrent(data.current);
      setPrevious(data.previous);
    } catch (e) {
      console.error("loadOI failed", e);
    }
  }, [activeIndex, timeframe, selectedExpiry]);

  // Load expiries for the active index
  useEffect(() => {
    let cancelled = false;
    api.get(`/expiries/${activeIndex}`).then((r) => {
      if (cancelled) return;
      const list = r.data.expiries || [];
      setExpiries(list);
      // reset selected expiry when switching index
      setSelectedExpiry(list[0] || null);
    }).catch((e) => console.error("loadExpiries failed", e));
    return () => { cancelled = true; };
  }, [activeIndex]);

  const handleChangeExpiry = async (exp) => {
    setSelectedExpiry(exp);
    try {
      await api.post(`/expiries/${activeIndex}`, { expiry: exp });
    } catch (e) {
      console.error("setExpiry failed", e);
    }
  };

  // Poll alerts
  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts();
      const list = data.alerts || [];
      setAlerts(list);
      // detect new alert
      if (list.length && lastAlertIdRef.current !== list[0].created_at) {
        const isFirstLoad = lastAlertIdRef.current === null;
        lastAlertIdRef.current = list[0].created_at;
        if (!isFirstLoad) {
          const a = list[0];
          toast.error(a.message, {
            description: `Price ${a.price?.toFixed?.(2)} · ATM ${a.atm}`,
            duration: 8000,
          });
          alarm();
          push(`OI Reversal · ${a.index}`, a.direction);
          setFlash(true);
          setTimeout(() => setFlash(false), 1800);
        }
      }
    } catch (e) {
      console.error("loadAlerts failed", e);
    }
  }, [alarm, push]);

  useEffect(() => {
    loadStatus();
    loadOI();
    loadAlerts();
    const id1 = setInterval(loadOI, POLL_MS);
    const id2 = setInterval(loadStatus, POLL_MS);
    const id3 = setInterval(loadAlerts, 5000);
    return () => {
      clearInterval(id1); clearInterval(id2); clearInterval(id3);
    };
  }, [loadOI, loadStatus, loadAlerts]);

  // Reset strike range when index changes
  const prevIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (current && current.strikes?.length && prevIndexRef.current !== activeIndex) {
      const min = current.strikes[0].strike;
      const max = current.strikes[current.strikes.length - 1].strike;
      setStrikeRange({ min, max });
      prevIndexRef.current = activeIndex;
    } else if (current && current.strikes?.length && strikeRange.min == null) {
      const min = current.strikes[0].strike;
      const max = current.strikes[current.strikes.length - 1].strike;
      setStrikeRange({ min, max });
    }
  }, [activeIndex, current, strikeRange.min]);

  // Filter strikes based on user selection
  const filteredCurrent = useMemo(() => {
    if (!current) return null;
    let strikes = [...current.strikes].sort((a, b) => a.strike - b.strike);
    const atm = current.atm;
    if (strikesAround !== "all") {
      const atmIdx = strikes.findIndex((s) => s.strike === atm);
      if (atmIdx >= 0) {
        const lo = Math.max(0, atmIdx - strikesAround);
        const hi = Math.min(strikes.length, atmIdx + strikesAround + 1);
        strikes = strikes.slice(lo, hi);
      }
    }
    if (strikeRange.min != null && strikeRange.max != null) {
      strikes = strikes.filter((s) => s.strike >= strikeRange.min && s.strike <= strikeRange.max);
    }
    return { ...current, strikes };
  }, [current, strikesAround, strikeRange]);

  const handleToggleNotif = async () => {
    const perm = await requestPermission();
    setNotifEnabled(perm === "granted");
    if (perm === "granted") toast.success("Desktop notifications enabled");
    else if (perm === "denied") toast.error("Notifications blocked by browser");
  };

  const handleClearAlerts = async () => {
    await clearAlerts();
    setAlerts([]);
    lastAlertIdRef.current = null;
    toast.success("Alerts cleared");
  };

  const handleReset = () => {
    if (current?.strikes?.length) {
      setStrikeRange({
        min: current.strikes[0].strike,
        max: current.strikes[current.strikes.length - 1].strike,
      });
      setStrikesAround(10);
    }
  };

  const changeSummary = useMemo(() => {
    if (!filteredCurrent || !previous) return null;
    const prevMap = new Map();
    (previous.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    let ce = 0, pe = 0;
    for (const s of filteredCurrent.strikes) {
      const p = prevMap.get(s.strike);
      if (!p) continue;
      ce += s.ce_oi - p.ce_oi;
      pe += s.pe_oi - p.pe_oi;
    }
    return { ce, pe, prevAt: previous?.timestamp };
  }, [filteredCurrent, previous]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header
        status={status}
        current={current}
        onOpenCreds={() => setCredsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onDownloadCsv={() => downloadOICsv(current, previous, activeIndex)}
        notifEnabled={notifEnabled}
        onToggleNotif={handleToggleNotif}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          indices={INDICES}
          activeIndex={activeIndex}
          onChangeIndex={setActiveIndex}
          current={current}
          strikesAround={strikesAround}
          onChangeStrikesAround={setStrikesAround}
          strikeRange={strikeRange}
          onChangeStrikeRange={setStrikeRange}
          onReset={handleReset}
          expiries={expiries}
          selectedExpiry={selectedExpiry}
          onChangeExpiry={handleChangeExpiry}
        />

        <main className="flex-1 overflow-auto p-5">
          <Tabs defaultValue="oi-change" className="w-full">
            <div className="flex items-center justify-between mb-4">
              <TabsList className="bg-transparent p-0 h-auto gap-1 border-b border-slate-200 rounded-none w-full justify-start">
                {[
                  { v: "oi-change", l: "OI Change" },
                  { v: "open-interest", l: "Open Interest" },
                  { v: "strike-table", l: "Strike Table" },
                  { v: "alerts", l: "Alerts" },
                ].map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    data-testid={`tab-${t.v}`}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:text-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-slate-500 px-3 py-2 text-sm font-medium"
                  >
                    {t.l}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="grid grid-cols-12 gap-4">
              <div className={`col-span-12 lg:col-span-9 space-y-4 ${flash ? "alert-flash" : ""}`}>
                {changeSummary && (
                  <SentimentBar
                    ceDelta={changeSummary.ce}
                    peDelta={changeSummary.pe}
                    timeframeMin={timeframe}
                  />
                )}
                <div
                  className="bg-white border border-slate-200 rounded-md p-4 transition-colors duration-500"
                  style={
                    changeSummary
                      ? {
                          backgroundColor:
                            changeSummary.pe - changeSummary.ce >= 0
                              ? `rgba(22,163,74,${Math.min(
                                  0.08,
                                  (Math.abs(changeSummary.pe - changeSummary.ce) /
                                    (Math.abs(changeSummary.ce) + Math.abs(changeSummary.pe) || 1)) * 0.12
                                )})`
                              : `rgba(220,38,38,${Math.min(
                                  0.08,
                                  (Math.abs(changeSummary.pe - changeSummary.ce) /
                                    (Math.abs(changeSummary.ce) + Math.abs(changeSummary.pe) || 1)) * 0.12
                                )})`,
                        }
                      : undefined
                  }
                >
                  <TabsContent value="oi-change" className="mt-0">
                    <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="text-base font-semibold text-slate-900">
                          OI Change on {formatDayLabel(current?.timestamp)}
                        </div>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              data-testid="btn-how-to-read"
                              className="text-xs text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1"
                            >
                              <HelpCircle className="w-3 h-3" />
                              How to read this?
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-80 text-xs text-slate-700 space-y-2">
                            <div className="font-semibold text-slate-900 text-sm">How to read this chart</div>
                            <p>
                              Each strike shows two grouped bars — <span className="text-emerald-600 font-semibold">Put OI</span> on the left and <span className="text-rose-600 font-semibold">Call OI</span> on the right.
                            </p>
                            <ul className="space-y-1 pl-3 list-disc">
                              <li><span className="font-semibold">Solid</span> segment = OI at the start of the window</li>
                              <li><span className="font-semibold">Diagonal-striped</span> top = <span className="text-emerald-700">Increase</span> in OI (fresh writers)</li>
                              <li><span className="font-semibold">Outlined</span> top = <span className="text-slate-700">Decrease</span> (writers unwound)</li>
                            </ul>
                            <p className="text-slate-500">
                              Hover a strike to see the exact OI at both timestamps and the change.
                            </p>
                          </PopoverContent>
                        </Popover>
                        <button
                          data-testid="btn-replay-change"
                          onClick={() => setReplayOpen((v) => !v)}
                          className={`text-xs flex items-center gap-1 hover:underline ${
                            replayOpen ? "text-sky-700 font-semibold" : "text-sky-600 hover:text-sky-700"
                          }`}
                        >
                          Replay Change
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-100 text-sky-600">
                            <Play className="w-2.5 h-2.5 fill-current" />
                          </span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          data-testid="switch-show-oi"
                          checked={showOI}
                          onCheckedChange={setShowOI}
                          className="data-[state=checked]:bg-sky-500"
                        />
                        <span className="text-sm text-slate-700">Show OI</span>
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-[10px] px-1.5 py-0 rounded-sm">New</Badge>
                      </div>
                    </div>
                    <OIChart
                      current={filteredCurrent}
                      previous={replayFrame || previous}
                      atm={current?.atm}
                      mode={status?.mode}
                      showOI={showOI}
                      currentTime={current?.timestamp}
                      prevTime={(replayFrame || previous)?.timestamp}
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono-data text-slate-600">
                        <span>{formatClock((replayFrame || previous)?.timestamp) || "—"}</span>
                        <span className="flex-1 mx-3 h-1.5 rounded-full bg-slate-100 relative">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-sky-500" style={{ width: "100%" }} />
                          <span className="absolute -top-1 left-0 w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-white shadow" />
                          <span className="absolute -top-1 right-0 w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-white shadow" />
                        </span>
                        <span>{formatClock(current?.timestamp) || "—"}</span>
                      </div>
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                      {replayOpen && (
                        <ReplayScrubber
                          index={activeIndex}
                          minutes={180}
                          onReplayFrame={setReplayFrame}
                        />
                      )}
                    </div>
                    {(
                      <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-6 items-start text-xs" data-testid="change-summary">
                        <div>
                          <div className="inline-flex items-center px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-medium" data-testid="change-summary-title">
                            Change on {formatDayLabel(current?.timestamp)}
                          </div>
                        </div>
                        <div className="space-y-1.5 font-mono-data">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-24">Call OI change:</span>
                            <span className={changeSummary && changeSummary.ce >= 0 ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"} data-testid="summary-ce-change">
                              {changeSummary
                                ? `${changeSummary.ce >= 0 ? "+" : ""}${(changeSummary.ce / 1e5).toFixed(2)}L`
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-24">Put OI change:</span>
                            <span className={changeSummary && changeSummary.pe >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"} data-testid="summary-pe-change">
                              {changeSummary
                                ? `${changeSummary.pe >= 0 ? "+" : ""}${(changeSummary.pe / 1e5).toFixed(2)}L`
                                : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1.5 font-mono-data">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-40">
                              {activeIndex} at {formatClock((replayFrame || previous)?.timestamp) || "—"}:
                            </span>
                            <span className="text-slate-900" data-testid="summary-price-prev">
                              {(replayFrame || previous)?.price
                                ? (replayFrame || previous).price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 w-40">
                              {activeIndex} at {formatClock(current?.timestamp) || "—"}:
                            </span>
                            <span className="text-slate-900" data-testid="summary-price-now">
                              {current?.price
                                ? current.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="open-interest" className="mt-0">
                    <div className="text-sm font-semibold mb-2">{activeIndex} Absolute Open Interest</div>
                    <OIChart
                      current={filteredCurrent}
                      previous={null}
                      atm={current?.atm}
                      mode={status?.mode}
                    />
                  </TabsContent>

                  <TabsContent value="strike-table" className="mt-0">
                    <div className="text-sm font-semibold mb-2">{activeIndex} Strike-wise OI Table</div>
                    <StrikeTable current={filteredCurrent} previous={previous} atm={current?.atm} />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                    </div>
                  </TabsContent>

                  <TabsContent value="alerts" className="mt-0">
                    <div className="text-sm font-semibold mb-2">All Alerts</div>
                    <AlertsPanel alerts={alerts} onClear={handleClearAlerts} />
                  </TabsContent>
                </div>

                <div className="bg-white border border-slate-200 rounded-md p-3 text-xs text-slate-600 flex items-center justify-between">
                  <div data-testid="footer-refresh">
                    OI last refreshed —{" "}
                    <span className="font-mono-data text-slate-900">
                      {status?.last_updated_at
                        ? new Date(status.last_updated_at).toLocaleTimeString()
                        : "—"}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    Auto-refresh every {status?.poll_interval_seconds ?? 15}s ·{" "}
                    <span className="font-mono-data">
                      {status?.mode === "kite" ? "Live Zerodha feed" : "Demo simulator"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-3">
                <AlertsPanel alerts={alerts} onClear={handleClearAlerts} />
              </div>
            </div>
          </Tabs>
        </main>
      </div>

      <CredentialsModal
        open={credsOpen}
        onOpenChange={setCredsOpen}
        onSaved={loadStatus}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={loadStatus}
      />
    </div>
  );
}
