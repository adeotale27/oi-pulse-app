import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import useClickOutside from "@/hooks/useClickOutside";
import { toast } from "sonner";

const fmtCr = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return `${v < 0 ? "−" : ""}${abs}`;
};

const netTone = (n) => {
  if (n == null) return "text-slate-500";
  if (n > 0) return "text-emerald-700 dark:text-emerald-400";
  if (n < 0) return "text-rose-700 dark:text-rose-400";
  return "text-slate-600";
};

/**
 * Header tile: latest NSE FII/FPI & DII cash activity (₹ crores).
 * Face shows date + quick nets; dropdown has buy / sell / net.
 */
export default function FiiDiiBadge({ isAdmin = false }) {
  const [snap, setSnap] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/market/fii-dii");
      setSnap(data);
    } catch (_) {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const data = snap?.data;
  const fii = data?.fii;
  const dii = data?.dii;
  const dateLabel = data?.as_of_date_display || data?.as_of_date || "—";
  const hasData = !!(fii || dii);

  const tileBase =
    "w-full min-h-[58px] h-full rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-95 flex flex-col justify-between cursor-pointer";

  const fiiNet = fii?.net;
  const diiNet = dii?.net;
  const bothPositive = (fiiNet ?? 0) > 0 && (diiNet ?? 0) > 0;
  const bothNegative = (fiiNet ?? 0) < 0 && (diiNet ?? 0) < 0;
  const toneCls = !hasData
    ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
    : bothPositive
      ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : bothNegative
        ? "border-rose-400 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
        : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

  const refreshAdmin = async (e) => {
    e.stopPropagation();
    if (!isAdmin || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/fii-dii/refresh");
      setSnap(data);
      toast.success(
        data?.data?.as_of_date_display
          ? `FII/DII updated · ${data.data.as_of_date_display}`
          : "FII/DII refresh done"
      );
    } catch (err) {
      toast.error(err?.response?.data?.detail || "FII/DII refresh failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative w-full h-full" data-testid="fiidii-badge-wrap" ref={wrapRef}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setOpen((v) => !v);
        }}
        data-testid="fiidii-badge"
        className={`${tileBase} ${toneCls}`}
        title="FII / DII cash market activity (₹ crores)"
      >
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
          <Building2 className="w-3 h-3" />
          FII · DII
          <span className="ml-auto inline-flex items-center opacity-70">
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </div>

        {hasData ? (
          <>
            <div className="text-xs font-semibold leading-tight font-mono-data" data-testid="fiidii-date">
              {dateLabel}
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px] leading-tight font-mono-data">
              <span>
                FII{" "}
                <span className={`font-semibold ${netTone(fiiNet)}`}>
                  {fiiNet != null && fiiNet > 0 ? "+" : ""}
                  {fmtCr(fiiNet)}
                </span>
              </span>
              <span>
                DII{" "}
                <span className={`font-semibold ${netTone(diiNet)}`}>
                  {diiNet != null && diiNet > 0 ? "+" : ""}
                  {fmtCr(diiNet)}
                </span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold leading-snug">Awaiting evening update</div>
            <div className="text-[10px] opacity-60">NSE prints ~19:31 IST</div>
          </>
        )}
      </div>

      {open && (
        <div
          data-testid="fiidii-dropdown"
          className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <span>Cash market · ₹ crores</span>
            <span className="normal-case tracking-normal">{data?.scope || "NSE + BSE + MSEI"}</span>
          </div>

          {hasData ? (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-1.5 font-medium">Cat</th>
                  <th className="px-2 py-1.5 font-medium text-right">Buy</th>
                  <th className="px-2 py-1.5 font-medium text-right">Sell</th>
                  <th className="px-3 py-1.5 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {[fii, dii].filter(Boolean).map((row) => (
                  <tr key={row.category}>
                    <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">
                      {row.category.includes("FII") ? "FII/FPI" : "DII"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono-data text-slate-600 dark:text-slate-300">
                      {fmtCr(row.buy)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono-data text-slate-600 dark:text-slate-300">
                      {fmtCr(row.sell)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono-data font-semibold ${netTone(row.net)}`}>
                      {row.net != null && row.net > 0 ? "+" : ""}
                      {fmtCr(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-4 text-center text-[11px] text-slate-500">
              No FII/DII print cached yet. NSE usually updates between 16:00–19:30 IST.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700">
            <span>
              As of <b className="text-slate-700 dark:text-slate-200">{dateLabel}</b>
              {snap?.stale ? " · awaiting today" : ""}
            </span>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  data-testid="fiidii-refresh"
                  onClick={refreshAdmin}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-sky-600 hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              )}
              <a
                href="https://www.nseindia.com/reports/fii-dii"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                NSE ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
