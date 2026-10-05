import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AlertsPanel from "./AlertsPanel";

jest.mock("@/components/PageBrandTitle", () => ({
  __esModule: true,
  default: ({ title }) => <h2>{title}</h2>,
}));

describe("AlertsPanel", () => {
  it("labels fictional walkthrough alerts without changing live alert rows", () => {
    const markup = renderToStaticMarkup(
      <AlertsPanel
        activeIndex="NIFTY"
        canClear={false}
        alerts={[
          {
            created_at: "2026-10-06T04:00:00.000Z",
            index: "NIFTY",
            direction: "Bullish OI reversal",
            price: 24350,
            atm: 24350,
            strikes: [24300, 24350, 24400],
            sample: true,
          },
          {
            created_at: "2026-10-06T03:59:00.000Z",
            index: "NIFTY",
            direction: "Put writing",
            price: 24340,
            atm: 24350,
            strikes: [24300, 24350, 24400],
          },
        ]}
      />,
    );

    expect(markup.match(/data-testid="sample-alert-badge"/g)).toHaveLength(1);
    expect(markup).toContain("Sample");
    expect(markup).toContain("Put writing");
  });
});
