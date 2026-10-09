import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import MarketIntelPage from "./MarketIntelPage";

jest.mock("@/lib/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
  apiDetail: (_error, fallback) => fallback,
}));

jest.mock("@/lib/holidays", () => ({
  todayIST: () => "2026-10-09",
}));

jest.mock("@/components/DeskAiKeysAdmin", () => ({
  MarketIntelUserPrefs: () => null,
}));

describe("MarketIntelPage direction assessment", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
    api.get.mockImplementation((url) => {
      if (url === "/market-intel/config") {
        return Promise.resolve({ data: { config: { max_days_back: 5 } } });
      }
      if (url === "/market-intel/prefs") {
        return Promise.resolve({ data: { prefs: { ui_poll_seconds: 3600 } } });
      }
      if (url === "/market-intel") {
        return Promise.resolve({
          data: {
            items: [
              {
                event_cluster_id: "supportive",
                title: "RBI cuts repo rate",
                impact_band: "HIGH",
                impact_score: 78,
                market_direction: "SUPPORTIVE",
                direction_basis: "HEADLINE",
                directional_impact_score: 54,
                direction_reason: "Rate-cut language can support equities.",
                independent_source_count: 2,
                source_direction_agreement: "AGREE",
                market_timing: "IN_SESSION",
                news_freshness: "CURRENT",
                published_at_known: true,
                published_at: "2026-10-09T04:00:00Z",
                discovered_at: "2026-10-09T04:01:00Z",
                volatility_risk: "ELEVATED",
                volatility_risk_reason: "Policy catalyst may cause repricing.",
                india_link_reason: "Domestic rates can affect Indian equities.",
                india_link_status: "DIRECT",
              },
              {
                event_cluster_id: "negative",
                title: "Crude oil surges after supply disruption",
                impact_band: "HIGH",
                impact_score: 80,
                market_direction: "NEGATIVE",
                direction_basis: "HEADLINE",
                directional_impact_score: -61,
                direction_reason: "Higher crude can pressure India's import bill.",
              },
              {
                event_cluster_id: "mixed",
                title: "Rate cut arrives as inflation jumps",
                impact_band: "CRITICAL",
                impact_score: 92,
                market_direction: "MIXED",
                direction_basis: "HEADLINE",
                directional_impact_score: 0,
                direction_reason: "News contains opposing market cues.",
              },
              {
                event_cluster_id: "unclear",
                title: "RBI holds repo rate unchanged",
                impact_band: "MODERATE",
                impact_score: 65,
                market_direction: "UNCLEAR",
                direction_basis: "HEADLINE",
                directional_impact_score: 0,
                direction_reason: "Headline text has no clear directional catalyst.",
              },
            ],
          },
        });
      }
      if (url === "/market-intel/performance") {
        return Promise.resolve({
          data: {
            minimum_sample_count: 30,
            market_hours_story_count: 4,
            after_hours_story_count: 2,
            weekend_or_holiday_story_count: 0,
            results: [{
              index: "NIFTY",
              horizon: "15m",
              sample_count: 4,
              accuracy_pct: null,
              status: "BUILDING_SAMPLE",
              strength_bands: [
                { band: "WEAK", sample_count: 4, accuracy_pct: null },
                { band: "MODERATE", sample_count: 0, accuracy_pct: null },
                { band: "STRONG", sample_count: 0, accuracy_pct: null },
              ],
              strength_comparison: null,
            }],
            volatility: {
              india_vix: [{
                risk_level: "HIGH",
                horizon: "15m",
                sample_count: 30,
                material_increase_pct: 60,
                average_change_points: 0.7,
                unavailable_count: 2,
              }],
              index_ranges: [{
                risk_level: "HIGH",
                index: "NIFTY",
                horizon: "15m",
                sample_count: 30,
                range_increased_pct: 70,
                average_pre_range_pct: 0.1,
                average_post_range_pct: 0.2,
                unavailable_count: 1,
              }],
              catalysts: {
                india_vix: [{
                  catalyst: "GLOBAL_RATES",
                  horizon: "15m",
                  sample_count: 30,
                  material_increase_pct: 60,
                  average_change_points: 0.7,
                }],
                index_ranges: [{
                  catalyst: "GLOBAL_RATES",
                  index: "NIFTY",
                  horizon: "15m",
                  sample_count: 30,
                  range_increased_pct: 70,
                  average_pre_range_pct: 0.1,
                  average_post_range_pct: 0.2,
                }],
              },
            },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  it("renders support, pressure, mixed, and unclear news with distinct reasons and importance", async () => {
    await act(async () => {
      root.render(<MarketIntelPage />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-testid="mi-event"]')).toHaveLength(4);
    const lastEvent = container.querySelectorAll('[data-testid="mi-event"]')[3];
    [
      "mi-performance",
      "mi-confidence-calibration",
      "mi-volatility-performance",
      "mi-catalyst-performance",
    ].forEach((testId) => {
      const panel = container.querySelector(`[data-testid="${testId}"]`);
      expect(lastEvent.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(container.textContent).toContain("Importance 78");
    expect(container.textContent).toContain("Importance 80");
    expect(container.textContent).toContain("Likely market up");
    expect(container.textContent).toContain("Likely market down");
    expect(container.textContent).toContain("Mixed signals");
    expect(container.textContent).toContain("Market direction unclear");
    expect(container.textContent).toContain("Rate-cut language can support equities.");
    expect(container.textContent).toContain("Higher crude can pressure India's import bill.");
    expect(container.textContent).toContain("not a price forecast");
    expect(container.textContent).toContain("Independent reads agree");
    expect(container.textContent).toContain("Volatility ELEVATED");
    expect(container.textContent).toContain("Building sample 4/30");
    expect(container.textContent).toContain("Did volatility reads line up with later VIX rises or wider index ranges?");
    expect(container.textContent).toContain("VIX up 60% (30) · avg +0.7 pts");
    expect(container.textContent).toContain("Wider 70% (30) · 0.1% → 0.2%");
    expect(container.textContent).toContain("Do stronger direction reads perform better?");
    expect(container.textContent).toContain("not probabilities");
    expect(container.textContent).toContain("building 4/30");
    expect(container.textContent).toContain("Which catalysts were followed by volatility?");
    expect(container.textContent).toContain("GLOBAL RATES · 15m");
    expect(container.textContent).toContain("Elevated text-based volatility read: review short-option exposure.");
    expect(container.textContent).toContain("2 unavailable");
    expect(container.textContent).toContain("1 unavailable");
    expect(container.querySelector('[data-testid="mi-india-link"]')?.textContent).toContain("Domestic rates");
    expect(container.querySelector('[data-testid="mi-direction"]')?.className).toContain("emerald");
    expect(container.querySelector('[data-testid="mi-direction"]')?.getAttribute("title"))
      .toContain("Direction read from headline.");
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[1]?.className).toContain("rose");
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[2]?.className).toContain("amber");
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[3]?.className).toContain("slate");
    expect(container.querySelector('[data-testid="mi-direction"]')?.querySelector("svg")?.getAttribute("class")).toContain("h-3");
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[1]?.querySelector("svg")?.getAttribute("class")).toContain("h-3");
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[2]?.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll('[data-testid="mi-direction"]')[3]?.querySelector("svg")).toBeNull();
  });
});
