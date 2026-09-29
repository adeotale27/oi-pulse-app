import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MarketIntelCard from "./MarketIntelCard";

describe("MarketIntelCard evidence and session brief", () => {
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

  it("separates AI inference from evidence and reports missing and mixed inputs", async () => {
    await act(async () => {
      root.render(
        <MarketIntelCard
          market={{ phase: "pre_market", session_anchor_date: "2026-09-29" }}
          extras={{
            gift_nifty: {
              change_pct: 0.4,
              source: "kite",
              ts: "2026-09-29T08:58:00+05:30",
            },
          }}
          outside={{
            at: 1790000000,
            breadth: { NIFTY: { adv: 12, dec: 30 } },
            corporate: [{ symbol: "RELIANCE", event_type: "board meeting", days: 0 }],
            news: [{ title: "Timestamped headline", source: "ET", published: "Tue, 29 Sep 2026 08:30:00 +0530" }],
          }}
          guide={{
            source: "llm",
            guide: "BASE CASE\n- Evidence stays conditional\nDO\n- Check the source",
            evidence_quality: {
              level: "limited",
              covered: 1,
              total: 4,
              sources: [{
                name: "Session OI",
                asOf: "2026-09-29T09:15:00+05:30",
                ageMinutes: 2,
                timeKind: "snapshot",
                status: "LIVE",
              }],
            },
          }}
        />,
      );
    });

    expect(container.textContent).toContain("AI inference");
    expect(container.textContent).toContain("Observed data");
    expect(container.textContent).toContain("Before-open brief");
    expect(container.textContent).toContain("Timestamped headline");
    expect(container.textContent).toContain("Evidence & limits");
    expect(container.textContent).toContain("GIFT quote, India VIX, Outside tape");
    expect(container.textContent).toContain("Mixed direction");
    expect(container.textContent).toContain("published");
  });

  it("shows an honest closeout and does not imply trade-plan records exist", async () => {
    await act(async () => {
      root.render(
        <MarketIntelCard
          market={{ phase: "post_close", session_anchor_date: "2026-09-29" }}
          outside={{}}
          oi={[{
            idx: "NIFTY",
            pcr: 0.94,
            ceChg: 100000,
            peChg: -200,
            asOf: "2026-09-29T15:40:00+05:30",
            dataStatus: "LIVE",
          }, {
            idx: "BANKNIFTY",
            pcr: 1.27,
            ceChg: -3958880,
            peChg: -942510,
            asOf: "2026-09-29T15:16:00+05:30",
            dataStatus: "STALE",
          }]}
          guide={{ source: "rules", guide: "No additional action from supplied data." }}
        />,
      );
    });

    expect(container.textContent).toContain("Session closeout");
    expect(container.textContent).toContain("Put-to-call OI ratio (PCR): 0.94");
    expect(container.textContent).toContain("Call OI change: 1,00,000");
    expect(container.textContent).toContain("Put OI change: -200");
    expect(container.textContent).toContain("LIVE");
    expect(container.textContent).toContain("STALE");
    expect(container.querySelector('[data-testid="desk-ai-brief-status-oi-BANKNIFTY"]')?.className).toContain("bg-amber-100");
    expect(container.textContent).toContain("Session: 29");
    expect(container.textContent).toContain("No trade-plan follow-up records are connected");
  });
});
