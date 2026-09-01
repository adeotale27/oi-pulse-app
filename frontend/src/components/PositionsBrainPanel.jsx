import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Brain, X } from "lucide-react";
import InfoTip, { eventFromInfoTip } from "@/components/InfoTip";
import { computeBookVerdict } from "@/lib/positionsSellerInsights";
import {
  BRAIN_SECTION_ORDER_KEY,
  DEFAULT_BRAIN_ORDER,
  computePositionsBrain,
  normalizeBrainOrder,
} from "@/lib/positionsBrain";

function loadBrainOrder() {
  try {
    const raw = localStorage.getItem(BRAIN_SECTION_ORDER_KEY);
    if (!raw) return DEFAULT_BRAIN_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_BRAIN_ORDER;
    return normalizeBrainOrder(parsed);
  } catch {
    return DEFAULT_BRAIN_ORDER;
  }
}

function saveBrainOrder(order) {
  try {
    localStorage.setItem(BRAIN_SECTION_ORDER_KEY, JSON.stringify(order));
  } catch { /* noop */ }
}

function fmt(v, dp = 1) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function BrainSectionHeader({ title, tip, tone = "slate", testId }) {
  const toneClass = tone === "violet"
    ? "text-violet-700"
    : tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-slate-600";
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${toneClass}`}>{title}</div>
      {tip ? (
        <InfoTip title={title} size="xs" testId={testId}>
          {tip}
        </InfoTip>
      ) : null}
    </div>
  );
}

export default function PositionsBrainPanel({ open, onClose, rows = [], stats = {}, vix = null }) {
  const brain = computePositionsBrain({ rows, stats, vix });
  const seller = computeBookVerdict({
    netDelta: brain.netDelta,
    netTheta: brain.netTheta,
    shortCount: brain.shortCount,
    adjustCount: Number(stats.adjustCount) || 0,
    premiumLeft: stats.premiumLeft,
    itmShortCount: brain.itmCount,
    pnl: stats.netPnl,
  });
  const [brainOrder, setBrainOrder] = useState(() => loadBrainOrder());
  const [brainDraggingId, setBrainDraggingId] = useState(null);
  const [brainOverId, setBrainOverId] = useState(null);

  const reorderBrainSections = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setBrainOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(fromId);
      const toIndex = next.indexOf(toId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromId);
      const normalized = normalizeBrainOrder(next);
      saveBrainOrder(normalized);
      return normalized;
    });
  };

  const urgencyCls = brain.urgency === "HIGH"
    ? "bg-rose-100 text-rose-700"
    : brain.urgency === "MEDIUM"
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";

  const renderBrainSection = (id) => {
    switch (id) {
      case "verdict":
        return (
          <div className={`rounded-2xl border p-3 ${
            brain.mode === "CAPITAL"
              ? "border-rose-300 bg-gradient-to-br from-rose-50 via-white to-slate-50"
              : "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-slate-50"
          }`} data-testid="brain-section-verdict">
            <BrainSectionHeader
              title="Decision"
              tone="violet"
              testId="brain-tip-verdict"
              tip="One call from the live short book: what to do, which leg is the problem, and how much of the greeks we could actually price. This is not a buy/sell signal and it does not guess the index."
            />
            <div className="flex items-start justify-between gap-2">
              <div className="text-[15px] font-bold text-slate-900 leading-snug">{brain.label}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${urgencyCls}`}>
                {brain.urgency}
              </span>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-slate-900">{brain.action}</div>
            <div className="mt-1 text-[11px] text-slate-600 leading-relaxed">{brain.summary}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-violet-200 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                  <span>Heat</span>
                  <InfoTip title="Portfolio heat" size="xs" testId="brain-tip-heat-score">
                    0–100 from too-close shorts, net delta, ITM legs, near-expiry gamma, concentration, and negative theta. Positive theta does not add heat.
                  </InfoTip>
                </div>
                <div className="mt-0.5 font-mono-data text-sm font-bold text-violet-900">{brain.heat}</div>
              </div>
              <div className="rounded-md border border-violet-200 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                  <span>Health</span>
                  <InfoTip title="Book health" size="xs" testId="brain-tip-health">
                    Inverse of heat, with a small bonus when the book is nearly delta-flat and time is paying you.
                  </InfoTip>
                </div>
                <div className="mt-0.5 font-mono-data text-sm font-bold text-violet-900">{brain.health}</div>
              </div>
              <div className="rounded-md border border-violet-200 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                  <span>Trust</span>
                  <InfoTip title="Confidence" size="xs" testId="brain-tip-confidence">
                    Falls when greeks are missing (no spot / no IV) or the book is already in the high-heat band. Not a win-rate.
                  </InfoTip>
                </div>
                <div className="mt-0.5 font-mono-data text-sm font-bold text-violet-900">{brain.confidence}%</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
            Seller verdict:{" "}
            <span className="font-semibold text-slate-900">
              {brain.mode === "CAPITAL" ? "Capital stop — ignore add-from-book-score" : seller.headline}
            </span>
              <span className="text-slate-400"> · data {brain.dataQuality}%</span>
            </div>
          </div>
        );
      case "heat":
        return (
          <div className="rounded-xl border border-slate-200 p-3" data-testid="brain-section-heat">
            <BrainSectionHeader
              title="Why this heat"
              testId="brain-tip-contributors"
              tip="Only factors that are actually firing on this book. Empty list means the shorts are still far, delta is quiet, and time is not costing you."
            />
            {brain.contributors.length ? (
              <div className="space-y-2">
                {brain.contributors.map((item) => (
                  <div key={item.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>{item.label}</span>
                      <span className="font-mono-data font-bold text-slate-900">+{item.score}</span>
                    </div>
                    {item.note ? <div className="mt-0.5 text-[10px] text-slate-500">{item.note}</div> : null}
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, item.score * 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-600">No heat drivers. The short book is not crowding the adjust band.</div>
            )}
          </div>
        );
      case "book":
        return (
          <div className="rounded-xl border border-slate-200 p-3" data-testid="brain-section-book">
            <BrainSectionHeader
              title="Book facts"
              testId="brain-tip-book"
              tip="Call share is short-call sensitivity (|Δ|×qty), not a count of rows. Short calls are upside risk; short puts are downside risk. This is book path risk, not the index ticker regime on the header."
            />
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Net Δ</div>
                <div className="font-mono-data font-semibold text-slate-900">{fmt(brain.netDelta, 1)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Daily time ₹</div>
                <div className="font-mono-data font-semibold text-slate-900">{fmt(brain.netTheta, 0)}</div>
              </div>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-[11px]"><span>Short-put risk (downside)</span><span className="font-semibold">{brain.putShare}%</span></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-emerald-600" style={{ width: `${brain.putShare}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[11px]"><span>Short-call risk (upside)</span><span className="font-semibold">{brain.callShare}%</span></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-rose-500" style={{ width: `${brain.callShare}%` }} />
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-700">
              Biggest path risk (from the short book, not index regime): <span className="font-semibold text-slate-900">{brain.threat.label}</span>
              <div className="mt-0.5 text-slate-500">{brain.threat.why}</div>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-slate-700">
              <div>Nearest short put: {brain.nearestPut ? `${brain.nearestPut.strike} · ${brain.nearestPut.distancePct?.toFixed?.(2) ?? "—"}% away` : "—"}</div>
              <div>Nearest short call: {brain.nearestCall ? `${brain.nearestCall.strike} · ${brain.nearestCall.distancePct?.toFixed?.(2) ?? "—"}% away` : "—"}</div>
            </div>
            <div className="mt-2 text-[11px] text-slate-600">{brain.deployment}</div>
          </div>
        );
      case "watch":
        return (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3" data-testid="brain-section-watch">
            <BrainSectionHeader
              title="Watch / do not add"
              tone="rose"
              testId="brain-tip-watch"
              tip="Ranked by too-close, ITM, days-to-expiry, then |Δ|×qty. These are the legs that should not get extra size."
            />
            {brain.watchList.length ? (
              <div className="space-y-2">
                {brain.watchList.map((item) => (
                  <div key={item.symbol} className="rounded-md border border-rose-200 bg-white p-2.5 text-[11px] text-slate-700">
                    <div className="font-semibold text-slate-900">{item.symbol}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {item.itm ? "ITM" : item.breachedAdjust ? "Too close" : "Watch"}
                      {item.distancePct != null ? ` · ${item.distancePct.toFixed(2)}% from strike` : ""}
                      {item.dte != null ? ` · ${Number(item.dte).toFixed(1)}d` : ""}
                    </div>
                    <div className="mt-1">{item.reason}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-600">No sold options to watch.</div>
            )}
            {brain.best ? (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-950">
                Farthest short still working: <span className="font-semibold">{brain.best.symbol}</span>
                {brain.best.distancePct != null ? ` · ${brain.best.distancePct.toFixed(2)}% away` : ""}
              </div>
            ) : null}
          </div>
        );
      case "overnight":
        return (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="brain-section-overnight">
            <BrainSectionHeader
              title="Overnight"
              testId="brain-tip-overnight"
              tip="Uses ITM shorts, ≤1 DTE, India VIX when the poller has it, and net delta. Same idea as the Positions overnight tile, scoped to this short book."
            />
            <div className="text-[12px] font-semibold text-slate-900">{brain.overnightBand}</div>
            <div className="mt-1 text-[11px] text-slate-700 leading-relaxed">{brain.overnightNote}</div>
            {brain.vix != null ? (
              <div className="mt-2 text-[10px] text-slate-500">India VIX {fmt(brain.vix, 1)}</div>
            ) : (
              <div className="mt-2 text-[10px] text-slate-400">India VIX not on this poll yet — overnight ignores it.</div>
            )}
          </div>
        );
      case "plan":
        return (
          <div className="rounded-xl border border-slate-200 p-3" data-testid="brain-section-plan">
            <BrainSectionHeader
              title="If / then"
              testId="brain-tip-plan"
              tip="Triggers are the actual nearest short put and call from your book, not placeholder 24,000 / 24,500 levels."
            />
            <ul className="mt-1 space-y-2 list-disc pl-4 text-[11px] text-slate-700">
              {brain.plan.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (eventFromInfoTip(t)) return;
      if (t.closest("[data-testid='positions-brain-sheet']")) return;
      if (t.closest("[data-testid='btn-brain-positions']")) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <aside
      data-testid="positions-brain-sheet"
      className="fixed z-[80] right-2 top-[4.75rem] bottom-2 w-[min(100vw-1rem,28rem)] rounded-3xl border border-slate-200/90 bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] overflow-hidden flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 tracking-tight">
            <Brain className="w-4 h-4 text-violet-700" />
            <span>Brains</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Short-book risk — not a market call</div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={onClose}
          data-testid="btn-positions-brain-close"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-4 text-[12px] text-slate-700">
        {brainOrder.map((sectionId) => {
          const isActive = brainOverId === sectionId && brainDraggingId && brainDraggingId !== sectionId;
          return (
            <div
              key={sectionId}
              draggable
              onDragStart={(e) => {
                setBrainDraggingId(sectionId);
                try { e.dataTransfer.setData("text/plain", sectionId); e.dataTransfer.effectAllowed = "move"; } catch { /* noop */ }
              }}
              onDragEnd={() => {
                setBrainDraggingId(null);
                setBrainOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (brainOverId !== sectionId) setBrainOverId(sectionId);
              }}
              onDrop={(e) => {
                e.preventDefault();
                let from = brainDraggingId;
                try { from = e.dataTransfer.getData("text/plain") || from; } catch { /* noop */ }
                setBrainDraggingId(null);
                setBrainOverId(null);
                reorderBrainSections(from, sectionId);
              }}
              className={`rounded-xl transition-all ${brainDraggingId === sectionId ? "opacity-60" : ""} ${isActive ? "ring-2 ring-violet-300" : ""}`}
            >
              <div className="mb-1 flex items-center justify-end px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <span className="cursor-grab active:cursor-grabbing text-slate-400" title="Drag to reorder">⋮⋮</span>
              </div>
              {renderBrainSection(sectionId)}
            </div>
          );
        })}
      </div>
    </aside>,
    document.body,
  );
}
