import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { downloadTradesExcel } from "@/lib/api";
import { todayIST } from "@/lib/holidays";
import { DESK_IDS, INDEX_SHORT } from "@/lib/universe";
import { toast } from "sonner";

function monthStartIST() {
  const t = todayIST();
  return `${t.slice(0, 8)}01`;
}

export default function DownloadTradesButton({ compact = false, align = "end" }) {
  const today = todayIST();
  const [from, setFrom] = useState(monthStartIST);
  const [to, setTo] = useState(today);
  const [index, setIndex] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const chips = useMemo(() => ["ALL", ...DESK_IDS], []);

  const onDownload = async () => {
    if (!from || !to || from > to) {
      toast.error("Pick a From date on or before To");
      return;
    }
    setBusy(true);
    try {
      await downloadTradesExcel({ from, to, index });
      toast.success("Trades Excel downloaded");
    } catch (e) {
      toast.error(e?.message || e?.response?.data?.detail || "Could not download trades");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={`rounded-sm bg-white shrink-0 text-slate-800 border-slate-300 hover:bg-slate-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 ${
            compact ? "h-8 px-2.5" : "h-11 sm:h-8 px-3"
          }`}
          data-testid="btn-download-trades"
          title="Download stored trades as Excel, with entry and exit time"
        >
          <Download className="w-3.5 h-3.5 mr-1" />
          Download trades
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-3 space-y-3"
        data-testid="download-trades-popover"
      >
        <div>
          <div className="text-xs font-semibold text-slate-900">Download trades</div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Excel from our database — not a live Kite dump. Entry stays the original fill
            (Friday hold still shows Friday after a Monday token refresh). Partial exits are
            on the second sheet.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 min-w-0 block">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-0.5 block h-11 sm:h-8 w-full min-w-0 rounded-lg sm:rounded-md border border-slate-200 bg-white px-3 sm:px-2 text-base sm:text-[13px] font-medium text-slate-800 cursor-pointer"
              data-testid="download-trades-from"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 min-w-0 block">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-0.5 block h-11 sm:h-8 w-full min-w-0 rounded-lg sm:rounded-md border border-slate-200 bg-white px-3 sm:px-2 text-base sm:text-[13px] font-medium text-slate-800 cursor-pointer"
              data-testid="download-trades-to"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1">
          {chips.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setIndex(id)}
              data-testid={`download-trades-index-${id}`}
              className={`h-8 px-2.5 rounded-full text-[11px] font-semibold border cursor-pointer ${
                index === id
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {id === "ALL" ? "All indices" : (INDEX_SHORT[id] || id)}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full h-11 sm:h-8 rounded-sm bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
          onClick={onDownload}
          disabled={busy}
          data-testid="btn-download-trades-confirm"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          {busy ? "Preparing…" : "Download Excel"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
