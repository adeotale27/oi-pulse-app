import { useEffect, useState, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BigClock from "@/components/BigClock";
import { RotateCcw, TrendingUp, TrendingDown, Plus, Minus } from "lucide-react";
import {
  loadExpiryListHeight,
  saveExpiryListHeight,
  clampExpiryListHeight,
  EXPIRY_LIST_MIN_PX,
  EXPIRY_LIST_MAX_PX,
} from "@/lib/tabOrder";
import StrikeAroundChips from "@/components/StrikeAroundChips";
import { INDEX_SHORT, INDEX_STEP, usesIndexOverflow } from "@/lib/universe";
import { pickIndexLtp } from "@/lib/indexQuotes";

const INDEX_THEME = {
  NIFTY: {
    label: "NIFTY",
    activeCls:   "bg-gradient-to-br from-sky-500 to-cyan-600 text-white border-sky-500 shadow-md shadow-sky-500/20",
    idleCls:     "bg-gradient-to-br from-sky-50 to-cyan-50 text-sky-900 border-sky-100 hover:from-sky-100 hover:to-cyan-100",
    dot:         "bg-sky-500",
  },
  SENSEX: {
    label: "SENSEX",
    activeCls:   "bg-gradient-to-br from-amber-500 to-orange-600 text-white border-orange-500 shadow-md shadow-orange-500/20",
    idleCls:     "bg-gradient-to-br from-amber-50 to-orange-50 text-orange-800 border-orange-100 hover:from-amber-100 hover:to-orange-100",
    dot:         "bg-orange-500",
  },
  BANKNIFTY: {
    label: "BNF",
    activeCls:   "bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-emerald-500 shadow-md shadow-emerald-500/20",
    idleCls:     "bg-gradient-to-br from-emerald-50 to-teal-50 text-teal-800 border-teal-100 hover:from-emerald-100 hover:to-emerald-100",
    dot:         "bg-emerald-500",
  },
  CRUDEOIL: {
    label: "CRUDE",
    activeCls:   "bg-gradient-to-br from-slate-600 to-zinc-700 text-white border-slate-600 shadow-md shadow-slate-500/20",
    idleCls:     "bg-gradient-to-br from-slate-50 to-zinc-100 text-slate-800 border-slate-200 hover:from-slate-100",
    dot:         "bg-slate-600",
  },
  GOLD: {
    label: "GOLD",
    activeCls:   "bg-gradient-to-br from-yellow-500 to-amber-600 text-white border-yellow-500 shadow-md shadow-yellow-500/20",
    idleCls:     "bg-gradient-to-br from-yellow-50 to-amber-50 text-amber-900 border-yellow-200 hover:from-yellow-100",
    dot:         "bg-yellow-500",
  },
  SILVER: {
    label: "SILVER",
    activeCls:   "bg-gradient-to-br from-zinc-500 to-slate-600 text-white border-zinc-500 shadow-md shadow-zinc-500/20",
    idleCls:     "bg-gradient-to-br from-zinc-50 to-slate-100 text-zinc-800 border-zinc-200 hover:from-zinc-100",
    dot:         "bg-zinc-400",
  },
  NATURALGAS: {
    label: "NG",
    activeCls:   "bg-gradient-to-br from-cyan-600 to-sky-700 text-white border-cyan-600 shadow-md shadow-cyan-500/20",
    idleCls:     "bg-gradient-to-br from-cyan-50 to-sky-50 text-cyan-900 border-cyan-200 hover:from-cyan-100",
    dot:         "bg-cyan-600",
  },
};

/**
 * Strike-range step size per index (as per user requirement):
 *   • NIFTY: 50 pts per ± click
 *   • SENSEX / BANKNIFTY: 100 pts per ± click
 */
const STRIKE_STEP = INDEX_STEP;

function snapToStep(value, step) {
  const n = Number(value);
  if (!Number.isFinite(n) || !step) return n;
  return Math.round(n / step) * step;
}

function StepperInput({ testId, value, step, onChange, min = 0, max = Infinity }) {
  const commit = (raw) => {
    let next = snapToStep(raw, step);
    if (!Number.isFinite(next)) return;
    next = Math.max(min, Math.min(max, next));
    onChange(next);
  };
  const dec = () => commit((Number(value) || 0) - step);
  const inc = () => commit((Number(value) || 0) + step);
  return (
    <div className="flex items-center gap-1" data-testid={`${testId}-stepper`}>
      <button
        type="button"
        data-testid={`${testId}-dec`}
        onClick={dec}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 active:scale-95 shrink-0 transition-colors"
        aria-label="Decrement"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <Input
        data-testid={testId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value ?? ""}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, "");
          if (digits === "") {
            onChange("");
            return;
          }
          onChange(Number(digits));
        }}
        onBlur={() => {
          if (value === "" || value == null) return;
          commit(value);
        }}
        className="h-8 min-w-0 flex-1 rounded-md font-mono-data text-sm text-center px-1"
      />
      <button
        type="button"
        data-testid={`${testId}-inc`}
        onClick={inc}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 active:scale-95 shrink-0 transition-colors"
        aria-label="Increment"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ExpiryBadge({ tag }) {
  const isWeekly = tag === "W";
  return (
    <span
      data-testid={`expiry-tag-${tag}`}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold leading-none border shadow-sm shrink-0 ${
        isWeekly
          ? "bg-sky-500 text-white border-sky-600"
          : "bg-amber-500 text-white border-amber-600"
      }`}
      title={isWeekly ? "Weekly expiry" : "Monthly expiry"}
    >
      {tag}
    </span>
  );
}

export default function Sidebar({
  indices,
  activeIndex,
  onChangeIndex,
  current,
  spotPrices = {},
  strikesAround,
  onChangeStrikesAround,
  strikeRange,
  onChangeStrikeRange,
  onReset,
  expiries,
  expiriesMeta,
  expiriesNote,
  selectedExpiry,
  onChangeExpiry,
  showStrikeRange = false,
  lastUpdatedByIndex = {},
  marketOpen = true,
  onCollapse,
  layoutNonce = 0,
}) {
  const price = pickIndexLtp({
    idx: activeIndex,
    live: spotPrices?.[activeIndex],
    current,
  }) ?? 0;
  // Admin note section state (below the big clock). Publicly visible; editable by admin.
  const [note, setNote] = useState("");
  const [editText, setEditText] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [noteUpdatedAt, setNoteUpdatedAt] = useState(null);
  const [loadingNote, setLoadingNote] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  // Re-render every 15s so inactive-index stale flash (>2 min) stays accurate.
  const [, setAgeTick] = useState(0);
  const [expiryListHeight, setExpiryListHeight] = useState(() => loadExpiryListHeight());
  const expiryListRef = useRef(null);
  useEffect(() => {
    const id = setInterval(() => setAgeTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Reset layout control reloads stored height (defaults after resetLayoutPrefs).
  useEffect(() => {
    setExpiryListHeight(loadExpiryListHeight());
  }, [layoutNonce]);

  const onExpiryResizePointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = expiryListHeight;
    const pointerId = e.pointerId;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* noop */
    }

    const onMove = (ev) => {
      const next = clampExpiryListHeight(startH + (ev.clientY - startY));
      setExpiryListHeight(next);
    };
    const onUp = (ev) => {
      const next = clampExpiryListHeight(startH + (ev.clientY - startY));
      setExpiryListHeight(next);
      saveExpiryListHeight(next);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* noop */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [expiryListHeight]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const api = (await import('@/lib/api')).api;
        const noteResp = await api.get('/sidebar/note').catch(() => ({ data: { text: "", updated_at: null } }));
        if (!alive) return;
        const text = noteResp.data?.text || "";
        setNote(text);
        setEditText(text);
        setNoteUpdatedAt(noteResp.data?.updated_at || null);
        // One-shot auth for note editing — further updates via Dashboard broadcast.
        try {
          const { data } = await api.get('/auth/state');
          if (!alive) return;
          const admin = Boolean(data?.is_admin) && !data?.is_guest;
          setIsAdmin(admin);
          if (admin) setIsEditing(!text);
        } catch (_) {
          /* ignore */
        }
      } catch (e) {
        // ignore
      } finally {
        if (alive) setLoadingNote(false);
      }
    };
    const boot = setTimeout(load, 1500);
    const onState = (e) => {
      if (!alive) return;
      const data = e?.detail;
      if (data && typeof data.is_admin === "boolean") {
        const admin = Boolean(data.is_admin) && !data.is_guest;
        setIsAdmin(admin);
      }
    };
    window.addEventListener("oi-admin-auth-state", onState);
    try {
      const last = window.__oi_last_auth_state;
      if (last && typeof last.is_admin === "boolean") {
        setIsAdmin(Boolean(last.is_admin) && !last.is_guest);
      }
    } catch (_) { /* noop */ }
    return () => {
      alive = false;
      clearTimeout(boot);
      window.removeEventListener("oi-admin-auth-state", onState);
    };
  }, []);

  const saveNote = async () => {
    try {
      const api = (await import('@/lib/api')).api;
      await api.post('/sidebar/note', { text: editText });
      setNote(editText);
      setNoteUpdatedAt(new Date().toISOString());
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert('Save failed');
    }
  };

  const eraseNote = async () => {
    try {
      if (!window.confirm('Erase the note? This cannot be undone.')) return;
      const api = (await import('@/lib/api')).api;
      await api.delete('/sidebar/note');
      setNote("");
      setEditText("");
      setNoteUpdatedAt(null);
      setIsEditing(true);
    } catch (e) {
      console.error(e);
      alert('Erase failed');
    }
  };

  // Resolve meta by ISO date so downstream operations stay by-date.
  const metaByDate = new Map(
    (expiriesMeta || []).map((m) => [m.date, m])
  );
  // If no meta provided, fall back to plain expiries with W tag.
  const orderedExpiries =
    expiriesMeta && expiriesMeta.length
      ? expiriesMeta
      : (expiries || []).map((d) => ({ date: d, tag: "W", type: "weekly", days_to_expiry: null, label: d }));

  // Keep selected (or nearest weekly) visible when the list is short / scrolled.
  const expiryDatesKey = orderedExpiries.map((e) => `${e.date}:${e.tag || ""}`).join("|");
  useEffect(() => {
    const list = expiryListRef.current;
    if (!list || !orderedExpiries.length) return;
    const targetDate =
      selectedExpiry ||
      orderedExpiries.find((e) => (e.tag || "").toUpperCase() === "W")?.date ||
      orderedExpiries[0]?.date;
    if (!targetDate) return;
    const el =
      list.querySelector(`[data-expiry-date="${targetDate}"]`) ||
      list.querySelector(`[data-testid="expiry-${targetDate}"]`);
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orderedExpiries identity changes each render
  }, [selectedExpiry, expiryDatesKey, expiryListHeight, activeIndex, layoutNonce]);

  const step = STRIKE_STEP[activeIndex] || 50;
  const indexList = Array.isArray(indices) ? indices : [];
  const useIndexDropdown = usesIndexOverflow(indexList);

  const fmtPull = (iso) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch (_) {
      return null;
    }
  };

  const ageSec = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 1000));
  };

  return (
    <aside
      data-testid="sidebar"
      className="oi-sidebar w-72 shrink-0 h-full flex flex-col overflow-y-auto relative z-10 max-md:w-[min(18rem,88vw)] rounded-r-2xl"
    >
      {/* Index search / switcher — Hide sits on the INDEX row (no "Sidebar" label when open) */}
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-700/70">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] uppercase tracking-widest text-slate-500">Index</Label>
          {typeof onCollapse === "function" && (
            <button
              type="button"
              data-testid="btn-hide-sidebar"
              onClick={onCollapse}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Hide sidebar"
            >
              Hide
            </button>
          )}
        </div>
        {useIndexDropdown ? (
          <div className="mt-2 space-y-1.5" data-testid="sidebar-index-dropdown">
            <label className="block">
              <span className="sr-only">Switch index</span>
              <select
                data-testid="sidebar-index-select"
                value={activeIndex}
                onChange={(e) => onChangeIndex(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[12px] font-semibold px-2 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {indexList.map((idx) => (
                  <option key={idx} value={idx}>
                    {INDEX_THEME[idx]?.label || INDEX_SHORT[idx] || idx}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const idx = activeIndex;
              const theme = INDEX_THEME[idx] || INDEX_THEME.NIFTY;
              const pulled = lastUpdatedByIndex?.[idx];
              const age = ageSec(pulled);
              const fresh = age != null && age <= 90;
              const stale = marketOpen && age != null && age > 120;
              return (
                <div
                  className={`rounded-md border-2 py-1.5 px-2 ${theme.activeCls}`}
                  data-testid={`btn-index-${idx}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{theme.label}</span>
                    <span className={`text-[9px] font-mono ${fresh ? "text-white/90" : stale ? "text-amber-100" : "text-white/75"}`}>
                      {pulled ? fmtPull(pulled) : "—"}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {indexList.map((idx) => {
            const active = idx === activeIndex;
            const theme = INDEX_THEME[idx] || INDEX_THEME.NIFTY;
            const pulled = lastUpdatedByIndex?.[idx];
            const age = ageSec(pulled);
            // Align with server stale_after (max(90, poll_interval*3)); 180 covers 60s cadence.
            const fresh = age != null && age <= 90;
            // Only flash "stale" while the market is open — after configured
            // close / weekend / holiday the last tick is expected to age.
            const veryStale = marketOpen && !active && age != null && age > 180;
            const stale = marketOpen && age != null && age > 120;
            return (
              <button
                key={idx}
                data-testid={`btn-index-${idx}`}
                onClick={() => onChangeIndex(idx)}
                className={`relative text-[10px] sm:text-[11px] font-semibold rounded-md py-2 px-0.5 border-2 transition-all leading-tight min-w-0 ${
                  active ? theme.activeCls : theme.idleCls
                } ${veryStale ? "index-chip-stale" : ""}`}
                title={
                  idx === "BANKNIFTY"
                    ? (pulled
                      ? `BANK NIFTY · last OI ${fmtPull(pulled)} IST`
                      : "BANK NIFTY · no warm snapshot yet")
                    : pulled
                      ? veryStale
                        ? `STALE · last OI ${fmtPull(pulled)} IST (${age}s behind)`
                        : marketOpen
                          ? `Last OI ${fmtPull(pulled)} IST`
                          : `Last session OI ${fmtPull(pulled)} IST (market closed)`
                      : "No warm snapshot yet"
                }
              >
                <span className={`absolute top-1 left-1.5 w-1.5 h-1.5 rounded-full ${theme.dot} ${active ? "opacity-100" : "opacity-70"}`} />
                <div className="whitespace-nowrap">{theme.label}</div>
                <div
                  data-testid={`index-updated-${idx}`}
                  className={`mt-1 text-[9px] font-mono font-medium tracking-tight ${
                    active
                      ? "text-white/85"
                      : veryStale
                        ? "text-amber-800 font-semibold"
                        : !marketOpen
                          ? "text-slate-500"
                          : fresh
                            ? "text-emerald-700"
                            : stale
                              ? "text-amber-700"
                              : "text-slate-500"
                  }`}
                >
                  {pulled ? (veryStale ? `⚠ ${fmtPull(pulled)}` : fmtPull(pulled)) : "—"}
                </div>
              </button>
            );
          })}
        </div>
        )}
        <div className="mt-1.5 text-[9px] text-slate-400">
          Last OI pull (IST) · green = warm cache
        </div>

        {current && (
          <div className="mt-3 flex items-center justify-between font-mono-data">
            <span className="text-sm font-semibold">
              {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              ATM {current.atm}
              {price >= current.atm ? (
                <TrendingUp className="w-3 h-3 text-emerald-600" />
              ) : (
                <TrendingDown className="w-3 h-3 text-rose-600" />
              )}
            </span>
          </div>
        )}
      </div>

      {/* Expiry list — with W (Weekly) / M (Monthly) tags; height drag-resizable */}
      <div className="p-4 border-b border-slate-200">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Expiries Included</Label>
        <div
          className="mt-2 space-y-1 pr-1 overflow-y-auto sidebar-expiries"
          style={{ height: `${expiryListHeight}px`, maxHeight: `${EXPIRY_LIST_MAX_PX}px`, minHeight: `${EXPIRY_LIST_MIN_PX}px` }}
          data-testid="expiries-list"
          ref={expiryListRef}
        >
          {orderedExpiries.map((exp, i) => {
            const active = selectedExpiry ? selectedExpiry === exp.date : i === 0;
            const dte = exp.days_to_expiry;
            let weekday = null;
            try {
              if (exp.date) {
                const [y, m, d] = String(exp.date).split("-").map(Number);
                if (y && m && d) {
                  weekday = new Date(Date.UTC(y, m - 1, d, 6, 30)).toLocaleDateString("en-GB", {
                    weekday: "short",
                    timeZone: "UTC",
                  });
                }
              }
            } catch (_) {
              weekday = null;
            }
            const daysLabel =
              dte == null
                ? null
                : dte === 0
                  ? "0d"
                  : `${dte}d`;
            const metaLabel = [weekday, daysLabel].filter(Boolean).join(" · ");
            return (
              <button
                key={exp.date + i}
                data-testid={`expiry-${exp.date}`}
                data-expiry-date={exp.date}
                data-expiry-active={active ? "1" : "0"}
                onClick={() => onChangeExpiry?.(exp.date)}
                className={`w-full expiry-row flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
                  active
                    ? "bg-gradient-to-r from-indigo-600 to-sky-600 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                title={
                  metaLabel
                    ? `${exp.label || exp.date} · ${metaLabel}${exp.tag === "M" ? " · monthly" : " · weekly"}`
                    : exp.label || exp.date
                }
              >
                <span className={`w-3 h-3 rounded-sm border ${active ? "bg-white border-white" : "border-slate-400"}`} />
                <span className="text-sm font-mono-data flex-1 min-w-0">
                  <span className="truncate">{exp.label || exp.date}</span>
                  {metaLabel && (
                    <span className={`ml-1.5 text-[11px] ${active ? "text-white/85" : "text-slate-500"}`}>
                      {metaLabel}
                    </span>
                  )}
                </span>
                <ExpiryBadge tag={exp.tag || "W"} />
              </button>
            );
          })}
          {(!orderedExpiries || orderedExpiries.length === 0) && (
            <p className="text-[11px] text-slate-400 italic pl-1">Loading expiries…</p>
          )}
        </div>
        <button
          type="button"
          data-testid="expiries-resize-handle"
          aria-label="Resize expiries list"
          title="Drag to resize · min 1 expiry"
          onPointerDown={onExpiryResizePointerDown}
          className="mt-1.5 flex h-3 w-full cursor-row-resize items-center justify-center rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <span className="block h-0.5 w-8 rounded-full bg-current opacity-70" />
        </button>
        {expiriesNote && (
          <p
            data-testid="expiries-note"
            className="mt-2 text-[10px] leading-snug text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5"
          >
            <b>Note:</b> {expiriesNote}
          </p>
        )}
      </div>

      {/* Strike range with stepper (index-aware step: NIFTY 50, SENSEX/BANK 100).
          Hidden by default via Admin Settings → show_strike_range. */}
      {showStrikeRange && (
      <div className="p-4 border-b border-slate-200" data-testid="strike-range-section">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-widest text-slate-500">Strike Range</Label>
          <button
            type="button"
            data-testid="btn-reset-range"
            onClick={onReset}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Min</div>
            <StepperInput
              testId="input-strike-min"
              value={strikeRange.min}
              step={step}
              max={(Number(strikeRange.max) || Infinity) - step}
              onChange={(v) => {
                const min = v === "" ? "" : Number(v);
                const max = strikeRange.max;
                if (min !== "" && max != null && Number(min) > Number(max)) {
                  onChangeStrikeRange({ min, max: min });
                } else {
                  onChangeStrikeRange({ ...strikeRange, min });
                }
              }}
            />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Max</div>
            <StepperInput
              testId="input-strike-max"
              value={strikeRange.max}
              step={step}
              min={(Number(strikeRange.min) || 0) + step}
              onChange={(v) => {
                const max = v === "" ? "" : Number(v);
                const min = strikeRange.min;
                if (max !== "" && min != null && Number(max) < Number(min)) {
                  onChangeStrikeRange({ min: max, max });
                } else {
                  onChangeStrikeRange({ ...strikeRange, max });
                }
              }}
            />
          </div>
        </div>
        <div className="mt-2 text-[10px] text-slate-400 font-mono-data">
          Step: {step} pts ({activeIndex}) · chart follows this window
        </div>
      </div>
      )}

      {/* Strikes around ATM */}
      <div className="p-4">
        <StrikeAroundChips strikesAround={strikesAround} onChange={onChangeStrikesAround} />
      </div>

      {/* Big IST clock tile */}
      <div className="border-t border-slate-200 bg-white">
        <BigClock />
      </div>
      {/* Admin note section below the big clock */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
          <Label className="text-[10px] uppercase tracking-widest text-slate-500">Note</Label>
          {isAdmin && !!note && !isEditing && !loadingNote && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Edit"
                data-testid="note-edit"
                className="px-2 py-0.5 text-xs rounded bg-white border border-slate-200 hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={eraseNote}
                title="Erase"
                data-testid="note-erase"
                className="px-2 py-0.5 text-xs rounded bg-white border border-slate-200 hover:bg-slate-50"
              >
                Erase
              </button>
            </div>
          )}
        </div>
        <div className="mt-2">
          {loadingNote ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <>
              {!isAdmin && !note && (
                <p className="text-sm text-slate-500 italic">No note available.</p>
              )}
              {!isAdmin && note && (
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{note}</div>
              )}
              {isAdmin && (
                <div>
                  {isEditing ? (
                    <>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full min-h-[6rem] p-2 border rounded text-sm font-sans"
                        placeholder="Write a short sidebar note. When saved, this becomes a tile visible to all users."
                      />
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <button type="button" onClick={saveNote} className="px-3 py-1 text-sm rounded bg-sky-600 text-white">Save</button>
                        <button type="button" onClick={eraseNote} className="px-3 py-1 text-sm rounded border text-slate-700">Erase</button>
                        <button type="button" onClick={() => { setEditText(note); setIsEditing(false); }} className="px-3 py-1 text-sm rounded border text-slate-700">Cancel</button>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">Saved at: {noteUpdatedAt ? new Date(noteUpdatedAt).toLocaleString() : '—'}</div>
                    </>
                  ) : (
                    <div className="p-3 border rounded bg-gray-50 shadow-sm">
                      <div className="text-sm text-slate-700 whitespace-pre-wrap">{note}</div>
                      <div className="mt-2 text-xs text-slate-500">Saved at: {noteUpdatedAt ? new Date(noteUpdatedAt).toLocaleString() : '—'}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
