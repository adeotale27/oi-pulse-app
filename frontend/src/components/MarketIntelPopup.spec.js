import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MarketIntelPopup, { collectNewMarketIntelItems } from "./MarketIntelPopup";
import { MI_POPUP_LEFT_KEY, MI_POPUP_MIN_KEY } from "@/lib/marketIntel";

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

});
