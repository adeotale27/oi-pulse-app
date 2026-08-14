import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImagePlus,
  Save,
  Trash2,
  Trophy,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fetchJournalMonth,
  fetchJournalYear,
  fetchJournalDay,
  saveJournalDay,
  addJournalScreenshot,
  deleteJournalScreenshot,
} from "@/lib/api";
import { toast } from "sonner";
import { isHoliday, isJournalSessionDayIST, isSpecialSessionIST } from "@/lib/holidays";
import { overlayMonthOnYearHeat } from "@/lib/journalYearHeat";
import { journalSavePayload, resolveJournalSaveDoc } from "@/lib/journalSave";
import InfoTip from "@/components/InfoTip";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtInr(v, dp = 0) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
  return `${n < 0 ? "−" : ""}₹${body}`;
}

function compactPnl(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

function cellPnl(doc) {
  if (!doc) return 0;
  if (doc.booked_pnl != null) return Number(doc.booked_pnl) || 0;
  if (doc.pnl_exited != null) return Number(doc.pnl_exited) || 0;
  if (doc.display_pnl != null) return Number(doc.display_pnl) || 0;
  return 0;
}

function isTraded(doc) {
  if (!doc) return false;
  if ((doc.exited_count || 0) > 0) return true;
  if ((doc.partial_count || 0) > 0) return true;
  if (Math.abs(Number(doc.booked_pnl) || 0) > 0.009) return true;
  if (Math.abs(Number(doc.pnl_exited) || 0) > 0.009) return true;
  if ((doc.legs || []).some((l) => l && (l.exited || l.partial || Math.abs(Number(l.realised) || 0) > 0.009))) return true;
  return false;
}

function monthMatrix(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay();
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

function weekBuckets(cells, byDate) {
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    const slice = cells.slice(i, i + 7).filter(Boolean);
    let pnl = 0;
    let booked = 0;
    let trades = 0;
    const holidays = [];
    let tradingDays = 0;
    for (const c of slice) {
      const hol = isHoliday(c.iso);
      if (hol && !isSpecialSessionIST(c.iso)) holidays.push(hol);
      if (isJournalSessionDayIST(c.iso)) tradingDays += 1;
      if (!isJournalSessionDayIST(c.iso)) continue;
      const doc = byDate.get(c.iso);
      if (!isTraded(doc)) continue;
      pnl += cellPnl(doc);
      booked += 1;
      trades += Number(doc.trade_count || doc.exited_count || 0);
    }
    weeks.push({
      pnl,
      booked,
      trades,
      tradingDays,
      holidays,
      label: `Week ${weeks.length + 1}`,
    });
  }
  return weeks;
}

function cellClasses(pnl, traded, maxAbs) {
  if (!traded) return { box: "bg-slate-50 border-slate-200 text-slate-500", amt: "text-slate-400", invert: false };
  const mag = Math.min(1, Math.abs(pnl) / Math.max(maxAbs, 1));
  if (pnl > 0) {
    if (mag > 0.62) return { box: "bg-emerald-600 border-emerald-700 text-white", amt: "text-white", invert: true };
    if (mag > 0.28) return { box: "bg-emerald-100 border-emerald-400", amt: "text-emerald-800", invert: false };
    return { box: "bg-emerald-50 border-emerald-300", amt: "text-emerald-700", invert: false };
  }
  if (pnl < 0) {
    if (mag > 0.62) return { box: "bg-rose-500 border-rose-600 text-white", amt: "text-white", invert: true };
    if (mag > 0.28) return { box: "bg-rose-100 border-rose-400", amt: "text-rose-800", invert: false };
    return { box: "bg-rose-50 border-rose-300", amt: "text-rose-700", invert: false };
  }
  return { box: "bg-sky-50 border-sky-200", amt: "text-sky-800", invert: false };
}

function heatCell(v, maxAbs) {
  const n = Number(v) || 0;
  if (Math.abs(n) < 0.01) return "bg-white text-slate-300";
  const mag = Math.min(1, Math.abs(n) / Math.max(maxAbs, 1));
  if (n > 0) {
    if (mag > 0.66) return "bg-emerald-600 text-white";
    if (mag > 0.33) return "bg-emerald-200 text-emerald-950";
    return "bg-emerald-50 text-emerald-800";
  }
  if (mag > 0.66) return "bg-rose-500 text-white";
  if (mag > 0.33) return "bg-rose-200 text-rose-950";
  return "bg-rose-50 text-rose-800";
}

function Gauge({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
        <circle cx="18" cy="18" r="14" fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="14"
          fill="none"
          stroke={p >= 50 ? "#059669" : "#e11d48"}
          strokeWidth="4"
          strokeDasharray={`${(p / 100) * 87.96} 87.96`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-800">
        {p.toFixed(p % 1 ? 1 : 0)}%
      </div>
    </div>
  );
}

export default function TradeJournalModal({ open, onOpenChange, privacy = false }) {
  const now = useMemo(() => new Date(), [open]);
  const [year, setYear] = useState(() => now.getFullYear());
  const [month, setMonth] = useState(() => now.getMonth() + 1);
  const [tab, setTab] = useState("calendar");
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dayDoc, setDayDoc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadMonth = useCallback(async (y, m) => {
    setLoading(true);
    try {
      const d = await fetchJournalMonth(y, m);
      setData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load journal");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadYear = useCallback(async (y) => {
    try {
      const d = await fetchJournalYear(y);
      setYearData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load year recap");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadMonth(year, month);
  }, [open, year, month, loadMonth]);

  useEffect(() => {
    if (!open) return;
    loadYear(year);
  }, [open, year, loadYear]);

  const byDate = useMemo(() => {
    const m = new Map();
    (data?.days || []).forEach((d) => m.set(d.date, d));
    return m;
  }, [data]);

  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const weeks = useMemo(() => weekBuckets(cells, byDate), [cells, byDate]);
  const stats = data?.stats || {};
  const tagsCatalog = data?.tags || [];
  const maxAbs = useMemo(() => {
    let m = 1;
    (data?.days || []).forEach((d) => {
      m = Math.max(m, Math.abs(cellPnl(d)));
    });
    return m;
  }, [data]);

  const shiftMonth = (dir) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
    setSelected(null);
    setDayDoc(null);
  };

  const goThisMonth = () => {
    const t = data?.today || new Date().toISOString().slice(0, 10);
    setYear(Number(t.slice(0, 4)));
    setMonth(Number(t.slice(5, 7)));
    setSelected(null);
    setDayDoc(null);
  };

  const applyDayPayload = (iso, d) => {
    const wrn = (d.win_trades || 0) + (d.loss_trades || 0);
    setDayDoc({
      went_well: d.went_well || "",
      went_wrong: d.went_wrong || "",
      notes: d.notes || "",
      tags: d.tags || [],
      rating: d.rating || null,
      followed_plan: d.followed_plan ?? null,
      pnl_total: d.display_pnl ?? d.booked_pnl ?? d.pnl_exited ?? d.frozen_pnl,
      pnl_exited: d.pnl_exited,
      pnl_open: d.pnl_open,
      booked_pnl: d.booked_pnl ?? d.pnl_exited,
      booked_after_charges: d.booked_after_charges,
      brokerage: d.brokerage,
      charges_total: d.charges_total,
      frozen_pnl: d.frozen_pnl,
      eod_locked: !!d.eod_locked,
      trade_count: d.trade_count || 0,
      exited_count: d.exited_count || 0,
      win_trades: d.win_trades || 0,
      loss_trades: d.loss_trades || 0,
      winrate: wrn ? (100 * (d.win_trades || 0) / wrn) : null,
      legs: d.legs || [],
      screenshots: d.screenshots || [],
      empty: !!d.empty,
      date: iso,
    });
  };

  const loadDay = async (iso) => {
    setSelected(iso);
    const d = await fetchJournalDay(iso);
    applyDayPayload(iso, d);
  };

  const openDay = async (iso) => {
    if (selected === iso && dayDoc) {
      setSelected(null);
      setDayDoc(null);
      return;
    }
    try {
      await loadDay(iso);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not open day");
    }
  };

  const save = async (override = null) => {
    const doc = resolveJournalSaveDoc(override, dayDoc);
    const payload = journalSavePayload(doc);
    if (!payload) return;
    setSaving(true);
    try {
      await saveJournalDay(payload.day, payload.body);
      toast.success("Journal saved");
      await Promise.all([loadMonth(year, month), loadYear(year)]);
      try {
        await loadDay(payload.day);
      } catch {
        /* keep the editor as saved locally */
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onFiles = async (files) => {
    if (!dayDoc?.date) return;
    for (const file of Array.from(files || []).slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      try {
        const meta = await addJournalScreenshot(dayDoc.date, {
          name: file.name,
          mime: file.type,
          data: dataUrl,
        });
        const d = await fetchJournalDay(dayDoc.date);
        setDayDoc((prev) => ({ ...prev, screenshots: d.screenshots || [...(prev.screenshots || []), meta] }));
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Image rejected (keep under ~450KB)");
      }
    }
  };

  const removeShot = async (id) => {
    await deleteJournalScreenshot(dayDoc.date, id);
    setDayDoc((prev) => ({
      ...prev,
      screenshots: (prev.screenshots || []).filter((s) => s.id !== id),
    }));
  };

  const toggleTag = (t) => {
    setDayDoc((prev) => {
      const cur = new Set(prev.tags || []);
      if (cur.has(t)) cur.delete(t);
      else cur.add(t);
      return { ...prev, tags: Array.from(cur) };
    });
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const today = data?.today;
  const avgWin = Number(stats.avg_win) || 0;
  const avgLoss = Math.abs(Number(stats.avg_loss) || 0);
  const barTotal = avgWin + avgLoss || 1;
  const heat = useMemo(
    () => overlayMonthOnYearHeat(yearData?.heatmap, data, year, month),
    [yearData, data, year, month],
  );
  const heatMax = Math.max(1, ...(heat?.month_nets || []).map((v) => Math.abs(v)));
  const yearStats = useMemo(() => {
    const s = yearData?.stats;
    if (s && (Number(s.trading_days) || 0) > 0) return s;
    const nets = heat?.month_nets || [];
    const net = nets.reduce((a, b) => a + (Number(b) || 0), 0);
    const days = (heat?.months || []).reduce((a, m) => a + (Number(m.trading_days) || 0), 0);
    if (days) return { ...(s || {}), net_pnl: net, trading_days: days };
    return s || {};
  }, [yearData, heat]);
  const focused = !!(selected && dayDoc && tab === "calendar");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[80] max-w-[min(96vw,78rem)] max-h-[94vh] overflow-y-auto p-0 gap-0 max-md:left-0 max-md:top-0 max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:max-w-none max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none sm:rounded-2xl border-slate-200"
        data-testid="trade-journal-modal"
      >
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-emerald-100 bg-[linear-gradient(135deg,#ecfdf5_0%,#fff_45%,#f8fafc_100%)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <BookOpen className="w-4 h-4" />
              </span>
              Trade journal
            </DialogTitle>
            <DialogDescription className="text-slate-600">
              <span className="hidden sm:inline">
                Daily booked P&amp;L (full exits and partial closes) is stored from the last Positions auto-refresh and frozen at session close. Brokerage lives in our database — not on Kite.
              </span>
              <span className="sm:hidden text-[12px]">
                Booked P&amp;L (exits + partials) · tap a day to journal
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex gap-1 rounded-full bg-white border border-slate-200 p-0.5 w-fit shadow-sm">
            <button
              type="button"
              onClick={() => setTab("calendar")}
              className={`h-8 px-3 rounded-full text-[12px] font-semibold ${tab === "calendar" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setTab("year")}
              className={`h-8 px-3 rounded-full text-[12px] font-semibold ${tab === "year" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              data-testid="journal-year-tab"
            >
              Year heatmap
            </button>
          </div>
        </div>

        <div className="px-3 sm:px-5 py-3 sm:py-4 space-y-3 max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {tab === "calendar" && (
            <>
              {!focused && (
              <>
              <div className="md:hidden rounded-xl border border-emerald-200 bg-white px-3 py-2 flex items-center justify-between gap-2 shadow-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Month booked</div>
                  <div className={`text-lg font-bold font-mono-data leading-tight ${Number(stats.net_pnl) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {privacy ? "••••" : compactPnl(stats.net_pnl)}
                  </div>
                </div>
                <div className="text-right text-[11px] text-slate-600 leading-snug">
                  <div>{stats.trading_days || 0} days · {stats.trade_win_rate ?? 0}% trades</div>
                  <div>{stats.win_rate ?? 0}% day wins · PF {stats.profit_factor ?? "—"}</div>
                </div>
              </div>
              <div className="hidden md:grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5 flex items-center gap-3 shadow-sm">
                  <Gauge pct={stats.trade_win_rate} />
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold">Trade win %</div>
                    <div className="text-lg font-semibold font-mono-data text-slate-900">{stats.trade_win_rate ?? 0}%</div>
                    <div className="text-[10px] text-slate-600">
                      {stats.trade_wins || 0} booked wins · {stats.trade_losses || 0} losses
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold">Avg win / loss</div>
                  <div className="text-lg font-semibold font-mono-data text-slate-900">{stats.avg_win_loss_ratio ?? "—"}</div>
                  <div className="mt-1.5 h-2 rounded-full overflow-hidden flex bg-slate-100">
                    <div className="bg-emerald-500" style={{ width: `${(100 * avgWin) / barTotal}%` }} />
                    <div className="bg-rose-400" style={{ width: `${(100 * avgLoss) / barTotal}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] mt-1 font-semibold">
                    <span className="text-emerald-800">{privacy ? "••••" : compactPnl(avgWin)}</span>
                    <span className="text-rose-700">{privacy ? "••••" : compactPnl(-avgLoss)}</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-3 py-2.5 flex items-center gap-3 shadow-sm">
                  <Gauge pct={stats.win_rate} />
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold">Day win %</div>
                    <div className="text-lg font-semibold font-mono-data text-slate-900">{stats.win_rate ?? 0}%</div>
                    <div className="text-[10px] text-slate-600 flex items-center gap-1">
                      <Trophy className="w-3 h-3 text-amber-600" />
                      Desk {stats.desk_score ?? "—"} · PF {stats.profit_factor ?? "—"}
                    </div>
                  </div>
                </div>
              </div>
              </>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => shiftMonth(-1)} data-testid="journal-prev-month">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-sm sm:text-base font-semibold min-w-0 flex-1 sm:flex-none sm:min-w-[10rem] text-center text-slate-900" data-testid="journal-month-label">{monthLabel}</div>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => shiftMonth(1)} data-testid="journal-next-month">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-full text-[11px]" onClick={goThisMonth}>
                  This month
                </Button>
                <div className="flex-1" />
                {!focused && (
                <div className="hidden md:flex items-center gap-2 text-sm">
                  <span className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold">Monthly stats</span>
                  <span className={`font-semibold font-mono-data ${Number(stats.net_pnl) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {privacy ? "••••" : compactPnl(stats.net_pnl)}
                  </span>
                  <span className="text-[12px] text-slate-500">{stats.trading_days || 0} days</span>
                </div>
                )}
              </div>

              <AnimatePresence mode="wait">
              {!focused && (
              <motion.div
                key="journal-cal"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="flex gap-2 min-w-0"
              >
              <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-7 gap-0.5 md:gap-2 text-[10px] md:text-[12px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
                    {WEEKDAYS.map((d, i) => (
                      <div key={d} className="text-center">
                        <span className="md:hidden">{WEEKDAYS_SHORT[i]}</span>
                        <span className="hidden md:inline">{d}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5 md:gap-2" data-testid="journal-calendar">
                    {cells.map((c, i) => {
                      if (!c) return <div key={`e-${i}`} />;
                      const doc = byDate.get(c.iso);
                      const pnl = cellPnl(doc);
                      const traded = isTraded(doc);
                      const isToday = c.iso === today;
                      const isSel = c.iso === selected;
                      const session = isJournalSessionDayIST(c.iso);
                      const special = isSpecialSessionIST(c.iso) && session;
                      const hol = isHoliday(c.iso) && !special;
                      const showBook = traded && session;
                      const tone = showBook ? cellClasses(pnl, true, maxAbs) : special
                        ? { box: "bg-violet-50 border-violet-300 text-violet-900", amt: "text-violet-900", invert: false }
                        : hol
                        ? { box: "bg-amber-50 border-amber-300 text-amber-900", amt: "text-amber-900", invert: false }
                        : !session
                          ? { box: "bg-slate-50 border-slate-200 text-slate-400", amt: "text-slate-400", invert: false, weekend: true }
                          : { box: "bg-white border-slate-200 text-slate-600", amt: "text-slate-400", invert: false };
                      const decided = (doc?.win_trades || 0) + (doc?.loss_trades || 0);
                      const wr = decided > 0 ? `${Math.round((100 * (doc.win_trades || 0)) / decided)}%` : null;
                      const hasNote = !!(doc?.went_well || doc?.went_wrong || doc?.notes);
                      const exits = Number(doc?.exited_count || 0);
                      return (
                        <button
                          key={c.iso}
                          type="button"
                          onClick={() => openDay(c.iso)}
                          data-testid={`journal-cell-${c.iso}`}
                          className={`rounded-md md:rounded-3xl border p-1 md:p-2.5 min-h-[56px] md:min-h-[118px] text-left transition-all md:hover:shadow-lg md:hover:-translate-y-0.5 ${tone.box} ${
                            isSel ? "ring-2 ring-emerald-500 shadow-md" : "md:shadow-sm"
                          }`}
                        >
                          <div className={`flex justify-between items-start ${tone.invert ? "text-white/80" : "text-slate-600"}`}>
                            <span className={`font-semibold text-[11px] md:text-[15px] leading-none ${tone.invert ? "text-white" : "text-slate-800"}`}>{c.day}</span>
                            <span className="flex items-center gap-0.5">
                              {isToday ? <span className="h-1.5 w-1.5 md:h-2 md:w-2 rounded-full bg-sky-500" title="Today" /> : null}
                              <span className="hidden md:flex items-center gap-0.5">
                                {hasNote ? <FileText className="w-3 h-3" /> : null}
                                {doc?.screenshot_count > 0 ? <span title="Has screenshot">🖼</span> : null}
                                {doc?.eod_locked && session ? <span title="Locked after last Positions refresh" className="text-[8px] font-bold">EOD</span> : null}
                              </span>
                            </span>
                          </div>
                          <div className="md:hidden mt-1 min-w-0">
                            {showBook ? (
                              <div className={`text-[11px] font-bold font-mono-data leading-tight truncate ${tone.amt}`}>
                                {privacy ? "··" : compactPnl(pnl)}
                              </div>
                            ) : special ? (
                              <div className="text-[9px] leading-tight text-violet-800 truncate" title={isHoliday(c.iso)?.name}>Muh.</div>
                            ) : hol ? (
                              <div className="text-[9px] leading-tight text-amber-800 truncate" title={hol.name}>Holi</div>
                            ) : !session ? (
                              <div className="text-[9px] text-slate-400">—</div>
                            ) : (
                              <div className="h-3" />
                            )}
                          </div>
                          <div className="hidden md:block">
                          {showBook ? (
                            <>
                              <div className={`mt-2 text-[17px] font-bold font-mono-data leading-tight ${tone.amt}`}>
                                {privacy ? "••••" : compactPnl(pnl)}
                              </div>
                              <div className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${tone.invert ? "text-white/75" : "text-slate-500"}`}>
                                Booked
                              </div>
                              {doc.charges_total > 0 && !privacy ? (
                                <div className={`text-[10px] mt-0.5 ${tone.invert ? "text-white/80" : "text-slate-500"}`}>
                                  after charges {compactPnl(doc.booked_after_charges ?? (pnl - Number(doc.charges_total || 0)))}
                                </div>
                              ) : null}
                              <div className={`text-[12px] mt-0.5 ${tone.invert ? "text-white/80" : "text-slate-500"}`}>
                                {exits} exit{exits === 1 ? "" : "s"}
                              </div>
                              {wr ? (
                                <div className={`text-[10px] font-semibold ${tone.invert ? "text-white/90" : "text-slate-600"}`}>{wr}</div>
                              ) : null}
                            </>
                          ) : special ? (
                            <div className="text-[12px] text-violet-800 mt-3 leading-tight font-medium" title={isHoliday(c.iso)?.name}>
                              Muhurat
                              <div className="text-[11px] font-normal mt-0.5">
                                {(isHoliday(c.iso)?.name || "Special session").replace(/\s*\(.*$/, "")}
                              </div>
                            </div>
                          ) : hol ? (
                            <div className="text-[12px] text-amber-800 mt-3 leading-tight font-medium" title={hol.name}>
                              Holiday
                              <div className="text-[11px] font-normal mt-0.5">{hol.name.replace(/\s*\(.*$/, "")}</div>
                            </div>
                          ) : !session ? (
                            <div className="text-[12px] text-slate-500 mt-3 font-medium">Market closed</div>
                          ) : (
                            <div className="mt-6" />
                          )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className="md:hidden mt-2 grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${Math.max(weeks.length, 1)}, minmax(0, 1fr))` }}
                    data-testid="journal-weekly-recap-mobile"
                  >
                    {weeks.map((w, wi) => (
                      <div key={w.label} className="rounded-lg border border-slate-200 bg-white px-1 py-1.5 text-center">
                        <div className="text-[8px] uppercase tracking-wide text-slate-400 font-semibold">W{wi + 1}</div>
                        <div className={`text-[10px] font-bold font-mono-data leading-tight truncate ${w.booked ? (w.pnl >= 0 ? "text-emerald-700" : "text-rose-700") : "text-slate-300"}`}>
                          {privacy ? "··" : (w.booked ? compactPnl(w.pnl) : "—")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hidden md:flex w-[9rem] shrink-0 flex-col gap-2" data-testid="journal-weekly-recap">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-0.5">Weekly recap</div>
                  {weeks.map((w) => (
                    <div key={w.label} className="flex-1 min-h-[5rem] rounded-3xl border border-slate-200 bg-white px-2.5 py-2.5 shadow-sm flex flex-col">
                      <div className="text-[10px] font-semibold text-slate-700">{w.label}</div>
                      <div className={`text-[15px] font-bold font-mono-data leading-tight ${w.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {privacy ? "••••" : compactPnl(w.pnl)}
                      </div>
                      <div className="mt-auto">
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5">
                          {w.tradingDays} day{w.tradingDays === 1 ? "" : "s"}
                        </span>
                      </div>
                      {w.holidays?.length ? (
                        <div className="text-[9px] text-amber-700 leading-tight mt-0.5" title={w.holidays.map((h) => h.name).join(", ")}>
                          Holiday · {w.holidays.map((h) => h.name.replace(/\s*\(.*$/, "")).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </motion.div>
              )}
              </AnimatePresence>
              {loading && !focused && <div className="text-xs text-slate-600">Loading calendar…</div>}
            </>
          )}

          {tab === "year" && (
            <div className="space-y-3" data-testid="journal-year-heatmap">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setYear((y) => y - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-base font-semibold">{year}</div>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setYear((y) => y + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <div className="flex-1" />
                <span className={`font-semibold font-mono-data ${Number(yearStats?.net_pnl) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {privacy ? "••••" : compactPnl(yearStats?.net_pnl)}
                </span>
                <span className="text-[12px] text-slate-500">{yearStats?.trading_days || 0} days</span>
              </div>
              <div className="md:hidden space-y-1.5" data-testid="journal-year-heatmap-mobile">
                {MONTH_SHORT.map((m, i) => {
                  const net = Number(heat?.month_nets?.[i] || 0);
                  const days = heat?.months?.[i]?.trading_days || 0;
                  const by = heat?.by_index || {};
                  if (Math.abs(net) < 0.01 && !days) {
                    return (
                      <div key={m} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-[12px] text-slate-400">
                        <span className="font-semibold text-slate-500">{m}</span>
                        <span>—</span>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setMonth(i + 1); setTab("calendar"); }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-slate-800">{m}</span>
                        <span className={`font-mono-data font-bold text-[13px] ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {privacy ? "••••" : compactPnl(net)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] font-mono-data text-slate-500">
                        {["NIFTY", "SENSEX", "BANKNIFTY"].map((idx) => {
                          const v = Number(by[idx]?.[i] || 0);
                          if (Math.abs(v) < 0.01) return null;
                          return (
                            <span key={idx} className={v >= 0 ? "text-emerald-700" : "text-rose-700"}>
                              {idx === "BANKNIFTY" ? "BNF" : idx} {compactPnl(v)}
                            </span>
                          );
                        })}
                        <span className="text-slate-400">{days}d</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-[11px] min-w-[40rem]">
                  <thead>
                    <tr className="text-slate-600 bg-slate-50">
                      <th className="text-left p-2 font-medium">Index</th>
                      {MONTH_SHORT.map((m) => (
                        <th key={m} className="p-2 font-medium">{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(heat?.indices || ["NIFTY", "SENSEX", "BANKNIFTY"]).map((idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-semibold text-slate-700">{idx}</td>
                        {(heat?.by_index?.[idx] || Array(12).fill(0)).map((v, i) => (
                          <td key={i} className={`p-1.5 text-center font-mono-data font-semibold ${heatCell(v, heatMax)}`}>
                            {Math.abs(Number(v) || 0) < 0.01 ? "—" : (privacy ? "••••" : compactPnl(v))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t border-slate-100">
                      <td className="p-2 font-semibold">Month</td>
                      {(heat?.month_nets || Array(12).fill(0)).map((v, i) => (
                        <td key={i} className={`p-1.5 text-center font-mono-data font-bold ${heatCell(v, heatMax)}`}>
                          {Math.abs(Number(v) || 0) < 0.01 ? "—" : (privacy ? "••••" : compactPnl(v))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-600">
                Month totals are booked P&amp;L (full exits and partial closes) for each stored day. Open a month on Calendar to journal that book.
              </p>
            </div>
          )}

          {focused && (
            <motion.div
              key="journal-focus"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.24 }}
              className="flex flex-col md:flex-row gap-3 items-stretch md:items-start"
              data-testid="journal-day-focus"
            >
              <button
                type="button"
                onClick={() => openDay(selected)}
                data-testid="journal-focus-date"
                className="shrink-0 w-full md:w-[6.5rem] rounded-2xl border-2 border-emerald-500 bg-emerald-600 text-white px-3 py-3 text-left shadow-md hover:bg-emerald-700"
                title="Click to return to calendar"
              >
                <div className="text-[10px] uppercase tracking-wide text-emerald-100 font-semibold">Selected</div>
                <div className="text-3xl font-bold leading-none mt-1">
                  {Number(String(dayDoc.date).slice(8, 10))}
                </div>
                <div className="text-[11px] mt-1 text-emerald-50">
                  {new Date(`${dayDoc.date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}
                </div>
                <div className="text-[10px] mt-2 text-emerald-100">Tap to calendar</div>
              </button>
            <div className="rounded-2xl border border-emerald-100 p-4 space-y-3 bg-gradient-to-br from-white via-white to-emerald-50/40 shadow-sm flex-1 min-w-0" data-testid="journal-day-editor">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">
                    {new Date(`${dayDoc.date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  </div>
                  <div className={`text-[22px] font-bold font-mono-data leading-tight ${Number(dayDoc.booked_pnl ?? dayDoc.pnl_exited) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    Booked {privacy ? "••••" : fmtInr(dayDoc.booked_pnl ?? dayDoc.pnl_exited, 0)}
                    {dayDoc.eod_locked ? <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-violet-600">Locked 15:45</span> : <span className="ml-2 text-[10px] font-medium text-slate-400">Live until 15:45 IST</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5" data-testid="journal-after-charges">
                    {privacy
                      ? "after charges ••••"
                      : dayDoc.charges_total != null
                        ? `after charges ${fmtInr(dayDoc.booked_after_charges ?? ((Number(dayDoc.booked_pnl ?? dayDoc.pnl_exited) || 0) - Number(dayDoc.charges_total)), 0)}`
                        : "charges pending"}
                    {dayDoc.brokerage != null && !privacy ? (
                      <span className="ml-2 text-slate-400">· brokerage {fmtInr(dayDoc.brokerage, 0)}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-500 mr-0.5">Day score</span>
                  <InfoTip title="Day score 1–5" testId="journal-rating-tip">
                    <p>How the session felt as a seller — saved on this date in the journal.</p>
                    <p className="mt-1"><b>1</b> poor process / chased · <b>3</b> okay · <b>5</b> followed the plan cleanly.</p>
                    <p className="mt-1">Tap a number to set it. Save stores notes, tags, and this score in the database.</p>
                  </InfoTip>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`h-8 w-8 rounded-md text-sm font-bold border ${
                        dayDoc.rating === n ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500"
                      }`}
                      onClick={() => {
                        const next = { ...dayDoc, rating: n };
                        setDayDoc(next);
                        save(next);
                      }}
                      data-testid={`journal-rating-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <Stat label="Booked trades" value={(dayDoc.win_trades + dayDoc.loss_trades) || dayDoc.exited_count || 0} />
                <Stat label="Winners" value={dayDoc.win_trades} />
                <Stat label="Losers" value={dayDoc.loss_trades} />
                <Stat label="Winrate" value={dayDoc.winrate != null ? `${dayDoc.winrate.toFixed(1)}%` : "—"} />
                <Stat label="Brokerage" value={privacy ? "••••" : fmtInr(dayDoc.brokerage, 0)} />
                <Stat label="All charges" value={privacy ? "••••" : fmtInr(dayDoc.charges_total, 0)} />
              </div>

              {(dayDoc.legs || []).filter((leg) => leg.exited || leg.partial || Math.abs(Number(leg.realised) || 0) > 0.009).length > 0 && (
                <div className="max-h-28 overflow-auto rounded-md border border-slate-100 text-[11px]">
                  {dayDoc.legs.filter((leg) => leg.exited || leg.partial || Math.abs(Number(leg.realised) || 0) > 0.009).map((leg, i) => (
                    <div key={i} className="flex justify-between gap-2 px-2 py-1 border-b border-slate-50">
                      <span className="truncate">
                        {leg.tradingsymbol}
                        {leg.partial ? " · partial" : ""}
                      </span>
                      <span className={`font-mono-data ${(leg.realised ?? leg.pnl) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {privacy ? "••••" : compactPnl(leg.realised ?? leg.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {tagsCatalog.map((t) => {
                  const on = (dayDoc.tags || []).includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`h-7 px-2 rounded-full text-[10px] font-semibold border ${
                        on ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <input
                  type="checkbox"
                  checked={dayDoc.followed_plan === true}
                  onChange={(e) => setDayDoc((p) => ({ ...p, followed_plan: e.target.checked }))}
                />
                Followed the plan (hold / reduce / close)
              </label>

              <div className="grid md:grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-500 block">
                  What went well
                  <textarea
                    value={dayDoc.went_well}
                    onChange={(e) => setDayDoc((p) => ({ ...p, went_well: e.target.value }))}
                    className="mt-1 w-full min-h-[88px] rounded-md border border-slate-200 p-2 text-sm text-slate-800"
                    data-testid="journal-went-well"
                  />
                </label>
                <label className="text-[11px] text-slate-500 block">
                  What went wrong
                  <textarea
                    value={dayDoc.went_wrong}
                    onChange={(e) => setDayDoc((p) => ({ ...p, went_wrong: e.target.value }))}
                    className="mt-1 w-full min-h-[88px] rounded-md border border-slate-200 p-2 text-sm text-slate-800"
                    data-testid="journal-went-wrong"
                  />
                </label>
              </div>
              <label className="text-[11px] text-slate-500 block">
                Session notes
                <textarea
                  value={dayDoc.notes}
                  onChange={(e) => setDayDoc((p) => ({ ...p, notes: e.target.value }))}
                  className="mt-1 w-full min-h-[64px] rounded-md border border-slate-200 p-2 text-sm"
                  data-testid="journal-notes"
                />
              </label>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] text-slate-500">Screenshots</span>
                  <label className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-slate-200 text-[11px] cursor-pointer hover:bg-slate-50">
                    <ImagePlus className="w-3.5 h-3.5" />
                    Add
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      multiple
                      onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(dayDoc.screenshots || []).map((s) => (
                    <div key={s.id} className="relative w-24 h-20 rounded-md overflow-hidden border border-slate-200 bg-slate-100">
                      {s.data ? (
                        <img alt={s.name} src={`data:${s.mime};base64,${s.data}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-[10px] p-2 text-slate-500">{s.name}</div>
                      )}
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 h-5 w-5 rounded bg-white/90 text-rose-600 flex items-center justify-center"
                        onClick={() => removeShot(s.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    save();
                  }}
                  disabled={saving}
                  data-testid="journal-save"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {saving ? "Saving…" : "Save journal"}
                </Button>
              </div>
            </div>
            </motion.div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-white px-2 py-1.5 border border-slate-200 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
      <div className="font-semibold font-mono-data text-slate-900">{value ?? "—"}</div>
    </div>
  );
}
