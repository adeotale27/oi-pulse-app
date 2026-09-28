import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MaintenanceScreen from "./MaintenanceScreen";

jest.mock("@/hooks/useLiveDemo", () => ({
  __esModule: true,
  default: () => ({
    chain: { rows: [] },
    indices: {
      NIFTY: { price: 0, changePct: 0 },
      SENSEX: { price: 0, changePct: 0 },
      BANKNIFTY: { price: 0, changePct: 0 },
    },
  }),
  isMarketOpenNow: () => false,
}));

jest.mock("@/lib/api", () => ({
  fetchExtras: jest.fn(),
  fetchTickers: jest.fn(),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_, element) => element }),
}));

describe("MaintenanceScreen", () => {
  it("fits the viewport without scrolling or offering admin sign-in", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MaintenanceScreen, { onRetry: () => {} }),
    );

    expect(markup).toContain("h-[100dvh]");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("Try the desk again");
    expect(markup).toContain("maintenance-nifty-card");
    expect(markup).toContain("maintenance-robot-scale");
    expect(markup).not.toContain("Admin sign in");
  });
});
