import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export default function MarketMemoryCard({ index }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    api.get(`/market-memory/${index}`, { timeout: 8000 }).then((r) => live && setData(r.data)).catch(() => live && setData({ levels: [] }));
    return () => { live = false; };
  }, [index]);
  const levels = (data?.levels || []).slice(0, 4);
  return (
    <section className="rounded-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5" data-testid="market-memory-card">
      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Market Memory</div>
      <div className="mt-1.5 space-y-1.5">
        {levels.length ? levels.map((row) => (
          <div key={`${row.level}-${row.levelType}`} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-mono-data font-semibold">{Number(row.level).toLocaleString("en-IN")}</span>
            <span className="text-[10px] uppercase text-slate-500">{row.lastInteractionType} ×{row.rejectionCount || row.touchCount}</span>
          </div>
        )) : <div className="text-xs text-slate-400">Learning from live OI snapshots.</div>}
      </div>
      <Button type="button" variant="ghost" className="mt-1 h-7 px-0 text-[10px] uppercase tracking-wide" onClick={() => setOpen(true)}>View Full Memory</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="market-memory-detail">
          <SheetHeader><SheetTitle>Market Memory · {index}</SheetTitle></SheetHeader>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs"><thead className="text-left text-[10px] uppercase text-slate-500"><tr><th>Level</th><th>Type</th><th>Count</th><th>Last interaction</th><th>Avg reaction</th><th>Distance</th></tr></thead>
              <tbody>{(data?.levels || []).map((row) => <tr key={`${row.level}-${row.levelType}`} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 font-mono-data">{Number(row.level).toLocaleString("en-IN")}</td><td>{row.lastInteractionType || row.levelType}</td><td>{row.rejectionCount || row.touchCount}</td><td className="font-mono-data">{row.lastInteraction ? new Date(row.lastInteraction).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td>{row.averageReaction == null ? "—" : `${row.averageReaction} pts`}</td><td>{row.currentDistance == null ? "—" : `${row.currentDistance} pts`}</td></tr>)}</tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
