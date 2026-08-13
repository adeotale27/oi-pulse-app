import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ImagePlus, Save, Trash2, Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fetchJournalMonth,
  fetchJournalDay,
  saveJournalDay,
  addJournalScreenshot,
  deleteJournalScreenshot,
} from "@/lib/api";
import { toast } from "sonner";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function monthMatrix(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Mon=0
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
    let days = 0;
    for (const c of slice) {
      const doc = byDate.get(c.iso);
      if (!doc) continue;
      pnl += Number(doc.pnl_total) || 0;
      if ((doc.trade_count || 0) > 0 || Math.abs(Number(doc.pnl_total) || 0) > 0.009) days += 1;
    }
    weeks.push({ pnl, days, label: `W${weeks.length + 1}` });
  }
  return weeks;
}

export default function TradeJournalModal({ open, onOpenChange, privacy = false }) {
  const now = useMemo(() => new Date(), [open]);
  const [year, setYear] = useState(() => now.getFullYear());
  const [month, setMonth] = useState(() => now.getMonth() + 1);
  const [data, setData] = useState(null);
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

  useEffect(() => {
    if (!open) return;
    loadMonth(year, month);
  }, [open, year, month, loadMonth]);

  const byDate = useMemo(() => {
    const m = new Map();
    (data?.days || []).forEach((d) => m.set(d.date, d));
    return m;
  }, [data]);

  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const weeks = useMemo(() => weekBuckets(cells, byDate), [cells, byDate]);
  const stats = data?.stats || {};
  const tagsCatalog = data?.tags || [];

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

  const openDay = async (iso) => {
    setSelected(iso);
    try {
      const d = await fetchJournalDay(iso);
      setDayDoc({
        went_well: d.went_well || "",
        went_wrong: d.went_wrong || "",
        notes: d.notes || "",
        tags: d.tags || [],
        rating: d.rating || null,
        followed_plan: d.followed_plan ?? null,
        pnl_total: d.pnl_total,
        pnl_exited: d.pnl_exited,
        pnl_open: d.pnl_open,
        legs: d.legs || [],
        screenshots: d.screenshots || [],
        empty: !!d.empty,
        date: iso,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not open day");
    }
  };

  const save = async () => {
    if (!dayDoc?.date) return;
    setSaving(true);
    try {
      await saveJournalDay(dayDoc.date, {
        went_well: dayDoc.went_well,
        went_wrong: dayDoc.went_wrong,
        notes: dayDoc.notes,
        tags: dayDoc.tags,
        rating: dayDoc.rating,
        followed_plan: dayDoc.followed_plan,
      });
      toast.success("Journal saved");
      loadMonth(year, month);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,72rem)] max-h-[92vh] overflow-y-auto p-4 sm:p-5"
        data-testid="trade-journal-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-700" />
            Trade journal
          </DialogTitle>
          <DialogDescription>
            NIFTY / SENSEX seller book — calendar of the month, then write what worked and what did not.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kpi label="Month P&L" value={privacy ? "••••" : fmtInr(stats.net_pnl, 0)} tone={stats.net_pnl >= 0 ? "emerald" : "rose"} />
          <Kpi label="Trading days" value={stats.trading_days ?? 0} hint={`${stats.win_days || 0} green · ${stats.lose_days || 0} red`} />
          <Kpi label="Win days" value={`${stats.win_rate ?? 0}%`} hint={`PF ${stats.profit_factor ?? "—"}`} />
          <Kpi
            label="Desk score"
            value={stats.desk_score != null ? stats.desk_score : "—"}
            hint="Win days · profit factor · consistency"
            icon={<Trophy className="w-3.5 h-3.5" />}
          />
        </div>

        {(stats.best_day || stats.worst_day) && (
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1.5">
              Best day · {stats.best_day?.date || "—"} · {privacy ? "••••" : fmtInr(stats.best_day?.pnl, 0)}
            </div>
            <div className="rounded-md border border-rose-100 bg-rose-50/70 px-2 py-1.5">
              Least day · {stats.worst_day?.date || "—"} · {privacy ? "••••" : fmtInr(stats.worst_day?.pnl, 0)}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => shiftMonth(-1)} data-testid="journal-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-sm font-semibold flex-1 text-center" data-testid="journal-month-label">{monthLabel}</div>
          <Button size="sm" variant="outline" className="h-8" onClick={() => shiftMonth(1)} data-testid="journal-next-month">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-x-auto">
            <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-400 mb-1">
              {WEEKDAYS.map((d) => <div key={d} className="text-center">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1" data-testid="journal-calendar">
              {cells.map((c, i) => {
                if (!c) return <div key={`e-${i}`} />;
                const doc = byDate.get(c.iso);
                const pnl = Number(doc?.pnl_total);
                const traded = !!doc && ((doc.trade_count || 0) > 0 || Math.abs(pnl) > 0.009);
                const isToday = c.iso === today;
                const isSel = c.iso === selected;
                let bg = "bg-white border-slate-100";
                if (traded && pnl > 0) bg = "bg-emerald-50 border-emerald-200";
                if (traded && pnl < 0) bg = "bg-rose-50 border-rose-200";
                if (traded && pnl === 0) bg = "bg-sky-50 border-sky-100";
                const wr = doc && (doc.win_trades + doc.loss_trades) > 0
                  ? `${Math.round(100 * doc.win_trades / (doc.win_trades + doc.loss_trades))}%`
                  : null;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    onClick={() => openDay(c.iso)}
                    data-testid={`journal-cell-${c.iso}`}
                    className={`rounded-md border p-1.5 min-h-[72px] text-left hover:border-emerald-400 ${bg} ${
                      isSel ? "ring-2 ring-emerald-500" : ""
                    } ${isToday ? "outline outline-1 outline-slate-400" : ""}`}
                  >
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span className="font-semibold text-slate-700">{c.day}</span>
                      {doc?.screenshot_count > 0 ? <span title="Has screenshot">🖼</span> : null}
                    </div>
                    {traded ? (
                      <>
                        <div className={`text-[12px] font-bold font-mono-data ${pnl >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                          {privacy ? "••••" : compactPnl(pnl)}
                        </div>
                        <div className="text-[9px] text-slate-500">
                          {doc.exited_count || 0} booked
                          {wr ? ` · ${wr}` : ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-300 mt-3">—</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="hidden sm:flex w-24 shrink-0 flex-col gap-1">
            {weeks.map((w) => (
              <div key={w.label} className="flex-1 rounded-md border border-slate-100 bg-slate-50 px-1.5 py-1 text-[10px]">
                <div className="uppercase tracking-wider text-slate-400">{w.label}</div>
                <div className={`font-mono-data font-semibold ${w.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {privacy ? "••••" : compactPnl(w.pnl)}
                </div>
                <div className="text-slate-400">{w.days}d</div>
              </div>
            ))}
          </div>
        </div>

        {loading && <div className="text-xs text-slate-400">Loading calendar…</div>}

        {dayDoc && (
          <div className="rounded-lg border border-slate-200 p-3 space-y-3" data-testid="journal-day-editor">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{dayDoc.date}</div>
                <div className="text-[11px] text-slate-500">
                  Today P&amp;L {privacy ? "••••" : fmtInr(dayDoc.pnl_total, 0)}
                  {dayDoc.pnl_exited != null ? ` · booked ${privacy ? "••••" : fmtInr(dayDoc.pnl_exited, 0)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`h-7 w-7 rounded-md text-xs font-bold border ${
                      dayDoc.rating === n ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500"
                    }`}
                    onClick={() => setDayDoc((p) => ({ ...p, rating: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {(dayDoc.legs || []).length > 0 && (
              <div className="max-h-28 overflow-auto rounded-md border border-slate-100 text-[11px]">
                {dayDoc.legs.map((leg, i) => (
                  <div key={i} className="flex justify-between gap-2 px-2 py-1 border-b border-slate-50">
                    <span className="truncate">{leg.tradingsymbol} {leg.exited ? "· booked" : "· open"}</span>
                    <span className={`font-mono-data ${leg.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {privacy ? "••••" : compactPnl(leg.pnl)}
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
              <Button size="sm" onClick={save} disabled={saving} data-testid="journal-save" className="bg-emerald-700 hover:bg-emerald-800 text-white">
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saving ? "Saving…" : "Save journal"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, hint, tone, icon }) {
  const cls = tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1">
        {icon}{label}
      </div>
      <div className={`text-lg font-semibold font-mono-data ${cls}`}>{value}</div>
      {hint ? <div className="text-[10px] text-slate-400">{hint}</div> : null}
    </div>
  );
}
