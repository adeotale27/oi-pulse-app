import { compactBookFromPositions, fmtOiLakh, summarizeIndexTape } from "./deskAiTape";

describe("deskAiTape", () => {
  const current = {
    index: "NIFTY",
    price: 24501.4,
    atm: 24500,
    pcr: 0.91,
    expiry: "2026-08-20",
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
    const t = summarizeIndexTape(current, previous);
    expect(t.idx).toBe("NIFTY");
    expect(t.callWall).toBe(24600);
    expect(t.putWall).toBe(24400);
    expect(t.ceChg).toBe(140);
    expect(t.peChg).toBe(90);
    expect(fmtOiLakh(120000)).toBe("+1.2L");
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
});
