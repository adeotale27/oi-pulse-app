import { parseTradeCycleArchiveText } from "./tradeCycleArchive";

const archiveName = "striklenz-cycle-archive-2026-06.jsonl.gz";

describe("parseTradeCycleArchiveText", () => {
  it("groups closed cycles by exit date and totals their booked P&L", () => {
    const archive = parseTradeCycleArchiveText([
      JSON.stringify({
        cycle_id: "cycle-a",
        status: "closed",
        exit_date: "2026-06-12",
        booked_pnl: 500,
        closed_quantity: 25,
      }),
      JSON.stringify({
        cycle_id: "cycle-b",
        status: "closed",
        exit_date: "2026-06-12",
        realised: -125.25,
        closed_quantity: 10,
      }),
    ].join("\n"), archiveName);

    expect(archive.count).toBe(2);
    expect(archive.month).toBe("2026-06");
    expect(archive.byDate["2026-06-12"].booked_pnl).toBe(374.75);
    expect(archive.byDate["2026-06-12"].exited_count).toBe(2);
    expect(archive.byDate["2026-06-12"].trade_count).toBe(35);
  });

  it("rejects malformed records, non-closed cycles, and dates outside the archive month", () => {
    expect(() => parseTradeCycleArchiveText("{bad json}", archiveName)).toThrow("line 1 is not valid JSON");
    expect(() => parseTradeCycleArchiveText(JSON.stringify({
      status: "open",
      exit_date: "2026-06-12",
    }), archiveName)).toThrow("not a closed trade cycle");
    expect(() => parseTradeCycleArchiveText(JSON.stringify({
      status: "closed",
      exit_date: "2026-07-01",
    }), archiveName)).toThrow("invalid or out-of-range exit date");
  });

  it("validates range archives inclusively across month boundaries", () => {
    const name = "striklenz-cycle-archive-2026-06-12-to-2026-08-12.jsonl.gz";
    const archive = parseTradeCycleArchiveText(JSON.stringify({
      status: "closed",
      exit_date: "2026-08-12",
      booked_pnl: 50,
    }), name);
    expect(archive.fromDate).toBe("2026-06-12");
    expect(archive.toDate).toBe("2026-08-12");
    expect(archive.count).toBe(1);
    expect(() => parseTradeCycleArchiveText(JSON.stringify({
      status: "closed",
      exit_date: "2026-08-13",
    }), name)).toThrow("invalid or out-of-range exit date");
  });

  it("rejects empty input and unsupported archive names", () => {
    expect(() => parseTradeCycleArchiveText("", archiveName)).toThrow("no trade-cycle records");
    expect(() => parseTradeCycleArchiveText("{}", "trades.jsonl.gz")).toThrow("date range or YYYY-MM month");
  });
});
