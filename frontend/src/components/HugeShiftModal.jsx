import { AlertTriangle, X, Rewind } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { hugeShiftCopy } from "@/lib/oiAlertCopy";

function fmt(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)} K`;
  return `${sign}${Math.round(abs)}`;
}

export default function HugeShiftModal({ shift, onClose, onCloseAll, onReplayAtMoment }) {
  if (!shift) return null;
  const meta = hugeShiftCopy(shift.side, shift.value);
  const toneBg = meta.tone === "emerald" ? "bg-emerald-50 border-emerald-300" : "bg-rose-50 border-rose-300";
  const toneText = meta.tone === "emerald" ? "text-emerald-800" : "text-rose-800";
  const bookmarkTs = shift.snapshotTs || shift.at;
  let jumpLabel = "";
  try {
    jumpLabel = bookmarkTs ? new Date(bookmarkTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  } catch { jumpLabel = ""; }
  return (
    <Dialog open={!!shift} onOpenChange={(v) => { if (!v) (onCloseAll || onClose)?.(); }}>
      <DialogContent
        data-testid="huge-shift-modal"
        hideClose={false}
        className={`max-w-lg border-2 ${toneBg} rounded-xl shadow-2xl max-h-[min(88dvh,36rem)] overflow-y-auto max-md:w-[calc(100vw-1.25rem)] max-md:max-w-none max-md:p-4`}
      >
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${toneText} text-base sm:text-lg`}>
            <AlertTriangle className="w-5 h-5 animate-pulse shrink-0" />
            Big OI move · {shift.index}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className={`text-base font-bold ${toneText}`}>{meta.headline}</div>
          <div className="text-sm text-slate-700">{meta.read}</div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <Stat label="Window" value={`${shift.window} min`} />
            <Stat label="Side" value={shift.side === "CE" ? "Calls" : "Puts"} />
            <Stat label="OI change" value={fmt(shift.value)} tone={meta.tone} />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {bookmarkTs && onReplayAtMoment && (
            <Button
              data-testid="btn-replay-huge-shift"
              variant="outline"
              onClick={() => onReplayAtMoment(bookmarkTs)}
              className="rounded-sm border-slate-300 min-h-11"
              title={`Open session replay parked at ${jumpLabel || "this moment"}`}
            >
              <Rewind className="w-4 h-4 mr-1" />
              {jumpLabel ? `Jump to ${jumpLabel}` : "Replay"}
            </Button>
          )}
          <Button
            data-testid="btn-ack-huge-shift"
            onClick={onCloseAll || onClose}
            className={`${meta.tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"} rounded-sm min-h-11`}
          >
            <X className="w-4 h-4 mr-1" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 flex flex-col leading-tight">
      <span className="uppercase tracking-widest text-[9px] text-slate-400">{label}</span>
      <span className={`text-sm font-semibold font-mono-data ${cls}`}>{value ?? "—"}</span>
    </div>
  );
}
