import { useEffect, useRef } from "react";
import { isMarketQuiescent } from "@/lib/marketTimes";

// Hook: useQuiescentAwarePolling
// - callback: async or sync function to run
// - ms: interval in ms
// - deps: dependency array for effect
// - options: { status: optionalServerStatus, immediate: true, allowDuringQuiescent: false }
export default function useQuiescentAwarePolling(callback, ms, deps = [], options = {}) {
  const { status = undefined, immediate = true, allowDuringQuiescent = false, dedupeKey = null } = options;
  const mountedRef = useRef(false);

  const runRef = useRef(false);
  const callbackRef = useRef(callback);

  // keep latest callback in a ref so the interval always calls the newest function
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let cancelled = false;
    let id = null;
    let isPrimaryOwner = false;

    // simple global dedupe map on window to avoid duplicate pollers (e.g., React Strict double-mount)
    const ensureDedupeMap = () => {
      if (typeof window === "undefined") return null;
      if (!window.__oi_quiescent_pollers) window.__oi_quiescent_pollers = {};
      return window.__oi_quiescent_pollers;
    };

    const map = ensureDedupeMap();
    if (dedupeKey && map) {
      map[dedupeKey] = (map[dedupeKey] || 0) + 1;
      isPrimaryOwner = map[dedupeKey] === 1;
    }

    // assign a small instance id for logging/debugging
    let instanceId = null;
    if (typeof window !== "undefined") {
      if (!window.__oi_quiescent_next_id) window.__oi_quiescent_next_id = 1;
      instanceId = window.__oi_quiescent_next_id++;
    }

    const run = async () => {
      if (runRef.current) return; // prevent re-entrancy
      runRef.current = true;
      try {
        if (process.env.NODE_ENV !== 'production') {
          try { console.debug(`[useQuiescentAwarePolling#${instanceId}] run() invoked dedupeKey=${String(dedupeKey)} isPrimaryOwner=${isPrimaryOwner}`); } catch (_) {}
        }
        // call the latest callback
        await callbackRef.current();
      } catch (e) {
        // swallow errors here; callers may handle
      } finally {
        runRef.current = false;
      }
    };

    // helper cleanup that always decrements dedupe map before exit
    const makeCleanup = (localId) => () => {
      cancelled = true;
      if (localId) clearInterval(localId);
      if (dedupeKey && map) {
        map[dedupeKey] = Math.max(0, (map[dedupeKey] || 1) - 1);
        if (map[dedupeKey] === 0) delete map[dedupeKey];
      }
      if (process.env.NODE_ENV !== 'production') {
        try { console.debug(`[useQuiescentAwarePolling#${instanceId}] cleanup called, cleared id=${localId} dedupeKey=${String(dedupeKey)}`); } catch (_) {}
      }
    };

    try {
      const closed = isMarketQuiescent(status);

      if (!mountedRef.current && immediate) {
        // Only the primary owner should perform the immediate run to avoid duplicates
        if (!dedupeKey || isPrimaryOwner) {
          if (process.env.NODE_ENV !== 'production') {
            try { console.debug(`[useQuiescentAwarePolling#${instanceId}] immediate run (primary=${isPrimaryOwner})`); } catch (_) {}
          }
          run();
          mountedRef.current = true;
        } else {
          if (process.env.NODE_ENV !== 'production') {
            try { console.debug(`[useQuiescentAwarePolling#${instanceId}] skipping immediate run (not primary)`); } catch (_) {}
          }
        }
      }

      if (closed && !allowDuringQuiescent) {
        // If quiescent and not explicitly allowed, do one immediate run (if primary) and skip recurring interval
        if (process.env.NODE_ENV !== 'production') {
          try { console.debug(`[useQuiescentAwarePolling#${instanceId}] market closed and not allowed during quiescent; skipping interval`); } catch (_) {}
        }
        return makeCleanup(null);
      }
    } catch (e) {
      // On error evaluating quiescent state, fall back to normal polling
      if (!mountedRef.current && immediate) {
        if (!dedupeKey || isPrimaryOwner) { run(); mountedRef.current = true; }
      }
      if (!dedupeKey || !map || isPrimaryOwner) {
        id = setInterval(() => { if (!cancelled) run(); }, ms);
        if (process.env.NODE_ENV !== 'production') {
          try { console.debug(`[useQuiescentAwarePolling#${instanceId}] created interval id=${id} (error path)`); } catch (_) {}
        }
      }
      return makeCleanup(id);
    }

    if (!dedupeKey || !map || isPrimaryOwner) {
      id = setInterval(() => { if (!cancelled) run(); }, ms);
      if (process.env.NODE_ENV !== 'production') {
        try { console.debug(`[useQuiescentAwarePolling#${instanceId}] created interval id=${id}`); } catch (_) {}
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        try { console.debug(`[useQuiescentAwarePolling#${instanceId}] not creating interval (not primary)`); } catch (_) {}
      }
    }

    return makeCleanup(id);
    // Depend on market-open flag only — full `status` object identity changes
    // every status poll and was recreating intervals unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, status?.market?.is_market_open, immediate, allowDuringQuiescent, dedupeKey]);
}
