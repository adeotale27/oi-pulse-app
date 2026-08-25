import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { Rewind, Play, Pause, Bookmark } from "lucide-react";

/**
 * Timeline scrubber for "Replay Change".
 * Loads /api/history/{index}?minutes=... and lets user scrub through snapshots.
 * When active, calls onReplayFrame(snapshot) on each move.
 * When inactive (paused), returns null via onReplayFrame(null).
 *
 * jumpToTs — ISO timestamp of an OI snapshot to seek after history loads
 * (used by huge-shift session bookmarks).
 */
export default function ReplayScrubber({
  index,
  minutes = 180,
  onReplayFrame,
  jumpToTs = null,
  onJumpConsumed,
}) {
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState(0);
  const [active, setActive] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [bookmarkLabel, setBookmarkLabel] = useState(null);
  const pendingJumpRef = useRef(null);
  // Keep parent callbacks in refs so history fetch does not re-fire on every
  // Dashboard re-render (unstable inline onJumpConsumed caused a pending storm).
  const onReplayFrameRef = useRef(onReplayFrame);
  const onJumpConsumedRef = useRef(onJumpConsumed);
  useEffect(() => { onReplayFrameRef.current = onReplayFrame; }, [onReplayFrame]);
  useEffect(() => { onJumpConsumedRef.current = onJumpConsumed; }, [onJumpConsumed]);
  useEffect(() => () => { onReplayFrameRef.current?.(null); }, []);

  // External jump request — auto-arm replay and remember the target.
  useEffect(() => {
    if (!jumpToTs) return;
    pendingJumpRef.current = jumpToTs;
    setActive(true);
    setPlaying(false);
    try {
      setBookmarkLabel(new Date(jumpToTs).toLocaleTimeString());
    } catch {
      setBookmarkLabel(null);
    }
  }, [jumpToTs]);

  useEffect(() => {
    if (!active) {
      onReplayFrameRef.current?.(null);
      return undefined;
    }
    const controller = new AbortController();
    api.get(`/history/${index}`, { params: { minutes }, signal: controller.signal })
      .then((r) => {
        const hist = r.data.history || [];
        setHistory(hist);
        const target = pendingJumpRef.current;
        if (target && hist.length) {
          const idx = findClosestFrame(hist, target);
          setPos(idx >= 0 ? idx : hist.length - 1);
          pendingJumpRef.current = null;
          onJumpConsumedRef.current?.();
        } else {
          setPos(0);
        }
      })
      .catch((e) => {
        if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || e?.name === "AbortError") return;
        console.error("Replay history load failed", e);
      });
    return () => { controller.abort(); };
  }, [active, index, minutes]);

  // If history already loaded and a new jump arrives, seek without reloading.
  useEffect(() => {
    if (!jumpToTs || !active || !history.length) return;
    const idx = findClosestFrame(history, jumpToTs);
    if (idx >= 0) {
      setPos(idx);
      setPlaying(false);
      pendingJumpRef.current = null;
      onJumpConsumedRef.current?.();
    }
  }, [jumpToTs, active, history]);

  useEffect(() => {
    if (!active || !history.length) return;
    onReplayFrameRef.current?.(history[pos] || null);
  }, [pos, history, active]);

  // auto-play
  useEffect(() => {
    if (!playing || !active || !history.length) return;
    const id = setInterval(() => {
      setPos((p) => (p + 1 >= history.length ? 0 : p + 1));
    }, 400);
    return () => clearInterval(id);
  }, [playing, active, history.length]);

  const label = useMemo(() => {
    if (!history.length || !history[pos]) return "—";
    const frame = history[pos];
    const ts = frame.timestamp || frame.created_at;
    return new Date(ts).toLocaleTimeString();
  }, [history, pos]);

  return (
    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-sm px-3 py-2 flex-wrap" data-testid="replay-scrubber">
      <Button
        data-testid="btn-replay-toggle"
        size="sm"
        variant={active ? "default" : "outline"}
        className={`rounded-sm h-7 text-xs ${active ? "bg-slate-900 hover:bg-slate-800" : ""}`}
        onClick={() => { setActive(!active); setPlaying(false); }}
      >
        <Rewind className="w-3 h-3 mr-1" />
        Replay {active ? "ON" : ""}
      </Button>

      {bookmarkLabel && active && (
        <span
          data-testid="replay-bookmark-chip"
          className="inline-flex items-center gap-1 text-[10px] font-mono-data px-2 py-0.5 rounded-sm bg-amber-100 text-amber-800 border border-amber-300"
          title="Session bookmark from huge OI shift"
        >
          <Bookmark className="w-3 h-3" />
          Jump → {bookmarkLabel}
        </span>
      )}

      {active && history.length > 0 && (
        <>
          <Button
            data-testid="btn-replay-play"
            size="sm"
            variant="outline"
            className="rounded-sm h-7 w-7 p-0"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </Button>
          <div className="flex-1 min-w-[140px]">
            <Slider
              data-testid="slider-replay"
              min={0}
              max={history.length - 1}
              step={1}
              value={[pos]}
              onValueChange={(v) => setPos(v[0])}
            />
          </div>
          <span className="text-xs font-mono-data text-slate-700 dark:text-slate-200 min-w-[70px] text-right">
            {label}
          </span>
        </>
      )}
      {active && history.length === 0 && (
        <span className="text-xs text-slate-400 italic">Loading history…</span>
      )}
    </div>
  );
}

function findClosestFrame(history, targetTs) {
  const target = Date.parse(targetTs);
  if (Number.isNaN(target) || !history.length) return -1;
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < history.length; i++) {
    const ts = Date.parse(history[i].timestamp || history[i].created_at || "");
    if (Number.isNaN(ts)) continue;
    const d = Math.abs(ts - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}
