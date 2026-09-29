import { compactBookFromPositions, compactTradeMemory, fmtOiLakh, summarizeIndexTape, tapeFromBiasRow } from "./deskAiTape";

describe("deskAiTape", () => {
  const current = {
    index: "NIFTY",
    price: 24501.4,
    atm: 24500,
    pcr: 0.91,
    expiry: "2026-08-20",
    timestamp: "2026-08-20T09:30:00+05:30",
    strikes: [
      { strike: 24400, ce_oi: 100, pe_oi: 500 },
      { strike: 24500, ce_oi: 200, pe_oi: 200 },
      { strike: 24600, ce_oi: 800, pe_oi: 50 },
    ],
  };
  const previous = {
    strikes: [
      { strike: 24400, ce_oi: 80, pe_oi: 400 },
      { strike: 24500, ce_oi: 180, pe_oi: 220 },
      { strike: 24600, ce_oi: 700, pe_oi: 40 },
    ],
  };

  test("summarizes walls and OI change", () => {
    const t = summarizeIndexTape(current, previous, { label: "LIVE" });
    expect(t.idx).toBe("NIFTY");
    expect(t.callWall).toBe(24600);
    expect(t.putWall).toBe(24400);
    expect(t.ceChg).toBe(140);
    expect(t.peChg).toBe(90);
    expect(t.asOf).toBe("2026-08-20T09:30:00+05:30");
    expect(t.dataStatus).toBe("LIVE");
    expect(fmtOiLakh(120000)).toBe("+1.2L");
  });

  test("carries freshness metadata from Overnight Hold bias rows", () => {
    const tape = tapeFromBiasRow({
      index: "SENSEX",
      bias: { ce: 10, pe: 20 },
      asOf: "2026-08-20T09:30:00+05:30",
      dataStatus: "STALE",
    });
    expect(tape.asOf).toBe("2026-08-20T09:30:00+05:30");
    expect(tape.dataStatus).toBe("STALE");
  });

  test("compactBookFromPositions drops exited longs", () => {
    const packed = compactBookFromPositions({
      positions: [
        { tradingsymbol: "NIFTY25C24500", quantity: -75, strike: 24500, side: "CE", index: "NIFTY", exited: false, spot: 24400 },
        { tradingsymbol: "GONE", quantity: 0, strike: 1, side: "PE", exited: true },
      ],
    });
    expect(packed.book.shortCount).toBe(1);
    expect(packed.adjust.legs[0].itm).toBe(false);
  });

  test("compacts aggregated trade memory without carrying individual-cycle identifiers", () => {
    const packed = compactTradeMemory({
      lines: ["NIFTY CE shorts: 3/4 paid; avg P&L +20"],
      summary: { closed_cycles: 4, sample_quality: "descriptive", expectancy: 20, win_rate: 75 },
      process: { cycles: 4, avg_holding_minutes: 42, carried_n: 1, carried_rate_pct: 25 },
      buckets: [{
        index: "NIFTY", side: "CE", direction: "short", n: 4, wins: 3,
        losses: 1, expectancy: 20, sample_quality: "descriptive",
      }],
      owner_id: "never-forward",
      cycles: [{ cycle_id: "never-forward", tradingsymbol: "secret" }],
    });
    expect(packed.summary.closed_cycles).toBe(4);
    expect(packed.buckets[0].direction).toBe("short");
    expect(packed.buckets[0].sample_quality).toBe("descriptive");
    expect(packed.process.avg_holding_minutes).toBe(42);
    expect(JSON.stringify(packed)).not.toContain("never-forward");
    expect(JSON.stringify(packed)).not.toContain("tradingsymbol");
  });

  test("keeps failed memory reads distinct from genuine empty history", () => {
    expect(compactTradeMemory({ status: "unavailable" })).toEqual({
      status: "unavailable",
      lines: [],
    });
    expect(compactTradeMemory({
      lines: ["Insufficient history: 0 closed option cycles"],
      summary: { closed_cycles: 0, sample_quality: "insufficient" },
    }).summary.closed_cycles).toBe(0);
  });
});
