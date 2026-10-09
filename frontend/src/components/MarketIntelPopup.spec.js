import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MarketIntelPopup, { collectNewMarketIntelItems } from "./MarketIntelPopup";
import { MI_POPUP_LEFT_KEY, MI_POPUP_MIN_KEY } from "@/lib/marketIntel";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    get: jest.fn(() => new Promise(() => {})),
    post: jest.fn(),
  },
}));

describe("MarketIntelPopup docking", () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(MI_POPUP_MIN_KEY, JSON.stringify({ until: Date.now() + 60_000 }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("opens on the right by default and can snap to each desktop position", async () => {
    await act(async () => {
      root.render(<MarketIntelPopup enabled />);
    });

    await act(async () => {
      container.querySelector('[data-testid="market-intel-popup-chip"]').click();
    });

    const popup = container.querySelector('[data-testid="market-intel-popup"]');
    const width = Math.min(320, window.innerWidth - 16);
    expect(Number.parseInt(popup.style.left, 10)).toBe(window.innerWidth - width - 12);

    await act(async () => {
      container.querySelector('[aria-label="Snap market intelligence left"]').click();
    });
    expect(popup.style.left).toBe("12px");

    await act(async () => {
      container.querySelector('[aria-label="Snap market intelligence to center"]').click();
    });
    expect(Number.parseInt(popup.style.left, 10)).toBe(Math.round((window.innerWidth - width) / 2));

    await act(async () => {
      container.querySelector('[aria-label="Snap market intelligence right"]').click();
    });
    expect(Number.parseInt(popup.style.left, 10)).toBe(window.innerWidth - width - 12);
    expect(localStorage.getItem(MI_POPUP_LEFT_KEY)).toBe(String(window.innerWidth - width - 12));
  });

  it("keeps the minimized phone chip fixed to the bottom-right despite a saved desktop position", async () => {
    localStorage.setItem(MI_POPUP_LEFT_KEY, "140");
    jest.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 767px)",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    expect(window.matchMedia("(max-width: 767px)").matches).toBe(true);

    await act(async () => {
      root.render(<MarketIntelPopup enabled />);
    });

    const chip = container.querySelector('[data-testid="market-intel-popup-chip"]');
    expect(chip.style.left).toBe("");
    expect(chip.style.right).toBe("12px");
    expect(chip.style.bottom).toBe("52px");
    expect(localStorage.getItem(MI_POPUP_LEFT_KEY)).toBe("140");
  });

  it("suppresses the existing queue and returns each newly arriving Market Intel story once", () => {
    const seenIds = new Set();
    const previousStory = { event_cluster_id: "old-story", title: "Previously queued story", impact_band: "HIGH" };
    const newStory = { event_cluster_id: "new-story", title: "New RBI announcement", impact_band: "CRITICAL" };
    expect(collectNewMarketIntelItems([previousStory], seenIds, false)).toEqual([]);
    expect(collectNewMarketIntelItems([newStory, previousStory], seenIds, true)).toEqual([newStory]);
    expect(collectNewMarketIntelItems([newStory, previousStory], seenIds, true)).toEqual([]);
  });

  it("shows the rule-assessed market direction in the news popup", async () => {
    jest.useFakeTimers();
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    localStorage.removeItem(MI_POPUP_MIN_KEY);
    api.get.mockResolvedValueOnce({
      data: {
        items: [{
          event_cluster_id: "rbi-rate-cut",
          title: "RBI cuts repo rate",
          impact_band: "HIGH",
          impact_score: 78,
          market_direction: "SUPPORTIVE",
          direction_basis: "HEADLINE",
          directional_impact_score: 54,
          direction_reason: "Rate-cut language can support equities.",
          source_direction_agreement: "AGREE",
          independent_source_count: 2,
          independent_source_names: ["Reuters", "Economic Times"],
          market_timing: "IN_SESSION",
          news_freshness: "CURRENT",
          published_at_known: true,
          published_at: "2026-10-09T04:00:00Z",
          discovered_at: "2026-10-09T04:01:00Z",
          volatility_risk: "ELEVATED",
          volatility_risk_reason: "Policy catalyst may cause repricing.",
          india_link_reason: "Domestic rates can affect Indian equities.",
        }],
      },
    });

    await act(async () => {
      root.render(<MarketIntelPopup enabled />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mi-popup-direction"]')?.textContent)
      .toBe("Likely market up");
    expect(container.querySelector('[data-testid="mi-popup-direction"]')?.querySelector("svg")?.getAttribute("class"))
      .toContain("h-3");
    expect(container.querySelector('[data-testid="mi-popup-direction"]')?.className).toContain("emerald");
    expect(container.querySelector('[data-testid="mi-popup-direction"]')?.getAttribute("title"))
      .toContain("Direction read from headline.");
    expect(container.querySelector('[data-testid="mi-popup-direction-reason"]')?.textContent)
      .toBe("Rate-cut language can support equities.");
    expect(container.textContent).toContain("Independent reads agree");
    expect(container.textContent).toContain("Reuters / Economic Times");
    expect(container.textContent).toContain("During market hours");
    expect(container.textContent).toContain("Volatility ELEVATED");
    expect(container.querySelector('[data-testid="mi-popup-seller-note"]')?.textContent)
      .toContain("review short-option exposure");
    expect(container.querySelector('[data-testid="mi-popup-india-link"]')?.textContent)
      .toContain("Domestic rates");
    expect(container.querySelector('[data-testid="market-intel-popup"]')?.className).toContain("bg-emerald-50");
  });

  it("colors the news popup red and shows a down arrow for likely market pressure", async () => {
    jest.useFakeTimers();
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    localStorage.removeItem(MI_POPUP_MIN_KEY);
    api.get.mockResolvedValueOnce({
      data: {
        items: [{
          event_cluster_id: "crude-shock",
          title: "Crude jumps after supply disruption",
          impact_band: "HIGH",
          impact_score: 80,
          market_direction: "NEGATIVE",
          direction_basis: "HEADLINE",
          directional_impact_score: -61,
          direction_reason: "Higher crude can pressure India's import bill.",
        }],
      },
    });

    await act(async () => {
      root.render(<MarketIntelPopup enabled />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const direction = container.querySelector('[data-testid="mi-popup-direction"]');
    expect(direction?.textContent).toBe("Likely market down");
    expect(direction?.querySelector("svg")?.getAttribute("class")).toContain("h-3");
    expect(direction?.className).toContain("rose");
    expect(container.querySelector('[data-testid="market-intel-popup"]')?.className).toContain("bg-rose-50");
  });

});
