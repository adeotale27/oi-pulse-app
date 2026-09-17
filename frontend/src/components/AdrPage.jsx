import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from "recharts";
import { Columns3, Search, SlidersHorizontal, Clock } from "lucide-react";
import { api } from "@/lib/api";
import PageBrandTitle from "@/components/PageBrandTitle";
import ListingFlag from "@/components/ListingFlag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import useQuiescentAwarePolling from "@/hooks/useQuiescentAwarePolling";
import {
  ADR_COLUMNS, ADR_FILTERS, filterAdrRows, formatAdrCell, formatIstStamp, isAdrSessionOpen, listingCountryCode, loadAdrColumns, moveTone, resetAdrColumns, saveAdrColumns, sortAdrRows, toneClass, usdPrice, usdSigned, pctSigned, fmtVolume,
} from "@/lib/adr";

export default function AdrPage({ isAdmin = false, userKey = "desk", onOpenAdmin }) {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filt, setFilt] = useState("all");
  const [sortKey, setSortKey] = useState("company");
  const [sortDir, setSortDir] = useState("asc");
  const [cols, setCols] = useState(() => loadAdrColumns(userKey));
  const [openId, setOpenId] = useState(null);
  const [hist, setHist] = useState([]);
  const [range, setRange] = useState("1D");

  const load = async () => {
    try {
      const { data } = await api.get("/adrs", { timeout: 15000 });
      setSnap(data);
      setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || "Could not load ADRs");
    } finally {
      setLoading(false);
    }
  };

  useQuiescentAwarePolling(load, 20000, [], { immediate: true, allowDuringQuiescent: true, dedupeKey: "adr-desk" });

  useEffect(() => {
    setCols(loadAdrColumns(userKey));
  }, [userKey]);

  const visibleCols = useMemo(() => ADR_COLUMNS.filter((c) => cols.includes(c.id)), [cols]);
  const rows = useMemo(() => {
    const list = Array.isArray(snap?.items) ? snap.items : [];
    return sortAdrRows(filterAdrRows(list, { q, filter: filt }), sortKey, sortDir);
  }, [snap, q, filt, sortKey, sortDir]);

  const toggleCol = (id) => {
    setCols((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const ordered = ADR_COLUMNS.map((c) => c.id).filter((c) => next.includes(c));
      saveAdrColumns(userKey, ordered);
      return ordered;
    });
  };

  const restore = () => {
    const next = resetAdrColumns(userKey);
    setCols(next);
  };

  const openRow = (row) => {
    setOpenId(row.id);
    setHist([]);
    api.get(`/adrs/history/${row.id}`, { params: { range }, timeout: 12000 })
      .then((r) => setHist(r.data?.items || []))
      .catch(() => setHist([]));
  };

  useEffect(() => {
    if (!openId) return;
    api.get(`/adrs/history/${openId}`, { params: { range }, timeout: 12000 })
      .then((r) => setHist(r.data?.items || []))
      .catch(() => {});
  }, [range, openId]);

  const detail = (snap?.items || []).find((r) => r.id === openId);
  const configured = Array.isArray(snap?.items) ? snap.items.length : 0;

  const headerSort = (id) => {
    if (sortKey === id) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(id); setSortDir(id === "company" ? "asc" : "desc"); }
  };

  return (
    <div className="space-y-3" data-testid="adr-page">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageBrandTitle kicker="Indian ADR Market Monitor" title="ADRs" testId="adr-title" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold" data-testid="adr-us-status">
            {snap?.us_market_label || "US Market"}
          </span>
          <span className="text-[11px] text-slate-500 font-mono-data" data-testid="adr-last-update">
            Last Update: {formatIstStamp(snap?.last_update)}
          </span>
        </div>
      </div>

      {snap?.summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
          {[
            ["ADR Coverage", snap.summary.configured],
            ["Gainers", snap.summary.gainers],
            ["Losers", snap.summary.losers],
            ["Large Moves", snap.summary.large_moves],
            ["US Market", snap.summary.us_market],
          ].map(([k, v]) => (
            <div key={k} className="rounded-sm border border-slate-200 dark:border-slate-700 px-2 py-1.5 bg-white dark:bg-slate-900">
              <div className="uppercase tracking-wide text-slate-400 text-[10px]">{k}</div>
              <div className="font-semibold font-mono-data">{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-slate-400" />
          <Input data-testid="adr-search" className="h-8 pl-7 text-xs" placeholder="Search ADRs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-sm" data-testid="adr-filters">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> Filters
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ADR_FILTERS.map((f) => (
              <DropdownMenuItem key={f.id} onSelect={() => setFilt(f.id)} data-testid={`adr-filter-${f.id}`}>
                {f.label}{filt === f.id ? " ✓" : ""}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-sm" data-testid="adr-columns">
              <Columns3 className="w-3.5 h-3.5 mr-1" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(70vh,24rem)] overflow-y-auto">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            {ADR_COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={cols.includes(c.id)}
                onCheckedChange={() => toggleCol(c.id)}
                onSelect={(e) => e.preventDefault()}
                data-testid={`adr-col-${c.id}`}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={restore} data-testid="adr-col-reset">Restore defaults</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading && !snap ? <p className="text-sm text-slate-500">Loading ADR quotes…</p> : null}
      {err ? <p className="text-sm text-rose-600" data-testid="adr-error">Could not load ADRs: {String(err)}</p> : null}
      {!loading && !err && configured === 0 ? (
        <div className="rounded-md border border-slate-200 p-6 text-center" data-testid="adr-empty">
          <p className="text-sm font-semibold">No ADRs configured</p>
          {isAdmin ? (
            <Button type="button" size="sm" className="mt-2 rounded-sm" onClick={onOpenAdmin}>Configure ADRs</Button>
          ) : (
            <p className="text-xs text-slate-500 mt-1">Ask an admin to enable the Indian ADR universe.</p>
          )}
        </div>
      ) : null}

      {configured > 0 ? (
        <div className="overflow-x-auto oi-hover-scroll border border-slate-200 dark:border-slate-700 rounded-sm bg-white dark:bg-slate-900">
          <table className="w-full text-[11px] min-w-[52rem]" data-testid="adr-table">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                {visibleCols.map((c) => (
                  <th
                    key={c.id}
                    className={`text-left font-semibold px-2 py-1.5 whitespace-nowrap ${c.sticky ? "sticky left-0 z-10 bg-slate-50 dark:bg-slate-800" : ""} ${c.sortable ? "cursor-pointer" : ""}`}
                    onClick={() => c.sortable && headerSort(c.id)}
                  >
                    {c.label}{sortKey === c.id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
                <th className="w-8 px-1.5 py-1.5" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`adr-row-${row.adr_symbol}`}
                  className={`border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 cursor-pointer ${row.large_move ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}`}
                  onClick={() => openRow(row)}
                >
                  {visibleCols.map((c) => {
                    const tone = (c.kind === "pct" || c.kind === "usdSigned") ? toneClass(moveTone(row[c.id])) : "";
                    const text = formatAdrCell(c, row);
                    return (
                      <td
                        key={c.id}
                        className={`px-2 py-1.5 whitespace-nowrap font-mono-data ${c.sticky ? "sticky left-0 bg-white dark:bg-slate-900 font-sans font-semibold text-slate-900 dark:text-slate-100" : ""} ${tone}`}
                      >
                        {c.id === "company" ? (
                          <span className="font-sans inline-flex items-center gap-1.5 min-w-0">
                            <ListingFlag country={listingCountryCode(row)} />
                            <span className="font-semibold truncate">{row.company_name}</span>
                            {row.large_move ? <Badge className="ml-1 rounded-sm text-[9px] px-1 py-0 bg-rose-600">LARGE MOVE</Badge> : null}
                          </span>
                        ) : c.id === "adr_symbol" ? (
                          <span className="font-semibold tracking-wide">{row.adr_symbol}</span>
                        ) : text}
                      </td>
                    );
                  })}
                  <td className="px-1.5 py-1.5 w-8 text-center">
                    <Clock
                      className={`w-3.5 h-3.5 inline-block ${isAdrSessionOpen(row) ? "text-emerald-600" : "text-rose-500"}`}
                      strokeWidth={2.25}
                      aria-label={isAdrSessionOpen(row) ? "Market open" : "Market closed"}
                      title={isAdrSessionOpen(row) ? "Market open" : "Market closed"}
                      data-testid={`adr-clock-${row.adr_symbol}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Sheet open={!!detail} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="adr-detail">
          <SheetHeader>
            <SheetTitle>
              <span className="mr-1.5 inline-flex align-middle"><ListingFlag country={listingCountryCode(detail)} /></span>
              {detail?.company_name} · {detail?.adr_symbol}
            </SheetTitle>
          </SheetHeader>
          {detail ? (
            <div className="mt-3 space-y-2 text-xs">
              <div className="text-lg font-mono-data font-bold">{usdPrice(detail.last_price)} <span className={toneClass(moveTone(detail.change_percent))}>{usdSigned(detail.change)} ({pctSigned(detail.change_percent)})</span></div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>Indian {detail.indian_symbol}</div>
                <div>Ratio {detail.adr_ratio}</div>
                <div>{detail.exchange} · {detail.sector}</div>
                <div>{detail.display_status === "LAST_KNOWN" ? "Using Last Successful Data" : formatAdrCell({ id: "market_status" }, detail)}</div>
                <div>Vol {fmtVolume(detail.volume)}</div>
                <div>Avg {fmtVolume(detail.average_volume)}</div>
                <div>52W {detail.week52_range || `${usdPrice(detail.week52_low)} – ${usdPrice(detail.week52_high)}`}</div>
                <div>1D {pctSigned(detail.rolling_1d_change)} · 7D {pctSigned(detail.rolling_7d_change)}</div>
                <div className="col-span-2">Updated {formatIstStamp(detail.fetched_at)} · {detail.provider}</div>
                <div className="col-span-2">Indices {detail.indices?.length ? detail.indices.join(", ") : "—"}</div>
              </div>
              <div className="flex gap-1">
                {["1D", "5D", "1M"].map((r) => (
                  <Button key={r} type="button" size="sm" variant={range === r ? "default" : "outline"} className="h-7 rounded-sm" onClick={() => setRange(r)}>{r}</Button>
                ))}
              </div>
              <div className="h-40 w-full">
                {hist.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hist.map((h) => ({ t: h.timestamp, px: h.last_price }))}>
                      <XAxis dataKey="t" hide />
                      <YAxis domain={["auto", "auto"]} width={40} tick={{ fontSize: 10 }} />
                      <ReTooltip formatter={(v) => usdPrice(v)} />
                      <Line type="monotone" dataKey="px" stroke="#059669" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-slate-400 pt-8 text-center">No historical observations yet for {range}.</p>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
