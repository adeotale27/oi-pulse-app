import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { Rewind, Play, Pause } from "lucide-react";

/**
 * Timeline scrubber for "Replay Change".
 * Loads /api/history/{index}?minutes=... and lets user scrub through snapshots.
 * When active, calls onReplayFrame(snapshot) on each move.
 * When inactive (paused), returns null via onReplayFrame(null).
 */
export default function ReplayScrubber({ index, minutes = 180, onReplayFrame }) {
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState(0);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active) {
      onReplayFrame?.(null);
      return;
    }
    let cancelled = false;
    api.get(`/history/${index}`, { params: { minutes } }).then((r) => {
      if (!cancelled) {
        setHistory(r.data.history || []);
        setPos((r.data.history?.length || 1) - 1);
      }
    });
    return () => { cancelled = true; };
  }, [active, index, minutes, onReplayFrame]);

  useEffect(() => {
    if (!active || !history.length) return;
    onReplayFrame?.(history[pos] || null);
  }, [pos, history, active, onReplayFrame]);

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
    return new Date(history[pos].created_at).toLocaleTimeString();
  }, [history, pos]);

  return (
    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-sm px-3 py-2" data-testid="replay-scrubber">
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
          <div className="flex-1 min-w-[200px]">
            <Slider
              data-testid="slider-replay"
              min={0}
              max={history.length - 1}
              step={1}
              value={[pos]}
              onValueChange={(v) => setPos(v[0])}
            />
          </div>
          <span className="text-xs font-mono-data text-slate-700 min-w-[70px] text-right">
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
