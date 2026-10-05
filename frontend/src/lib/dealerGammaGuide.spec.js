import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { dealerGammaGuide, formatGexSnapshotTime } from "./metricGuides";
import { computeDealerGamma, formatGexExposure } from "./sellCandidates";
import { bsPrice } from "./blackScholes";

describe("dealer gamma guide", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it.each([
    [0.75, "positive", "Moves may be calmer"],
    [0, "neutral", "No clear GEX clue"],
    [-0.75, "negative", "Moves could get faster"],
  ])("shows the %s reading in plain language", async (gexValue, zone, reading) => {
    await act(async () => {
      root.render(dealerGammaGuide(gexValue));
    });

    expect(container.querySelector(`[data-testid="gex-zone-${zone}"]`)?.getAttribute("aria-current"))
      .toBe("true");
    expect(container.querySelector('[data-testid="gex-simple-reading"]')?.textContent).toContain(reading);
    expect(container.querySelector('[data-testid="gex-current-threshold"]')).not.toBeNull();
    expect(container.textContent).toContain("Use as context only—not a buy/sell instruction.");
    expect(container.textContent).toContain("NSE does not publish trade sides");
    expect(container.textContent).toContain("not money known to be held or traded by dealers");
  });

  it.each([
    [0.5, "neutral"],
    [-0.5, "neutral"],
  ])("keeps the exact %s boundary in the neutral range", async (gexValue, zone) => {
    await act(async () => {
      root.render(dealerGammaGuide(gexValue));
    });

    expect(container.querySelector(`[data-testid="gex-zone-${zone}"]`)?.getAttribute("aria-current"))
      .toBe("true");
  });

  it("shows explicit cutoffs with plain-language meanings", async () => {
    await act(async () => {
      root.render(dealerGammaGuide(0.75));
    });

    expect(container.querySelector('[data-testid="gex-zone-positive"]')?.textContent)
      .toContain("> +₹0.5 L Cr");
    expect(container.querySelector('[data-testid="gex-zone-neutral"]')?.textContent)
      .toContain("−₹0.5 to +₹0.5 L Cr");
    expect(container.querySelector('[data-testid="gex-zone-negative"]')?.textContent)
      .toContain("< −₹0.5 L Cr");
    expect(container.querySelector('[data-testid="gex-current-value"]')?.textContent)
      .toContain("+₹0.8 L Cr");
    expect(container.querySelector('[data-testid="gex-current-threshold"]')?.textContent)
      .toContain("Your value is above +₹0.5 L Cr.");
    expect(container.textContent).toContain("₹0.5 L Cr means ₹50,000 crore");
  });

  it("highlights no zone and explains unavailable readings", async () => {
    await act(async () => {
      root.render(dealerGammaGuide(null));
    });

    expect(container.querySelector('[aria-current="true"]')).toBeNull();
    expect(container.textContent).toContain("Waiting for option-chain data");
  });

  it("shows the largest strike concentrations with their sign and non-support disclaimer", async () => {
    await act(async () => {
      root.render(dealerGammaGuide(0.2, {
        byStrike: [
          { strike: 22000, gexLakhCrorePer1Pct: 8.2 },
          { strike: 22100, gexLakhCrorePer1Pct: -5.4 },
          { strike: 21900, gexLakhCrorePer1Pct: 2.1 },
        ],
        updatedAt: "2026-10-05T10:00:00.000Z",
        spot: 21800,
        expiry: "2026-10-08",
      }));
    });

    expect(container.querySelectorAll('[data-testid^="gex-strike-"]:not([data-testid="gex-strike-concentration"])'))
      .toHaveLength(3);
    expect(container.querySelector('[data-testid="gex-strike-22000"]')?.textContent).toContain("+₹8.2 L Cr");
    expect(container.querySelector('[data-testid="gex-strike-22100"]')?.textContent).toContain("−₹5.4 L Cr");
    expect(container.textContent).toContain("not support or resistance");
    expect(container.textContent).toContain("Snapshot:");
    expect(container.textContent).toContain("3:30 pm IST");
    expect(container.textContent).toContain("estimated hedging value for a 1% index move");
    expect(container.textContent).toContain("assumes calls add positive gamma and puts negative gamma");
    expect(container.textContent).toContain("NSE does not publish trade sides");
    expect(container.textContent).toContain("Estimated call-side (green) / put-side (red) concentration");
    expect(container.textContent).toContain("Expiry: 2026-10-08");
    expect(container.textContent).toContain("index 21,800");
    expect(container.textContent).toContain("+200 points from index");
    expect(container.querySelector('[data-testid="gex-details"]')?.open).toBe(false);
    const zoneLayout = container.querySelector('[aria-label="GEX thresholds and meanings"]')?.className;
    expect(zoneLayout).toContain("grid-cols-3");
    expect(container.querySelectorAll('[data-testid^="gex-strike-"]:not([data-testid="gex-strike-concentration"])'))
      .toHaveLength(3);
  });

  it("reports invalid snapshot timestamps without inventing a time", async () => {
    await act(async () => {
      root.render(dealerGammaGuide(20, { byStrike: [], updatedAt: "not-a-date" }));
    });

    expect(container.textContent).toContain("Snapshot: time unavailable");
  });

  it("formats estimated rupee exposure in lakh, crore, and lakh-crore units", () => {
    expect(formatGexExposure(3.117)).toBe("+₹3.1 L Cr");
    expect(formatGexExposure(3.117, 0)).toBe("+₹3 L Cr");
    expect(formatGexExposure(0.5)).toBe("+₹0.5 L Cr");
    expect(formatGexExposure(0.000005)).toBe("+₹50 L");
    expect(formatGexExposure(-50)).toBe("−₹50.0 L Cr");
    expect(formatGexExposure(0)).toBe("₹0 L");
    expect(formatGexExposure(null)).toBe("—");
  });

  it("returns additive per-strike GEX contributions that sum to the total", () => {
    const spot = 100;
    const T = 0.1;
    const r = 0.065;
    const sigma = 0.2;
    const result = computeDealerGamma({
      strikes: [
        {
          strike: 100,
          ce_ltp: bsPrice(spot, 100, T, r, sigma, true),
          pe_ltp: bsPrice(spot, 100, T, r, sigma, false),
          ce_oi: 100,
          pe_oi: 20,
        },
        {
          strike: 110,
          ce_ltp: bsPrice(spot, 110, T, r, sigma, true),
          pe_ltp: bsPrice(spot, 110, T, r, sigma, false),
          ce_oi: 10,
          pe_oi: 5,
        },
      ],
      spot,
      T,
      r,
      indexName: "NIFTY",
    });

    expect(result.byStrike).toHaveLength(2);
    expect(result.byStrike[0].gexLakhCrorePer1Pct).not.toBe(0);
    expect(result.byStrike[1].gexLakhCrorePer1Pct).not.toBe(0);
    expect(result.gexLakhCrorePer1Pct).toBeCloseTo(
      result.byStrike.reduce((sum, point) => sum + point.gexLakhCrorePer1Pct, 0),
    );
  });
});
