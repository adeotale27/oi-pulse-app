import { useCallback, useEffect, useState } from "react";
import { Archive, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  compactTradeCycleArchive,
  downloadTradeCycleArchive,
  fetchTradeCycleArchiveMonths,
} from "@/lib/api";

export default function TradeCycleArchiveButton() {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [downloaded, setDownloaded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const loadMonths = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchTradeCycleArchiveMonths();
      const available = response?.months || [];
      setMonths(available);
      setSelectedMonth((current) => (
        current && available.some((item) => item.month === current)
          ? current
          : (available[0]?.month || "")
      ));
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Could not load eligible archive months");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadMonths();
  }, [open, loadMonths]);

  const onDownload = async () => {
    if (!selectedMonth) return;
    setBusy(true);
    setError("");
    setResult("");
    setDownloaded(null);
    try {
      const archive = await downloadTradeCycleArchive(selectedMonth);
      setDownloaded({ ...archive, month: selectedMonth });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Could not download archive");
    } finally {
      setBusy(false);
    }
  };

  const onCompact = async () => {
    if (!downloaded || downloaded.month !== selectedMonth) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const compacted = await compactTradeCycleArchive(downloaded.month, downloaded.sha256);
      const message = compacted.remaining_count
        ? `Compacted ${compacted.compacted_count} of ${compacted.archive_count}; download a fresh archive for the remaining records.`
        : `Compacted ${compacted.compacted_count} cycles. Their summaries and daily P&L remain.`;
      setResult(message);
      setDownloaded(null);
      setConfirmOpen(false);
      await loadMonths();
    } catch (e) {
      setConfirmOpen(false);
      setError(e?.response?.data?.detail || e?.message || "Could not compact archived details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-sm bg-white px-2.5 text-slate-800 border-slate-300 hover:bg-slate-50"
            data-testid="btn-cycle-archive"
          >
            <Archive className="mr-1 h-3.5 w-3.5" />
            Archive old cycles
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[120] w-[min(26rem,calc(100vw-1.5rem))] space-y-3 p-3"
          data-testid="cycle-archive-popover"
        >
          <div>
            <div className="text-xs font-semibold text-slate-900">Move old fill details out of MongoDB</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Full closed-cycle details become eligible after 90 days. Download and save the archive outside this app first.
              Compaction removes only raw events/fills; cycle summaries, partial-exit summaries, and daily journal P&amp;L stay in MongoDB.
            </p>
          </div>
          {loading ? <div className="text-xs text-slate-500">Loading eligible months…</div> : null}
          {!loading && months.length ? (
            <label className="block text-[11px] font-semibold text-slate-600">
              Eligible month
              <select
                aria-label="Eligible archive month"
                value={selectedMonth}
                onChange={(event) => {
                  setSelectedMonth(event.target.value);
                  setDownloaded(null);
                  setError("");
                  setResult("");
                }}
                className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
                data-testid="cycle-archive-month"
              >
                {months.map((item) => (
                  <option key={item.month} value={item.month}>
                    {item.month} · {item.count} cycles
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!loading && !months.length && !error ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              No closed-cycle detail is old enough to archive.
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {error}
            </div>
          ) : null}
          {result ? (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              {result}
            </div>
          ) : null}
          {downloaded ? (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-950">
              <div className="font-semibold">Download started: {downloaded.name}</div>
              <div>Save it somewhere outside this app before confirming compaction.</div>
              <div className="break-all font-mono">SHA-256: {downloaded.sha256}</div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 rounded-sm"
              onClick={onDownload}
              disabled={busy || loading || !selectedMonth}
              data-testid="btn-cycle-archive-download"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {busy && !confirmOpen ? "Preparing…" : "Download archive"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-10 rounded-sm bg-rose-700 text-white hover:bg-rose-800"
              onClick={() => setConfirmOpen(true)}
              disabled={busy || !downloaded || downloaded.month !== selectedMonth}
              data-testid="btn-cycle-archive-compact"
            >
              Confirm saved &amp; compact
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="z-[140]">
          <AlertDialogHeader>
            <AlertDialogTitle>Compact archived trade details?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes raw fill/event details for {downloaded?.month} from MongoDB after checking the archive fingerprint.
              Continue only after saving <strong>{downloaded?.name}</strong> outside this app. Daily journal P&amp;L and compact trade summaries are not removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="alert-dialog-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                onCompact();
              }}
              className="bg-rose-700 text-white hover:bg-rose-800"
              data-testid="btn-cycle-archive-confirm"
            >
              {busy ? "Verifying…" : "I saved it; compact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
