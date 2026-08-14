import { Switch } from "@/components/ui/switch";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";

/** One on/off for everyone. Full tape opens in the side panel. */
export default function DeskAiConfigMenu({
  showDeskAi = false,
  onDeskAiChange,
  onOpenPanel,
}) {
  return (
    <>
      <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
        Desk AI
      </DropdownMenuLabel>
      <div className="flex items-center justify-between gap-2 px-1 py-2" onPointerDown={(e) => e.stopPropagation()}>
        <span className="text-xs font-semibold text-slate-800">On</span>
        <Switch
          checked={!!showDeskAi}
          onCheckedChange={(on) => onDeskAiChange?.({ show: !!on })}
          data-testid="header-desk-ai-show"
        />
      </div>
      <p className="px-1 pb-1 text-[10px] text-slate-500 leading-snug">
        One switch for the whole desk. Tape opens in the side panel.
      </p>
      {typeof onOpenPanel === "function" ? (
        <DropdownMenuItem
          data-testid="header-desk-ai-open-panel"
          onSelect={() => onOpenPanel()}
        >
          Open in side panel
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
