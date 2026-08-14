import { Switch } from "@/components/ui/switch";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";

/** Shared Show / Ask / On-grid controls for header AI (phone + desktop). */
export default function DeskAiConfigMenu({
  showDeskAi = true,
  deskAiAsk = true,
  onGrid = true,
  onDeskAiChange,
  onToggleGrid,
  onOpenPanel,
}) {
  return (
    <>
      <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
        Desk AI (admin and guests)
      </DropdownMenuLabel>
      <div className="flex items-center justify-between gap-2 px-1 py-2" onPointerDown={(e) => e.stopPropagation()}>
        <span className="text-xs font-semibold text-slate-800">Show Desk AI</span>
        <Switch
          checked={!!showDeskAi}
          onCheckedChange={(on) => onDeskAiChange?.({ show: !!on })}
          data-testid="header-desk-ai-show"
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-1 py-2" onPointerDown={(e) => e.stopPropagation()}>
        <span className="text-xs font-semibold text-slate-800">Ask AI</span>
        <Switch
          checked={!!deskAiAsk}
          onCheckedChange={(on) => onDeskAiChange?.({ ask: !!on })}
          data-testid="header-desk-ai-ask"
        />
      </div>
      {typeof onToggleGrid === "function" ? (
        <div className="flex items-center justify-between gap-2 px-1 py-2" onPointerDown={(e) => e.stopPropagation()}>
          <span className="text-xs font-semibold text-slate-800">Slim strip on chart</span>
          <Switch
            checked={!!onGrid}
            onCheckedChange={(on) => onToggleGrid(!!on)}
            data-testid="header-desk-ai-grid"
          />
        </div>
      ) : null}
      <p className="px-1 pb-1 text-[10px] text-slate-500 leading-snug">
        One switch for you and guests. Full tape lives in the side panel so the OI chart keeps the grid.
      </p>
      {typeof onOpenPanel === "function" ? (
        <DropdownMenuItem
          data-testid="header-desk-ai-open-panel"
          onSelect={() => onOpenPanel()}
        >
          Open in side panel
        </DropdownMenuItem>
      ) : null}
      {showDeskAi && onGrid ? (
        <DropdownMenuItem
          onSelect={() => document.getElementById("desk-ai-bar")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
        >
          Jump to strip
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
