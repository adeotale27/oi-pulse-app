import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MarketIntelPopup from "./MarketIntelPopup";
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
});
