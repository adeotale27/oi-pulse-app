import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DeskAiBar from "@/components/DeskAiBar";

/** Phone: AI chip opens this sheet. Close returns to the dashboard. */
export default function DeskAiMobileSheet({
  open,
  onOpenChange,
  activeIndex,
  showDeskAi,
  onDeskAiChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="desk-ai-mobile-sheet"
        className="left-0 top-0 h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none p-3 gap-2 overflow-hidden flex flex-col sm:rounded-none"
      >
        <DialogHeader className="pr-8 shrink-0 text-left">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Desk AI</span>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              On
              <Switch
                checked={!!showDeskAi}
                onCheckedChange={(on) => onDeskAiChange?.({ show: !!on })}
                data-testid="mobile-desk-ai-show"
              />
            </label>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Close to return to the chart. This tape stays in the popup on phones.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {showDeskAi ? (
            <DeskAiBar
              activeIndex={activeIndex}
              visible
              askAi
              variant="panel"
            />
          ) : (
            <p className="text-sm text-slate-600 px-1 py-6">
              Turn Desk AI on to load the tape. Same switch as desktop — guests and admin share it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
