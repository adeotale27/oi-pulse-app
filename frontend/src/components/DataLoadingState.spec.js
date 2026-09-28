import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DataLoadingState from "./DataLoadingState";

jest.mock("recharts", () => {
  const React = require("react");
  const PassThrough = ({ children }) => React.createElement("div", null, children);
  const Empty = () => null;
  return {
    ResponsiveContainer: PassThrough,
    BarChart: PassThrough,
    Bar: Empty,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    Tooltip: Empty,
    Legend: Empty,
    ReferenceLine: Empty,
  };
});

jest.mock("@/lib/positionsBook", () => ({
  readPositionsBook: () => null,
  subscribePositionsBook: () => () => {},
}));

jest.mock("@/lib/oiPositionMarks", () => ({
  openOiMarks: () => [],
  formatMarkHover: () => "",
  isMarkNearAtm: () => false,
  strikeKey: (value) => String(value),
  peTopKey: () => "",
  ceTopKey: () => "",
}));

jest.mock("@/lib/marketTimes", () => ({
  isPositionMarkGlowActive: () => false,
}));

import OIChart from "./OIChart";

describe("DataLoadingState", () => {
  it("shows the branded startup message with accessible reduced-motion animation", () => {
    const markup = renderToStaticMarkup(React.createElement(DataLoadingState));

    expect(markup).toContain("StrikLenz is brewing data…");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).toContain("data-loading-logo-frame");
    expect(markup).toContain("oi-pulse-logo");
  });

  it("keeps refresh state compact and distinct from panel loading", () => {
    const inline = renderToStaticMarkup(
      React.createElement(DataLoadingState, { variant: "inline", label: "Updating…" }),
    );
    const panel = renderToStaticMarkup(
      React.createElement(DataLoadingState, { variant: "panel", label: "Brewing OI data…" }),
    );

    expect(inline).toContain("Updating…");
    expect(inline).toContain("inline-flex");
    expect(panel).toContain("Brewing OI data…");
    expect(panel).toContain("min-h-[10rem]");
  });

  it("stops the OI loading animation and explains missing snapshots after a failed fetch", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OIChart, {
        current: { strikes: [] },
        loading: false,
      }),
    );

    expect(markup).toContain("Live OI data is unavailable");
    expect(markup).toContain('data-testid="oi-chart-unavailable"');
    expect(markup).not.toContain("Brewing OI data…");
  });

  it("shows a compact OI loader only while the first snapshot is being requested", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OIChart, {
        current: { strikes: [] },
        loading: true,
      }),
    );

    expect(markup).toContain("Brewing OI data…");
    expect(markup).toContain('aria-busy="true"');
  });

  it("keeps the OI chart mounted and labels a refresh when a snapshot exists", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OIChart, {
        current: {
          index: "NIFTY",
          price: 25000,
          strikes: [{ strike: 25000, pe_oi: 100, ce_oi: 120 }],
        },
        updating: true,
      }),
    );

    expect(markup).toContain('data-testid="oi-chart"');
    expect(markup).toContain("Updating…");
    expect(markup).not.toContain("Brewing OI data…");
  });
});
