import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RiskManagementPanel from "./RiskManagementPanel";
import { classifyDayCapital } from "@/lib/capitalGuard";

const liveOption = {
  exchange: "NFO",
  tradingsymbol: "NIFTY26OCT25000CE",
  display_name: "NIFTY 25,000 CE",
  index: "NIFTY",
  side: "CE",
  isOpt: true,
  strike: 25000,
  expiry_iso: "2026-10-29",
  spotUsed: 25000,
  last_price: 125,
  average_price: 110,
  extrinsicLeft: 360,
  unrealised: 1125,
  quantity: -75,
  lot_size: 75,
  multiplier: 1,
  dte: 7,
  iv: 20,
  delta: 0.5,
  gamma: 0.001,
  theta: -10,
  greeksHealth: "ok",
};

describe("RiskManagementPanel", () => {
  it("renders live risk summaries and both compact mobile cards and desktop table", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [liveOption],
        pnlToday: { total: 5200, booked: 700, unbooked: 4500 },
        lastRefresh: new Date().toISOString(),
      }),
    );

    expect(markup).toContain("Today’s P&amp;L");
    expect(markup).toContain("₹5,200");
    expect(markup).toContain("Booked ₹700 · open ₹4,500 · updated");
    expect(markup).toContain("Premium captured");
    expect(markup).toContain("−₹1,125");
    expect(markup).toContain("-13.6% vs entry · LTP mark, not booked; before costs");
    expect(markup).toContain("Open P&amp;L");
    expect(markup).toContain("Premium left to decay");
    expect(markup).toContain("Remaining time value · not profit; before hedge costs");
    expect(markup).toContain("₹360");
    expect(markup).toContain("Net Delta · ₹ / 1%");
    expect(markup).toContain("Alerts to check");
    expect(markup).toContain("What could change your open-position value?");
    expect(markup).toContain("Short positions &amp; hedges");
    expect(markup).toContain("Strike breakdown &amp; what-if estimates");
    expect(markup).toContain("Combined estimates");
    expect(markup).toContain('data-testid="risk-positions-table"');
    expect(markup).toContain('data-testid="risk-position-cards"');
    expect(markup).toContain('data-testid="risk-distribution"');
    expect(markup).toContain('data-testid="risk-advanced-data"');
    expect(markup).toContain("Extra whole-book estimates");
    expect(markup).toContain("P&amp;L and risk checked");
    expect(markup).toContain("Option quote time is not provided by the Positions feed.");
    expect(markup).toContain("Captured on open short");
    expect(markup.indexOf('data-testid="risk-advanced-data"'))
      .toBeLessThan(markup.indexOf("What could change your open-position value?"));
    expect(markup).toContain("High alert");
    expect(markup).not.toMatch(/<details[^>]*open/);
  });

  it("keeps missing Greeks and stale broker reads explicit instead of showing zero exposure", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [{ ...liveOption, gamma: null, greeksHealth: "iv_na" }],
        lastRefresh: new Date(Date.now() - 600000).toISOString(),
        dataError: "Broker quote unavailable",
      }),
    );

    expect(markup).toContain("Need data");
    expect(markup).toContain("Broker quote unavailable");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Kite’s option quote timestamp is not included");
    expect(markup).toContain("Positions data is stale");
    expect(markup).toContain("We can’t estimate the whole book");
    expect(markup).toContain("Guard data unavailable");
    expect(markup).toContain("Kite available margin");
  });

  it("labels bought legs as hedges and aligns every expiry package by ascending strike", () => {
    const expiry = "2026-10-29";
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [
          {
            ...liveOption,
            tradingsymbol: "NIFTY26OCT25000CE",
            display_name: "NIFTY 25,000 CE",
            expiry_iso: expiry,
            strike: 25000,
            quantity: 75,
          },
          {
            ...liveOption,
            tradingsymbol: "NIFTY26OCT24800PE",
            display_name: "NIFTY 24,800 PE",
            expiry_iso: expiry,
            side: "PE",
            strike: 24800,
            delta: -0.5,
            quantity: -75,
          },
        ],
        lastRefresh: new Date().toISOString(),
      }),
    );
    const table = markup.slice(
      markup.indexOf('data-testid="risk-positions-table"'),
      markup.indexOf('data-testid="risk-position-cards"'),
    );

    expect(table.indexOf("NIFTY 24,800 PE")).toBeLessThan(table.indexOf("NIFTY 25,000 CE"));
    expect(table).toContain("NIFTY · 2026-10-29");
    expect(table).toContain("not a broker strategy");
    expect(markup).toContain("Hedge leg");
    expect(markup).toContain("Bought hedge leg.");
  });

  it("explains near-strike short alerts with the leg name and its distance", () => {
    const markedNearStrike = {
      ...liveOption,
      breachedAdjust: true,
      breachInfo: { distancePct: "0.75", coveredPct: "75" },
    };
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [
          markedNearStrike,
          {
            ...liveOption,
            quantity: 75,
            tradingsymbol: "NIFTY26OCT25000CE-HEDGE",
          },
        ],
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("NIFTY 25,000 CE: spot is 0.75% from this sold strike.");
    expect(markup).toContain("Near sold strike");
    expect(markup).toContain("0 high · 0 watch · 1 near strike · 0 need data");
    expect(markup).toContain("Urgency / risk");
    expect(markup).toContain("Check now");
    expect(markup).toContain("Same-strike bought units 75");
    expect(markup).toContain("Still sold 0 units");
    expect(markup).toContain("bought quantity is a comparison only");
  });

  it("adds expiry attention only when the existing expiry-day and near-strike checks both apply", () => {
    const nearStrikeExpiry = {
      ...liveOption,
      onExpiryDay: true,
      dte: 0.4,
      breachedAdjust: true,
      breachInfo: { distancePct: "0.75", coveredPct: "75" },
    };
    const expiryNotNearStrike = {
      ...liveOption,
      tradingsymbol: "NIFTY26OCT25100CE",
      display_name: "NIFTY 25,100 CE",
      strike: 25100,
      onExpiryDay: true,
      dte: 0.4,
    };
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [nearStrikeExpiry, expiryNotNearStrike],
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("Expiry today + near strike");
    expect(markup).toContain("NIFTY 25,000 CE: expiry is today and spot is 0.75%");
    expect(markup).not.toContain("NIFTY 25,100 CE: expiry is today");
  });

  it("shows the existing daily-loss thresholds and actual available-margin context", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [],
        dayCapital: classifyDayCapital({ bookedPct: -4, leftover: 50000, wallet: 1000000 }),
        dayBookedPct: -4,
        fundsLeftover: 50000,
        wallet: 1000000,
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("Daily loss &amp; margin guard");
    expect(markup).toContain("Caution");
    expect(markup).toContain("-4.00% of wallet");
    expect(markup).toContain("Caution -3% · stop adds -5% · defend -8%");
    expect(markup).toContain("₹50,000 · 5.00% of wallet");
    expect(markup).toContain("Existing low-margin stop: available funds below 0.5% of wallet.");
  });

  it("puts near-strike shorts first without hiding regular positions", () => {
    const regular = {
      ...liveOption,
      display_name: "NIFTY 25,200 CE",
      tradingsymbol: "NIFTY26OCT25200CE",
      strike: 25200,
    };
    const nearStrike = {
      ...liveOption,
      display_name: "NIFTY 24,900 PE",
      tradingsymbol: "NIFTY26OCT24900PE",
      side: "PE",
      strike: 24900,
      delta: -0.5,
      breachedAdjust: true,
      breachInfo: { distancePct: "0.75", coveredPct: "75" },
    };
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [regular, nearStrike],
        lastRefresh: new Date().toISOString(),
      }),
    );
    const table = markup.slice(
      markup.indexOf('data-testid="risk-positions-table"'),
      markup.indexOf('data-testid="risk-position-cards"'),
    );
    expect(table.indexOf("NIFTY 24,900 PE")).toBeLessThan(table.indexOf("NIFTY 25,200 CE"));
    expect(table).toContain("NIFTY 25,200 CE");
    expect(table).toContain("NIFTY 24,900 PE");
  });

  it("shows same-strike hedge quantities and remaining short size", () => {
    const expiry = "2026-10-29";
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [
          { ...liveOption, quantity: -75, strike: 25000, expiry_iso: expiry },
          {
            ...liveOption,
            quantity: 25,
            strike: 25000,
            expiry_iso: expiry,
            tradingsymbol: "NIFTY26OCT25000CE-HEDGE",
          },
        ],
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("CE still short");
    expect(markup).toContain("50 still sold · 33% offset");
    expect(markup).toContain("Coverage compares only the same index, expiry, strike and option type.");
    expect(markup).toContain("not proof of a broker strategy");
  });

  it("shows a clear empty state for an empty open book", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [],
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("No open positions in the current Kite book.");
  });

  it("shows unavailable instead of inventing today's P&L or seller decay", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RiskManagementPanel, {
        rows: [{ ...liveOption, extrinsicLeft: null }],
        lastRefresh: new Date().toISOString(),
      }),
    );
    expect(markup).toContain("Today’s P&amp;L");
    expect(markup).toContain("Broker total · updated");
    expect(markup).toContain("Premium left to decay");
    expect(markup).toContain("Premium captured");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("1 sold option(s) need data");
  });
});
