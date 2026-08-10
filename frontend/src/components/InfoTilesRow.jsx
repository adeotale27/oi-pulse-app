import { useMemo, useRef, useState } from "react";
import HolidayBadge from "@/components/HolidayBadge";
import FiiDiiBadge from "@/components/FiiDiiBadge";
import MarketEventsBadge from "@/components/MarketEventsBadge";
import MarketImpactBadge from "@/components/MarketImpactBadge";
import { orderByIds } from "@/lib/tabOrder";

const DEFAULT_TILE_IDS = ["holiday", "fii-dii", "events", "impact"];

/**
 * Holiday / FII-DII / Events / Impact tiles with drag-and-drop reorder among themselves.
 * Alt+← / Alt+→ nudges the focused tile; double-click pins it first.
 */
export default function InfoTilesRow({
  order = [],
  onReorder,
  onFavorite,
  onMove,
  isAdmin = false,
  showImpact = true,
  activeIndex,
  onOpenHolidays,
  onOpenIndexEvents,
  wide = false,
  testId = "dashboard-info-tiles",
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClickRef = useRef(false);
  const canReorder = typeof onReorder === "function";
  const canFavorite = typeof onFavorite === "function";
  const canMove = typeof onMove === "function";

  const catalog = useMemo(() => {
    const all = [
      {
        id: "holiday",
        node: <HolidayBadge onClick={onOpenHolidays} />,
      },
      {
        id: "fii-dii",
        node: <FiiDiiBadge isAdmin={!!isAdmin} />,
      },
      {
        id: "events",
        node: <MarketEventsBadge onClick={onOpenHolidays} />,
      },
    ];
    if (showImpact) {
      all.push({
        id: "impact",
        node: (
          <MarketImpactBadge
            activeIndex={activeIndex}
            onOpenIndexEvents={onOpenIndexEvents}
          />
        ),
      });
    }
    return all;
  }, [isAdmin, showImpact, activeIndex, onOpenHolidays, onOpenIndexEvents]);

  const tiles = useMemo(
    () => orderByIds(catalog, order.length ? order : DEFAULT_TILE_IDS, "id"),
    [catalog, order],
  );

  const onDragStart = (e, id) => {
    if (!canReorder) return;
    skipClickRef.current = false;
    setDraggingId(id);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* noop */
    }
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const onDragOver = (e, id) => {
    if (!canReorder || !draggingId) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      /* noop */
    }
    if (overId !== id) setOverId(id);
  };

  const onDrop = (e, dropId) => {
    if (!canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    let from = draggingId;
    try {
      from = e.dataTransfer.getData("text/plain") || from;
    } catch {
      /* noop */
    }
    setDraggingId(null);
    setOverId(null);
    if (from && dropId && from !== dropId) {
      skipClickRef.current = true;
      onReorder(from, dropId);
    }
  };

  // Swallow the click that sometimes follows a successful HTML5 drop so tile
  // buttons/dropdowns don't fire accidentally after a reorder.
  const onCaptureClick = (e) => {
    if (!skipClickRef.current) return;
    skipClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onTileKeyDown = (e, id) => {
    if (!canMove || !e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(id, e.key === "ArrowLeft" ? -1 : 1);
  };

  const onTileDoubleClick = (e, id) => {
    if (!canFavorite) return;
    e.preventDefault();
    e.stopPropagation();
    skipClickRef.current = true;
    onFavorite(id);
  };

  const tipParts = [];
  if (canReorder) tipParts.push("Drag to reorder");
  if (canFavorite) tipParts.push("double-click to pin first");
  if (canMove) tipParts.push("Alt+←/→ to nudge");
  const tileTitle = tipParts.length ? tipParts.join(" · ") : undefined;

  const widthCls = wide ? "w-44 2xl:w-48 shrink-0" : "w-44 shrink-0";

  return (
    <div
      className="flex items-stretch gap-2 relative z-30 overflow-visible"
      data-testid={testId}
      onClickCapture={onCaptureClick}
    >
      {tiles.map((t) => {
        const isOver = canReorder && overId === t.id && draggingId && draggingId !== t.id;
        const isDrag = canReorder && draggingId === t.id;
        return (
          <div
            key={t.id}
            data-testid={`info-tile-${t.id}`}
            tabIndex={canMove ? 0 : undefined}
            draggable={canReorder}
            onDragStart={(e) => onDragStart(e, t.id)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => onDragOver(e, t.id)}
            onDragLeave={() => {
              if (overId === t.id) setOverId(null);
            }}
            onDrop={(e) => onDrop(e, t.id)}
            onKeyDown={(e) => onTileKeyDown(e, t.id)}
            onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
            title={tileTitle}
            className={`${widthCls} outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-sm ${
              canReorder ? "cursor-grab active:cursor-grabbing" : ""
            } ${isDrag ? "opacity-40" : ""} ${isOver ? "ring-2 ring-emerald-400" : ""}`}
          >
            {t.node}
          </div>
        );
      })}
    </div>
  );
}

export { DEFAULT_TILE_IDS };
