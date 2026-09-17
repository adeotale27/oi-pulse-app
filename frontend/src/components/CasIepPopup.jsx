import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, Maximize2, Minimize2, X } from "lucide-react";
import { clampCarryLeft, clampDockBottom, deskHeaderClearance, snapCarryLeft } from "@/lib/carryDock";
import { CAS_IEP_POPUP_INDICES, indicativeChangePct } from "@/lib/casIepPopup";

const PANEL_W = 300;
const LEFT_KEY = "oiCasIepPopupLeftPx";
const BOTTOM_KEY = "oiCasIepPopupBottomPx";
const MIN_KEY = "oiCasIepPopupMin";

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function dockClearance() {
  if (typeof window === "undefined") return 12;
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  const safe = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)")) || 0;
  return mobile ? 52 + (Number.isFinite(safe) ? safe : 0) : 12;
}

function readNum(key) {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n >= 8 && n <= 4000) return n;
  } catch { /* noop */ }
  return null;
}

function writeNum(key, n) {
  try { localStorage.setItem(key, String(Math.round(n))); } catch { /* noop */ }
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPx(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Docked NIFTY 50 + SENSEX indicative prices during the CAS IEP window. */
export default function CasIepPopup({ enabled, quotes = {}, endLabel = "15:30" }) {
  const [minimized, setMinimized] = useState(() => {
    try { return localStorage.getItem(MIN_KEY) === "1"; } catch { return false; }
  });
  const [leftPx, setLeftPx] = useState(() => readNum(LEFT_KEY));
  const [bottomPx, setBottomPx] = useState(() => readNum(BOTTOM_KEY));
  const dragRef = useRef(null);
  const boxRef = useRef(null);
  const skipClickRef = useRef(false);

  const setLeft = (px) => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const next = clampCarryLeft(px, w, isPhone() ? 280 : PANEL_W);
    setLeftPx(next);
    writeNum(LEFT_KEY, next);
  };

  const clampBottom = useCallback((raw) => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const h = boxRef.current?.offsetHeight || (minimized ? 48 : 180);
    return clampDockBottom(raw, vh, {
      minBottom: dockClearance(),
      headerClearance: deskHeaderClearance(),
      panelHeight: h,
    });
  }, [minimized]);

  useLayoutEffect(() => {
    const apply = () => {
      setBottomPx((prev) => {
        const next = clampBottom(prev != null ? prev : dockClearance());
        if (next !== prev) writeNum(BOTTOM_KEY, next);
        return next;
      });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [clampBottom]);

  useEffect(() => {
    if (leftPx != null) return;
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    setLeft(snapCarryLeft("center", w, PANEL_W));
  }, [leftPx]);

  useEffect(() => {
    if (enabled) return;
    setMinimized(false);
    try { localStorage.removeItem(MIN_KEY); } catch { /* noop */ }
  }, [enabled]);

  const minimize = () => {
    setMinimized(true);
    try { localStorage.setItem(MIN_KEY, "1"); } catch { /* noop */ }
  };
  const expand = () => {
    setMinimized(false);
    try { localStorage.removeItem(MIN_KEY); } catch { /* noop */ }
  };

  const onPointerDown = (e, kind) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startBottom = bottomPx != null ? bottomPx : dockClearance();
    const startLeft = leftPx != null ? leftPx : 12;
    dragRef.current = { kind, startY: e.clientY, startX: e.clientX, startBottom, startLeft, moved: false };
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    if (Math.abs(e.clientY - dragRef.current.startY) > 6 || Math.abs(e.clientX - dragRef.current.startX) > 6) {
      dragRef.current.moved = true;
    }
    const kind = dragRef.current.kind;
    if (kind === "move" || kind === "both") {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const panel = minimized || isPhone() ? 88 : PANEL_W;
      setLeftPx(clampCarryLeft(dragRef.current.startLeft + (e.clientX - dragRef.current.startX), w, panel));
    }
    if (!minimized && isPhone() && dragRef.current.kind !== "both") return;
    const dy = dragRef.current.startY - e.clientY;
    setBottomPx(clampBottom(dragRef.current.startBottom + dy));
  };

  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    skipClickRef.current = !!dragRef.current.moved;
    const kind = dragRef.current.kind;
    const moved = dragRef.current.moved;
    const shouldExpand = minimized && !moved;
    if (kind === "move" || kind === "both") {
      if (moved && leftPx != null) writeNum(LEFT_KEY, leftPx);
    }
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    setBottomPx((prev) => {
      const next = clampBottom(prev != null ? prev : dockClearance());
      writeNum(BOTTOM_KEY, next);
      return next;
    });
    if (shouldExpand) expand();
  };

  if (!enabled) return null;

  const phoneOpen = typeof window !== "undefined" && isPhone();
  const posStyle = (() => {
    const bottom = phoneOpen && !minimized
      ? `${dockClearance()}px`
      : (bottomPx != null ? `${bottomPx}px` : undefined);
    if (phoneOpen && !minimized) return { bottom };
    const left = leftPx != null ? `${leftPx}px` : undefined;
    return { bottom, left, right: left ? "auto" : undefined };
  })();

  if (minimized) {
    return (
      <button
        type="button"
        data-testid="cas-iep-popup-chip"
        ref={boxRef}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          expand();
        }}
        className={`fixed z-[72] md:bottom-3 flex items-center rounded-full border-2 border-emerald-400 bg-emerald-50 text-emerald-950 shadow-lg text-xs font-semibold touch-none gap-1.5 px-3 py-2 whitespace-nowrap ${
          bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""
        }`}
        style={posStyle}
        onPointerDown={(e) => onPointerDown(e, "both")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Open indicative prices · drag to move"
        aria-label="Indicative price"
      >
        Indicative price
        <Maximize2 className="w-3.5 h-3.5 opacity-70" />
      </button>
    );
  }

  return (
    <div
      className={`fixed z-[72] md:bottom-3 flex flex-col rounded-xl border-2 border-emerald-400 bg-emerald-50 text-emerald-950 shadow-lg pointer-events-auto ${
        phoneOpen ? "left-3 right-3" : ""
      } ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
      style={{
        ...posStyle,
        ...(phoneOpen
          ? {}
          : {
              width: `min(${PANEL_W}px, calc(100vw - 16px))`,
              maxHeight: "min(18rem, calc(100vh - 20px))",
            }),
      }}
      data-testid="cas-iep-popup"
      ref={boxRef}
      role="dialog"
      aria-label="Indicative price"
    >
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-emerald-200">
        <button
          type="button"
          className="hidden md:inline-flex p-1 opacity-70 touch-none"
          aria-label="Drag indicative price"
          onPointerDown={(e) => onPointerDown(e, "move")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <GripHorizontal className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wide">Indicative price</div>
          <div className="text-[10px] text-emerald-800/80">Until {endLabel} IST</div>
        </div>
        <button type="button" className="p-1 min-h-11 min-w-11 inline-flex items-center justify-center" onClick={minimize} data-testid="cas-iep-popup-min" aria-label="Minimize">
          <Minimize2 className="w-4 h-4" />
        </button>
        <button type="button" className="p-1 min-h-11 min-w-11 inline-flex items-center justify-center" onClick={minimize} data-testid="cas-iep-popup-close" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 py-2 space-y-2">
        {CAS_IEP_POPUP_INDICES.map(({ index, label }) => {
          const q = quotes[index] || {};
          const px = q.indicative_close_price;
          return (
            <div key={index} className="flex items-baseline justify-between gap-3" data-testid={`cas-iep-row-${index}`}>
              <span className="text-xs font-semibold">{label}</span>
              <span className="text-right">
                <span className="font-mono-data text-base font-bold tabular-nums">{fmtPx(px)}</span>
                {fmtPct(indicativeChangePct(q)) ? (
                  <span className={`ml-1.5 text-[11px] font-semibold ${Number(indicativeChangePct(q)) > 0 ? "text-emerald-700" : Number(indicativeChangePct(q)) < 0 ? "text-rose-700" : "text-emerald-800/70"}`}>
                    {fmtPct(indicativeChangePct(q))}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
