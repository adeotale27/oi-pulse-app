import { useCallback, useEffect, useState } from "react";

// Floating desk cards must behave like windows: the one the trader touches is
// above the rest, irrespective of their render order or the type of card.
export const FLOATING_DOCK_FOCUS_EVENT = "oi-floating-dock-focus";

let focusedDockId = null;

export function focusFloatingDock(id) {
  focusedDockId = id;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FLOATING_DOCK_FOCUS_EVENT, { detail: { id } }));
  }
}

export function useFloatingDockFocus(id, enabled = true) {
  const [focused, setFocused] = useState(() => focusedDockId === id);

  useEffect(() => {
    const onFocus = (event) => setFocused(event.detail?.id === id);
    window.addEventListener(FLOATING_DOCK_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FLOATING_DOCK_FOCUS_EVENT, onFocus);
  }, [id]);

  useEffect(() => {
    if (!enabled && focusedDockId === id) focusedDockId = null;
  }, [enabled, id]);

  const bringToFront = useCallback(() => focusFloatingDock(id), [id]);
  return { bringToFront, zIndexClass: focused ? "z-[75]" : "z-[60]" };
}
