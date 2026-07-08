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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchOIChange, fetchAlerts, clearAlerts, fetchStatus, api } from "@/lib/api";
import { downloadOICsv } from "@/lib/csv";
import { toast } from "sonner";
import { useNotify } from "@/hooks/useNotify";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const POLL_MS = 15000;

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

  const lastAlertIdRef = useRef(null);
  const { alarm, push, requestPermission } = useNotify();

  // Poll status
  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
    } catch (_e) {
      /* network hiccup - ignore */
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
      /* silent */
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
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeIndex]);

  const handleChangeExpiry = async (exp) => {
    setSelectedExpiry(exp);
    try {
      await api.post(`/expiries/${activeIndex}`, { expiry: exp });
    } catch {}
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
    } catch (_e) {
      /* silent */
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
                <div className="bg-white border border-slate-200 rounded-md p-4">
                  <TabsContent value="oi-change" className="mt-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm font-semibold">
                          {activeIndex} OI Change · last {timeframe} min
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Solid bars = current OI · Outlined bars = OI {timeframe} min ago
                        </div>
                      </div>
                    </div>
                    <OIChart
                      current={filteredCurrent}
                      previous={replayFrame || previous}
                      atm={current?.atm}
                      mode={status?.mode}
                    />
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <TimeframePills value={timeframe} onChange={setTimeframe} />
                      <ReplayScrubber
                        index={activeIndex}
                        minutes={180}
                        onReplayFrame={setReplayFrame}
                      />
                    </div>
                    {changeSummary && (
                      <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs font-mono-data">
                        <div>
                          <span className="text-slate-500">Call OI change: </span>
                          <span className={changeSummary.ce >= 0 ? "text-rose-600" : "text-emerald-600"}>
                            {changeSummary.ce >= 0 ? "+" : ""}
                            {(changeSummary.ce / 1e5).toFixed(2)}L
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Put OI change: </span>
                          <span className={changeSummary.pe >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {changeSummary.pe >= 0 ? "+" : ""}
                            {(changeSummary.pe / 1e5).toFixed(2)}L
                          </span>
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
