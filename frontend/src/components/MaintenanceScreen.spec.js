import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import MaintenanceScreen, { MiniChart } from "./MaintenanceScreen";
import { api, fetchExtras, fetchTickers } from "@/lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/hooks/useLiveDemo", () => ({
  isMarketOpenNow: () => false,
}));

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
  fetchExtras: jest.fn(),
  fetchTickers: jest.fn(),
}));

jest.mock("framer-motion", () => ({
  useReducedMotion: () => false,
  motion: new Proxy({}, { get: (_, element) => element }),
}));

describe("MaintenanceScreen", () => {
  it("uses a fixed phone shell with the chart before the robot and no bench", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MaintenanceScreen, { onRetry: () => {} }),
    );

    expect(markup).toContain("h-[100dvh]");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("maintenance-artwork");
    expect(markup).toContain("maintenance-hero");
    expect(markup).toContain("bg-transparent");
    expect(markup).not.toContain("bg-[#06191b]/90");
    expect(markup).toContain("Try the desk again");
    expect(markup).toContain("maintenance-nifty-card");
    expect(markup).toContain("maintenance-robot-scale");
    expect(markup.indexOf("maintenance-nifty-card")).toBeLessThan(
      markup.indexOf("maintenance-robot"),
    );
    expect(markup).toContain("maintenance-footer");
    expect(markup).toContain("maintenance-status-pill");
    expect(markup).toContain("oi-auth-footer-compact");
    expect(markup).toContain("Loading NIFTY history…");
    expect(markup).not.toContain("25,842.3");
    expect(markup).not.toContain("<polyline");
    expect(markup).not.toContain("bg-gradient-to-b from-slate-700 to-slate-950");
    expect(markup).not.toContain("overflow-y-auto");
    expect(markup).not.toContain("Admin sign in");
  });

  it("plots timestamped NIFTY prices without inventing placeholder values", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MiniChart, {
        points: [
          { timestamp: "2026-09-29T09:15:00+05:30", price: 25000 },
          { timestamp: "2026-09-29T09:30:00+05:30", price: 25100 },
          { timestamp: "2026-09-29T09:45:00+05:30", price: 25200 },
        ],
      }),
    );

    expect(markup).toMatch(/d="M10\.0,\d+\.\d+ C/);
    expect(markup).toMatch(/240\.0,\d+\.\d+"/);
    expect(markup).toContain('stroke-dasharray="0.08 0.92"');
    expect(markup).toContain("<circle");
    expect(markup).toContain("maintenance-chart-pulse");
  });

  it("renders a data-free walkthrough maintenance notice", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MaintenanceScreen, {
        walkthroughUnavailable: true,
        notice: "Please check with the administrator for updates.",
        onRetry: () => {},
      }),
    );

    expect(markup).toContain("StrikLenz is<br");
    expect(markup).toContain("under maintenance.");
    expect(markup).toContain("Please check with the administrator for updates.");
    expect(markup).toContain("Preview temporarily paused");
    expect(markup).not.toContain("Market live");
    expect(markup).not.toContain("Loading NIFTY history");
  });

  it("does not request ticker or history data when the walkthrough is disabled", async () => {
    api.get.mockClear();
    fetchExtras.mockClear();
    fetchTickers.mockClear();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(MaintenanceScreen, {
        walkthroughUnavailable: true,
        onRetry: () => {},
      }));
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(fetchExtras).not.toHaveBeenCalled();
    expect(fetchTickers).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps phone chart and robot in separate, bounded side-by-side areas", () => {
    const styles = readFileSync(join(__dirname, "../styles/landing.css"), "utf8");
    const mobileLayout = styles.slice(
      styles.indexOf("@media (max-width: 767px) {"),
      styles.indexOf("@media (max-width: 767px) and (max-height: 620px) {"),
    );

    expect(mobileLayout).toMatch(/grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(6\.5rem,\s*\.85fr\)/);
    expect(mobileLayout).toMatch(/\.maintenance-page \.maintenance-robot \{\s*grid-column:\s*2;/);
    expect(mobileLayout).toMatch(/\.maintenance-page \.maintenance-robot-scale \{\s*position:\s*absolute;/);
  });
});
