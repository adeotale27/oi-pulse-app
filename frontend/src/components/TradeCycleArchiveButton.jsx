import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, Trash2, Upload } from "lucide-react";
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
  deleteTradeCycleArchive,
  downloadTradeCycleArchive,
  fetchTradeCycleArchiveRange,
} from "@/lib/api";
import { parseTradeCycleArchive } from "@/lib/tradeCycleArchive";

function todayInIndia() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysBefore(ymd, days) {
  const value = new Date(`${ymd}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function archiveMutationError(error, fallback) {
  if (
    error?.code === "ECONNABORTED"
    || error?.message === "Network Error"
    || /timeout/i.test(error?.message || "")
  ) {
    return "The request did not return in time. Refresh the date-range count before retrying; the server may have completed the operation.";
  }
  return error?.response?.data?.detail || error?.message || fallback;
}

export default function TradeCycleArchiveButton({ onArchiveLoaded }) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState("compact");
  const [today] = useState(todayInIndia);
  const [fromDate, setFromDate] = useState(() => daysBefore(today, 29));
  const [toDate, setToDate] = useState(today);
  const [archiveRange, setArchiveRange] = useState(null);
  const [downloaded, setDownloaded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const rangeRequestId = useRef(0);
  const validRange = Boolean(fromDate && toDate && fromDate <= toDate && toDate <= today);

  const loadRange = useCallback(async () => {
    if (!validRange) return;
    const requestId = ++rangeRequestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetchTradeCycleArchiveRange(fromDate, toDate);
      if (requestId === rangeRequestId.current) setArchiveRange(response);
    } catch (e) {
      if (requestId !== rangeRequestId.current) return;
      setArchiveRange(null);
      setError(e?.response?.data?.detail || e?.message || "Could not check this date range");
    } finally {
      if (requestId === rangeRequestId.current) setLoading(false);
    }
  }, [fromDate, toDate, validRange]);

  useEffect(() => {
    if (!open) return;
    if (validRange) {
      loadRange();
    } else {
      setArchiveRange(null);
    }
  }, [open, validRange, loadRange]);

  const onRangeChange = (setter) => (event) => {
    rangeRequestId.current += 1;
    setLoading(false);
    setter(event.target.value);
    setArchiveRange(null);
    setDownloaded(null);
    setError("");
    setResult("");
  };

  const onDownload = async () => {
    if (!validRange || !archiveRange?.count) return;
    setBusy(true);
    setError("");
    setResult("");
    setDownloaded(null);
    try {
      const archive = await downloadTradeCycleArchive(fromDate, toDate);
      setDownloaded({ ...archive, fromDate, toDate });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Could not download archive");
    } finally {
      setBusy(false);
    }
  };

  // A downloaded fingerprint authorizes mutations only for the exact date range it covered.
  const onCompact = async () => {
    if (!downloaded || downloaded.fromDate !== fromDate || downloaded.toDate !== toDate) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const compacted = await compactTradeCycleArchive(
        downloaded.fromDate,
        downloaded.toDate,
        downloaded.sha256,
      );
      const message = compacted.remaining_count
        ? `Compacted ${compacted.compacted_count} of ${compacted.detail_count} detail sets; download a fresh archive before retrying.`
        : `Compacted ${compacted.compacted_count} detail sets. Cycle summaries and daily P&L remain.`;
      setResult(message);
      setDownloaded(null);
      setConfirmOpen(false);
      await loadRange();
    } catch (e) {
      setConfirmOpen(false);
      setError(archiveMutationError(e, "Could not compact archived details"));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!downloaded || downloaded.fromDate !== fromDate || downloaded.toDate !== toDate) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const deleted = await deleteTradeCycleArchive(
        downloaded.fromDate,
        downloaded.toDate,
        downloaded.sha256,
      );
      setResult(deleted.remaining_count
        ? `Deleted ${deleted.deleted_count} of ${deleted.archive_count} cycles from ${deleted.from} to ${deleted.to}; download a fresh archive to continue.`
        : `Permanently deleted ${deleted.deleted_count} closed cycles from ${deleted.from} to ${deleted.to}. The verified archive remains your external copy.`);
      setDownloaded(null);
      setConfirmOpen(false);
      await loadRange();
    } catch (e) {
      setConfirmOpen(false);
      setError(archiveMutationError(e, "Could not delete archived cycles"));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    setResult("");
    try {
      const archive = await parseTradeCycleArchive(file);
      onArchiveLoaded?.(archive);
      setResult(`Loaded ${archive.count} cycles from ${archive.name} into this browser tab only.`);
    } catch (e) {
      setError(e?.message || "Could not read this trade-cycle archive");
    } finally {
      setUploading(false);
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
            <div className="text-xs font-semibold text-slate-900">Archive, compact, or remove old cycles</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Choose an inclusive Exit Date range. The same dates are used for checking, downloading, compacting, or permanently deleting closed cycles; open and partial cycles are never included. Save the downloaded archive outside this app before changing stored data. Compact removes raw events/fills but keeps cycle summaries; Delete permanently removes the selected closed cycles. Neither changes daily journal P&amp;L. Upload a downloaded .jsonl.gz file to view its cycle P&amp;L in the calendar; it stays in this tab’s memory and is never sent to MongoDB.
              {" "}Large changes can take up to two minutes; keep this window open while they finish.
            </p>
          </div>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Reading archive locally…" : "Upload downloaded archive"}
            <input
              type="file"
              accept=".jsonl.gz,application/gzip"
              className="sr-only"
              onChange={onUpload}
              disabled={uploading}
              data-testid="cycle-archive-upload"
              aria-label="Upload trade-cycle archive"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-semibold text-slate-600">
              Exit Date from
              <input
                type="date"
                value={fromDate}
                max={today}
                onChange={onRangeChange(setFromDate)}
                className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
                aria-label="Archive exit date from"
                data-testid="cycle-archive-from"
              />
            </label>
            <label className="block text-[11px] font-semibold text-slate-600">
              Exit Date to
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                max={today}
                onChange={onRangeChange(setToDate)}
                className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
                aria-label="Archive exit date to"
                data-testid="cycle-archive-to"
              />
            </label>
          </div>
          {!validRange ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              Choose valid dates with From on or before To; future dates are not allowed.
            </div>
          ) : null}
          {loading ? <div className="text-xs text-slate-500">Checking selected dates…</div> : null}
          {!loading && validRange && archiveRange?.count ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" data-testid="cycle-archive-count">
              {archiveRange.count} closed cycles · {archiveRange.detail_count} with fill details
            </div>
          ) : null}
          {!loading && validRange && archiveRange && !archiveRange.count && !error ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              No closed cycles in this date range.
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
              <div>Save it somewhere outside this app before compacting or permanently deleting.</div>
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
              disabled={busy || loading || !validRange || !archiveRange?.count}
              data-testid="btn-cycle-archive-download"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {busy && !confirmOpen ? "Preparing…" : "Download archive"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-10 rounded-sm bg-rose-700 text-white hover:bg-rose-800"
              onClick={() => {
                setConfirmAction("compact");
                setConfirmOpen(true);
              }}
              disabled={busy || !archiveRange?.detail_count || !downloaded || downloaded.fromDate !== fromDate || downloaded.toDate !== toDate}
              data-testid="btn-cycle-archive-compact"
            >
              Confirm saved &amp; compact
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-10 rounded-sm bg-rose-700 text-white hover:bg-rose-800 sm:col-span-2"
              onClick={() => {
                setConfirmAction("delete");
                setConfirmOpen(true);
              }}
              disabled={busy || !downloaded || downloaded.fromDate !== fromDate || downloaded.toDate !== toDate}
              data-testid="btn-cycle-archive-delete"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Downloaded &amp; permanently delete this date range
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="z-[140]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "delete" ? "Permanently delete these closed cycles?" : "Compact archived trade details?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "delete"
                ? <>This permanently deletes every closed cycle with an Exit Date from {downloaded?.fromDate} through {downloaded?.toDate}, inclusive, from MongoDB after checking the archive fingerprint. Open/partial cycles, cycles outside this range, guest cycles, and daily journal P&amp;L are not touched. Continue only after saving <strong>{downloaded?.name}</strong> outside this app. This cannot be undone from the app.</>
                : <>This removes raw fill/event details for closed cycles with an Exit Date from {downloaded?.fromDate} through {downloaded?.toDate}, inclusive, from MongoDB after checking the archive fingerprint. Continue only after saving <strong>{downloaded?.name}</strong> outside this app. Daily journal P&amp;L and compact trade summaries are not removed.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="alert-dialog-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (confirmAction === "delete") onDelete();
                else onCompact();
              }}
              className="bg-rose-700 text-white hover:bg-rose-800"
              data-testid="btn-cycle-archive-confirm"
            >
              {busy ? "Verifying…" : confirmAction === "delete" ? "I saved it; permanently delete" : "I saved it; compact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
