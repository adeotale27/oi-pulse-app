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
  const levels = data?.levels || [];
  return (
    <section className="rounded-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5" data-testid="market-memory-card">
      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Market Memory</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          {levels.length ? "Structural zones near the current price" : "Learning from live OI snapshots."}
        </div>
        {levels.length ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{levels.length} memories</span> : null}
      </div>
      {levels.length ? <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {levels.slice(0, 3).map((row) => (
          <div key={`${row.level}-${row.levelType}`} className="rounded border border-slate-100 bg-slate-50/70 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-data text-xs font-semibold">{Number(row.level).toLocaleString("en-IN")}</span>
              <span className={`text-[9px] font-bold ${row.levelType === "SUPPORT" ? "text-emerald-600" : row.levelType === "RESISTANCE" ? "text-rose-600" : "text-amber-600"}`}>{row.levelType}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">{row.strength || "—"} · {row.touchCount || 0} interactions · {row.currentDistance == null ? "—" : `${row.currentDistance} pts`}</div>
          </div>
        ))}
      </div> : null}
      <Button type="button" variant="ghost" className="mt-1 h-7 px-0 text-[10px] uppercase tracking-wide" onClick={() => setOpen(true)}>View Full Memory</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="market-memory-detail">
          <SheetHeader><SheetTitle>Market Memory · {index}</SheetTitle><p className="text-xs text-slate-500">Avg reaction is the typical move after a level is tested. Distance is the live price difference from that level; negative means below it, positive means above it.</p></SheetHeader>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs"><thead className="text-left text-[10px] uppercase text-slate-500"><tr><th>Level</th><th>Type</th><th>Strength</th><th>Interactions</th><th>Avg reaction</th><th>Distance</th></tr></thead>
              <tbody>{(data?.levels || []).map((row) => <tr key={`${row.level}-${row.levelType}`} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 font-mono-data">{Number(row.level).toLocaleString("en-IN")}<div className="text-[9px] text-slate-400">{row.zoneLow}–{row.zoneHigh}</div></td><td>{row.levelType}</td><td className={row.strength === "HIGH" ? "font-semibold text-emerald-600" : "text-amber-600"}>{row.strength || "—"}</td><td>{(row.rejectionCount || 0) + (row.touchCount || 0)}</td><td>{row.averageReaction == null ? "—" : `${row.averageReaction} pts`}</td><td>{row.currentDistance == null ? "—" : `${row.currentDistance} pts`}</td></tr>)}</tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
