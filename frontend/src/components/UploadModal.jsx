import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadCloud, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { API } from "@/lib/api";
import { toast } from "sonner";

const UPLOAD_TYPES = [
  { value: "nifty50", label: "NIFTY 50 Constituents", endpoint: "/admin/upload/constituents" },
  { value: "banknifty", label: "Bank Nifty Constituents", endpoint: "/admin/upload/constituents" },
  { value: "sensex", label: "Sensex Constituents", endpoint: "/admin/upload/constituents" },
  { value: "events", label: "1 Month NSE Event Calendar", endpoint: "/admin/upload/events" },
];

/**
 * UploadModal — admin-only. Upload constituents or event calendar.
 *   • Dropdown for upload type
 *   • File picker (.csv or .xlsx)
 *   • Save posts multipart to backend; shows row-level validation errors when
 *     backend returns { ok:false, errors:[...] }
 *   • On success: toast + optional onUploaded callback
 */
export default function UploadModal({ open, onOpenChange, onUploaded }) {
  const [uploadType, setUploadType] = useState("nifty50");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(null);

  const reset = () => {
    setFile(null); setBusy(false); setProgress(0); setErrors([]); setSuccess(null);
  };

  const handleChange = (v) => {
    setUploadType(v);
    setErrors([]); setSuccess(null);
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setErrors([]); setSuccess(null);
  };

  const submit = async () => {
    if (!file) { toast.error("Please select a CSV or XLSX file first."); return; }
    const meta = UPLOAD_TYPES.find((t) => t.value === uploadType);
    if (!meta) return;
    setBusy(true); setProgress(0); setErrors([]); setSuccess(null);

    const fd = new FormData();
    fd.append("file", file);
    if (meta.endpoint.endsWith("/constituents")) {
      fd.append("upload_type", uploadType);
    }

    try {
      const token = localStorage.getItem("oi_admin_token") || "";
      const url = `${API}${meta.endpoint}`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      if (token) xhr.setRequestHeader("X-Admin-Token", token);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300) resolve(json);
            else reject(json?.detail || `HTTP ${xhr.status}`);
          } catch (_) {
            reject(`Invalid response (${xhr.status})`);
          }
        };
        xhr.onerror = () => reject("Network error");
        xhr.send(fd);
      });

      if (result?.ok === false && Array.isArray(result.errors) && result.errors.length) {
        setErrors(result.errors);
        toast.error(`Upload failed: ${result.errors.length} validation error(s)`);
      } else if (result?.ok) {
        setSuccess({
          label: meta.label,
          rows: result.rows_saved,
          filename: result.filename || file.name,
        });
        toast.success(`${meta.label} uploaded — ${result.rows_saved} rows saved.`);
        if (typeof onUploaded === "function") onUploaded(uploadType, result);
      } else {
        toast.error("Unexpected response from server.");
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message || "Upload failed");
      toast.error(msg);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent
        data-testid="upload-modal"
        className="sm:max-w-md dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5" />
            Upload Data
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a CSV or XLSX file. Existing data for the selected category will be replaced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Upload Type
            </Label>
            <select
              data-testid="upload-type"
              value={uploadType}
              onChange={(e) => handleChange(e.target.value)}
              disabled={busy}
              className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-md px-2 py-2"
            >
              {UPLOAD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              File
            </Label>
            <input
              data-testid="upload-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFile}
              disabled={busy}
              className="mt-1 block w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 dark:file:bg-slate-700 dark:file:text-slate-100 hover:file:bg-slate-200"
            />
            {file && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {file.name} — {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          {busy && (
            <div className="w-full">
              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Uploading… {progress}%</p>
            </div>
          )}

          {errors.length > 0 && (
            <div
              data-testid="upload-errors"
              className="border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 rounded-md p-2 max-h-48 overflow-auto"
            >
              <div className="flex items-center gap-1 text-rose-700 dark:text-rose-300 text-xs font-semibold mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {errors.length} validation error{errors.length > 1 ? "s" : ""}
              </div>
              <ul className="text-[11px] text-rose-700 dark:text-rose-200 space-y-0.5 list-disc list-inside">
                {errors.slice(0, 40).map((e, i) => (<li key={i}>{e}</li>))}
                {errors.length > 40 && (<li>… and {errors.length - 40} more</li>)}
              </ul>
            </div>
          )}

          {success && (
            <div
              data-testid="upload-success"
              className="border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 rounded-md p-2"
            >
              <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {success.label} — {success.rows} rows saved
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-200">
                Source: {success.filename}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            className="rounded-sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
          <Button
            data-testid="upload-save"
            className="rounded-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={submit}
            disabled={busy || !file}
          >
            <UploadCloud className="w-4 h-4 mr-1.5" />
            {busy ? "Uploading…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}