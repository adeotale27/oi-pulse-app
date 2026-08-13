import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, LayoutGrid } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  INSIGHT_TILE_DEFS,
  loadInsightHidden,
  loadInsightOrder,
  reorderInsights,
  saveInsightHidden,
} from "@/lib/positionsInsightLayout";

export default function PositionsInsightTiles({ nodes = {}, layoutAnchorId = null }) {
  const [order, setOrder] = useState(() => loadInsightOrder());
  const [hidden, setHidden] = useState(() => loadInsightHidden());
  const [dragging, setDragging] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClick = useRef(false);
  const [anchor, setAnchor] = useState(null);

  useEffect(() => {
    if (!layoutAnchorId || typeof document === "undefined") {
      setAnchor(null);
      return undefined;
    }
    setAnchor(document.getElementById(layoutAnchorId));
  }, [layoutAnchorId]);

  const visible = useMemo(
    () => order.filter((id) => !hidden.has(id) && nodes[id]),
    [order, hidden, nodes],
  );

  const toggle = (id, on) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      saveInsightHidden(next);
      return next;
    });
  };

  const layoutButton = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 h-7 px-2 rounded-sm border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          data-testid="btn-insight-tiles-config"
          title="Show, hide, and drag tiles"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Tiles
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 space-y-2" data-testid="insight-tiles-menu">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Insight tiles</div>
        <p className="text-[11px] text-slate-600">Toggle what you need. Drag tiles on the desk to reorder.</p>
        {INSIGHT_TILE_DEFS.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-2 text-[12px] text-slate-800">
            <span>{t.label}</span>
            <Switch checked={!hidden.has(t.id)} onCheckedChange={(on) => toggle(t.id, on)} className="scale-90" />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="space-y-1.5" data-testid="positions-insight-tiles">
      {anchor
        ? createPortal(layoutButton, anchor)
        : layoutAnchorId
          ? null
          : <div className="flex items-center justify-end">{layoutButton}</div>}
      <div className="grid grid-flow-col auto-cols-[minmax(9.25rem,1fr)] gap-2 overflow-x-auto pb-0.5">
        {visible.map((id) => {
          return (
            <div
              key={id}
              draggable
              data-testid={`insight-tile-${id}`}
              onDragStart={(e) => {
                skipClick.current = false;
                setDragging(id);
                try {
                  e.dataTransfer.setData("text/plain", id);
                  e.dataTransfer.effectAllowed = "move";
                } catch { /* noop */ }
              }}
              onDragEnd={() => { setDragging(null); setOverId(null); }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overId !== id) setOverId(id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                let from = dragging;
                try { from = e.dataTransfer.getData("text/plain") || from; } catch { /* noop */ }
                setDragging(null);
                setOverId(null);
                if (from && from !== id) {
                  skipClick.current = true;
                  setOrder((prev) => reorderInsights(prev, from, id));
                }
              }}
              className={`relative h-[8.75rem] min-w-[9.25rem] ${dragging === id ? "opacity-40" : ""} ${
                overId === id && dragging && dragging !== id ? "ring-2 ring-emerald-400 rounded-xl" : ""
              }`}
            >
              <span className="absolute top-1 right-1 z-10 text-slate-300 cursor-grab active:cursor-grabbing" title="Drag to move">
                <GripVertical className="w-3.5 h-3.5" />
              </span>
              {nodes[id]}
            </div>
          );
        })}
      </div>
    </div>
  );
}
