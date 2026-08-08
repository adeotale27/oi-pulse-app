import { useEffect } from "react";

/**
 * Call `onOutside` when a mousedown/touchstart happens outside `ref`.
 * Also closes on Escape.
 */
export default function useClickOutside(ref, onOutside, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof onOutside !== "function") return undefined;

    const handle = (e) => {
      const el = ref?.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      onOutside(e);
    };

    const onKey = (e) => {
      if (e.key === "Escape") onOutside(e);
    };

    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onOutside, enabled]);
}
