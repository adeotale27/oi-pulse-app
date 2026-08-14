import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * Position a fixed portaled menu under an anchor, keep it on-screen, and
 * close on outside click / Escape / scroll / resize.
 *
 * Used by info-tile dropdowns so parent `overflow-x-auto` chrome cannot clip
 * them (CSS turns overflow-y:visible into auto when x is not visible).
 */
export default function usePortaledMenu({
  open,
  onClose,
  anchorRef,
  panelRef,
  width = 288,
  align = "right",
  offset = 4,
  /** Ignore outside taps this long after open (iOS synthetic mouse closes instantly). */
  guardMs = 400,
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const place = useCallback(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = align === "left" ? r.left : r.right - width;
    left = Math.min(
      Math.max(8, left),
      Math.max(8, window.innerWidth - width - 8),
    );
    const top = Math.round(r.bottom + offset);
    setPos({ top, left: Math.round(left) });
  }, [anchorRef, align, width, offset]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onReposition = () => place();
    window.addEventListener("resize", onReposition);
    // Capture scroll on any ancestor so the menu tracks the tile.
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || typeof onClose !== "function") return undefined;
    const openedAt = Date.now();
    const onDoc = (e) => {
      if (Date.now() - openedAt < guardMs) return;
      const t = e.target;
      if (anchorRef?.current?.contains(t)) return;
      if (panelRef?.current?.contains(t)) return;
      onClose(e);
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose(e);
    };
    // pointerdown only — mousedown+touchstart together close the menu on the
    // same iOS tap that opened it.
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, panelRef, guardMs]);

  return { pos, place };
}
