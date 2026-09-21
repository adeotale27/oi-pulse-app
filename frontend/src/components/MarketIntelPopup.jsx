import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, GripHorizontal, Maximize2, Minimize2, Newspaper, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  bandClass,
  formatEventTypeLabel,
  impactScoreLabel,
  indiaImpactLabel,
  miMinimizeActive,
  MI_POPUP_BOTTOM_KEY,
  MI_POPUP_LEFT_KEY,
  MI_POPUP_MIN_KEY,
  MI_RELOAD_EVENT,
} from "@/lib/marketIntel";
import { clampCarryLeft, clampDockBottom, deskHeaderClearance, snapCarryLeft } from "@/lib/carryDock";
import { nextSessionOpenMs } from "@/lib/overnightBrief";
import { useFloatingDockFocus } from "@/lib/floatingDock";

const PANEL_W = 320;

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

function readMinimized() {
  try {
    const raw = localStorage.getItem(MI_POPUP_MIN_KEY);
    if (!raw) return false;
    const until = Number(JSON.parse(raw)?.until);
    if (!miMinimizeActive(Date.now(), until)) {
      localStorage.removeItem(MI_POPUP_MIN_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeMinimized(untilMs) {
  try {
    localStorage.setItem(MI_POPUP_MIN_KEY, JSON.stringify({ until: untilMs }));
  } catch { /* noop */ }
}

function clearMinimized() {
  try { localStorage.removeItem(MI_POPUP_MIN_KEY); } catch { /* noop */ }
}

/** In-app Market Intel sheet — same dock/minimize pattern as the overnight carry brief. */
export default function MarketIntelPopup({ enabled, onOpenPage }) {
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [minimized, setMinimized] = useState(() => readMinimized());
  const [forceOpen, setForceOpen] = useState(false);
  const [dockUntilNext, setDockUntilNext] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [leftPx, setLeftPx] = useState(() => readNum(MI_POPUP_LEFT_KEY));
  const [bottomPx, setBottomPx] = useState(() => readNum(MI_POPUP_BOTTOM_KEY));
  const idxRef = useRef(0);
  const dragRef = useRef(null);
  const boxRef = useRef(null);
  const skipClickRef = useRef(false);
  const { bringToFront, zIndexClass } = useFloatingDockFocus("market-intel", enabled);
  idxRef.current = idx;

  const setLeft = (px) => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const next = clampCarryLeft(px, w, isPhone() ? 280 : PANEL_W);
    setLeftPx(next);
    writeNum(MI_POPUP_LEFT_KEY, next);
  };

  const clampBottom = useCallback((raw) => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const h = boxRef.current?.offsetHeight || (minimized ? 48 : 280);
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
        if (next !== prev) writeNum(MI_POPUP_BOTTOM_KEY, next);
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
    setLeft(snapCarryLeft("right", w, PANEL_W));
  }, [leftPx]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      if (!readMinimized()) setMinimized(false);
    }, 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setIdx(0);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const poll = () => {
      api.get("/market-intel/popup", { timeout: 15000 })
        .then((r) => {
          if (cancelled) return;
          setLoadError(null);
          const next = r.data?.items || [];
          setDockUntilNext(r.data?.dock_until_next !== false);
          setItems((prev) => {
            const curId = prev[idxRef.current]?.event_cluster_id;
            const found = next.findIndex((x) => x.event_cluster_id === curId);
            setIdx(found >= 0 ? found : 0);
            return next;
          });
        })
        .catch((e) => {
          if (cancelled) return;
          setLoadError(e?.message || "popup failed");
        });
    };
    timer = setTimeout(() => {
      poll();
      timer = setInterval(poll, 180000);
    }, 2000);
    const onReload = () => poll();
    window.addEventListener(MI_RELOAD_EVENT, onReload);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(timer);
      window.removeEventListener(MI_RELOAD_EVENT, onReload);
    };
  }, [enabled]);

  const minimizeUntilNext = () => {
    writeMinimized(nextSessionOpenMs(new Date()));
    setMinimized(true);
  };

  const hideCompletely = () => {
    clearMinimized();
    setMinimized(false);
    setItems([]);
  };

  const closeOrDock = () => {
    if (dockUntilNext) minimizeUntilNext();
    else hideCompletely();
  };

  const expand = () => {
    bringToFront();
    clearMinimized();
    setMinimized(false);
    setForceOpen(true);
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    const width = isPhone() ? 280 : PANEL_W;
    setLeft(snapCarryLeft("right", w, width));
    const nextBottom = clampDockBottom(dockClearance(), h, {
      minBottom: dockClearance(),
      headerClearance: deskHeaderClearance(),
      panelHeight: isPhone() ? 320 : 280,
    });
    setBottomPx(nextBottom);
    writeNum(MI_POPUP_BOTTOM_KEY, nextBottom);
  };

  const onPointerDown = (e, kind) => {
    bringToFront();
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
    const startY = dragRef.current.startY;
    const shouldExpand = minimized && !moved;
    if (kind === "move" || kind === "both") {
      if (moved && leftPx != null) writeNum(MI_POPUP_LEFT_KEY, leftPx);
    }
    if (!minimized && isPhone() && kind !== "both") {
      const swipeDown = e.clientY - startY;
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      if (swipeDown > 36) closeOrDock();
      return;
    }
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    setBottomPx((prev) => {
      const next = clampBottom(prev != null ? prev : dockClearance());
      writeNum(MI_POPUP_BOTTOM_KEY, next);
      return next;
    });
    if (shouldExpand) expand();
  };

  if (!enabled) return null;

  const n = items.length;
  const item = n ? items[Math.min(idx, n - 1)] : null;
  const phoneOpen = typeof window !== "undefined" && isPhone();
  const posStyle = (() => {
    const bottom = phoneOpen && !minimized
      ? `${dockClearance()}px`
      : (bottomPx != null ? `${bottomPx}px` : undefined);
    if (phoneOpen && !minimized) return { bottom };
    const left = leftPx != null ? `${leftPx}px` : undefined;
    return { bottom, left, right: left ? "auto" : 12 };
  })();

  if (!item && !minimized && !forceOpen && !loadError) return null;

  const step = (dir) => {
    if (n < 2) return;
    setIdx((i) => (i + dir + n) % n);
  };

  const dismissCurrent = () => {
    if (!item) return;
    const cid = item.event_cluster_id;
    const next = items.filter((x) => x.event_cluster_id !== cid);
    setItems(next);
    setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
    if (cid) api.post("/market-intel/popup/ack", { event_cluster_id: cid }).catch(() => {});
    if (next.length === 0) closeOrDock();
  };

  if (minimized) {
    return (
      <button
        type="button"
        data-testid="market-intel-popup-chip"
        ref={boxRef}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          expand();
        }}
        className={`fixed ${zIndexClass} md:bottom-3 right-3 flex items-center rounded-full border-2 border-rose-400 bg-rose-50 text-rose-950 shadow-lg text-xs font-semibold touch-none gap-1.5 px-3 py-2 whitespace-nowrap ${
          bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""
        }`}
        style={posStyle}
        onPointerDown={(e) => onPointerDown(e, "both")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Open market news · drag to move"
        aria-label="Mkt Intel"
      >
        <Newspaper className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">Mkt Intel</span>
        {n > 0 ? (
          <span
            data-testid="mi-unseen-badge"
            className="inline-flex min-w-[1.1rem] h-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white"
          >
            {n > 99 ? "99+" : n}
          </span>
        ) : null}
        {loadError ? <span className="text-rose-700 font-bold" title={loadError}>!</span> : null}
        <Maximize2 className="w-3.5 h-3.5 opacity-70" />
      </button>
    );
  }

  return (
    <div
      className={`fixed ${zIndexClass} md:bottom-3 flex flex-col rounded-xl border-2 border-rose-400 bg-rose-50 text-rose-950 shadow-lg pointer-events-auto h-[min(22rem,52vh)] ${
        phoneOpen ? "left-3 right-3" : ""
      } ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
      style={{
        ...posStyle,
        ...(phoneOpen
          ? {}
          : {
              width: `min(${PANEL_W}px, calc(100vw - 16px))`,
            }),
      }}
      data-testid="market-intel-popup"
      ref={boxRef}
      role="dialog"
      aria-label="Market Intelligence"
    >
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-rose-200">
        <button
          type="button"
          className="md:hidden p-1 opacity-70 touch-none min-h-11 min-w-11 inline-flex items-center justify-center"
          aria-label="Swipe down to minimize market news"
          data-testid="mi-popup-drag"
          onPointerDown={(e) => onPointerDown(e, "mobile")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <GripHorizontal className="w-4 h-4" />
        </button>
        <div
          className="hidden md:flex items-center gap-1.5 min-w-0 flex-1 cursor-grab active:cursor-grabbing touch-none"
          data-testid="mi-popup-dock-drag"
          onPointerDown={(e) => onPointerDown(e, "move")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title="Drag to move"
        >
          <Newspaper className="w-4 h-4 shrink-0 opacity-80" />
          <div className="min-w-0 text-sm font-semibold leading-tight">Mkt Intel</div>
        </div>
        <div className="md:hidden min-w-0 flex-1 text-sm font-semibold leading-tight">Mkt Intel</div>
        <div className="ml-auto flex items-center shrink-0" data-testid="mi-popup-pager">
          <span className="text-[10px] text-rose-800/80 mr-0.5 font-mono-data whitespace-nowrap">
            {n ? `${Math.min(idx, Math.max(n, 1) - 1) + 1} / ${n}` : "0 / 0"}
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-10 items-center justify-center rounded-md hover:bg-white/60 touch-manipulation disabled:opacity-30"
            aria-label="Previous news"
            data-testid="mi-popup-prev"
            disabled={n < 2}
            onClick={() => step(-1)}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-10 items-center justify-center rounded-md hover:bg-white/60 touch-manipulation disabled:opacity-30"
            aria-label="Next news"
            data-testid="mi-popup-next"
            disabled={n < 2}
            onClick={() => step(1)}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={closeOrDock}
          className="opacity-80 hover:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded"
          aria-label="Minimize market news until next session"
          title="Minimize until next market open"
          data-testid="mi-popup-minimize"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={closeOrDock}
          className="opacity-80 hover:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded"
          aria-label="Close market news until next session"
          data-testid="mi-popup-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-2.5 pb-2.5 pt-1.5 space-y-1.5 text-xs overflow-y-auto min-h-0 flex-1">
        {loadError ? (
          <p className="text-[11px] text-rose-800" data-testid="mi-popup-error">Could not load news: {loadError}</p>
        ) : item ? (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${bandClass(item.impact_band)}`}>{item.impact_band || "HIGH"}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${bandClass(item.impact_band)}`}>{impactScoreLabel(item.impact_score)}</span>
              {item.event_type ? (
                <span className="text-[10px] font-bold uppercase tracking-wide">{formatEventTypeLabel(item.event_type)}</span>
              ) : null}
              <span className="text-[10px] font-semibold text-rose-900">{n} critical today</span>
            </div>
            <div className="text-sm font-semibold leading-snug">{item.title}</div>
            <div className="text-[11px] opacity-90">{indiaImpactLabel(item.india_relevance_score)}</div>
            {Array.isArray(item.potential) && (
              <ul className="text-[11px] list-disc pl-4">
                {item.potential.slice(0, 4).map((p, i) => <li key={`p-${i}`}>{p}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 items-center pt-1">
              <button type="button" className="text-[11px] font-semibold min-h-11" onClick={() => onOpenPage?.()}>View Market Intelligence</button>
              <button type="button" className="text-[11px] opacity-70 ml-auto min-h-11" onClick={dismissCurrent}>This story done</button>
            </div>
          </>
        ) : (
          <p className="text-[11px] opacity-80">No high-impact stories right now.</p>
        )}
      </div>
    </div>
  );
}
