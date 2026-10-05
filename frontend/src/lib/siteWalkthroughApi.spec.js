import { isSiteWalkthroughPath, siteWalkthroughAdapter } from "./siteWalkthroughApi";
import { api, fetchConfig, fetchExtras, fetchStraddleHistory, invalidateConfigCache, subscribeExtras } from "./api";

const read = async (url, params) => {
  const response = await siteWalkthroughAdapter({ method: "get", url, params });
  return response.data;
};

describe("site walkthrough market simulation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(["/sitewalkthrough", "/SITEWALKTHROUGH/", "/%73itewalkthrough/"])(
    "recognizes the isolated route spelling %s",
    (pathname) => {
      const originalPath = window.location.pathname;
      window.history.replaceState({}, "", pathname);

      expect(isSiteWalkthroughPath()).toBe(true);

      window.history.replaceState({}, "", originalPath);
    },
  );

  it.each(["/SITEWALKTHROUGH/", "/%73itewalkthrough/"])(
    "keeps API reads local for route variant %s",
    async (pathname) => {
      const originalPath = window.location.pathname;
      const previousFetch = global.fetch;
      global.fetch = jest.fn();
      window.history.replaceState({}, "", pathname);
      try {
        await expect(api.get("/api/unlisted-live-endpoint"))
          .rejects.toMatchObject({ response: { status: 404 } });
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        window.history.replaceState({}, "", originalPath);
        if (previousFetch) global.fetch = previousFetch;
        else delete global.fetch;
      }
    },
  );

  it("moves all sample indices, OI, and ATM straddles from the same market clock", async () => {
    const tickersBefore = await read("/api/tickers");
    const oiBefore = await read("/api/oi/NIFTY/change", { minutes: 15 });
    const straddleBefore = await read("/api/straddle/NIFTY/tick");
    const positionsBefore = await read("/api/positions");

    jest.setSystemTime(new Date("2026-10-06T04:01:00.000Z"));

    const tickersAfter = await read("/api/tickers");
    const oiAfter = await read("/api/oi/NIFTY/change", { minutes: 15 });
    const straddleAfter = await read("/api/straddle/NIFTY/tick");
    const positionsAfter = await read("/api/positions");

    expect(tickersAfter.tickers).toHaveLength(3);
    for (const ticker of tickersBefore.tickers) {
      expect(tickersAfter.tickers.find((item) => item.index === ticker.index).ltp).not.toBe(ticker.ltp);
    }
    expect(oiAfter.current.price).not.toBe(oiBefore.current.price);
    expect(oiAfter.current.strikes[8].ce_oi).not.toBe(oiBefore.current.strikes[8].ce_oi);
    expect(straddleAfter.premium).not.toBe(straddleBefore.premium);
    expect(straddleAfter.underlying).toBe(oiAfter.current.price);
    expect(straddleAfter.premium).toBe(straddleAfter.ce_ltp + straddleAfter.pe_ltp);
    expect(positionsAfter.positions[0].last_price).not.toBe(positionsBefore.positions[0].last_price);
    expect(positionsAfter.positions[0].pnl).not.toBe(positionsBefore.positions[0].pnl);
  });

  it("follows regular NSE session boundaries and freezes the last session outside hours", async () => {
    jest.setSystemTime(new Date("2026-10-06T03:44:00.000Z"));
    expect((await read("/api/status")).market.is_market_open).toBe(false);

    jest.setSystemTime(new Date("2026-10-06T03:45:00.000Z"));
    const openStatus = await read("/api/status");
    expect(openStatus.market).toMatchObject({
      is_market_open: true,
      is_oi_polling: true,
      market_open_ist: "09:15",
      market_close_ist: "15:30",
    });

    jest.setSystemTime(new Date("2026-10-06T10:00:00.000Z"));
    const closingTicker = await read("/api/tickers");
    expect((await read("/api/status")).market.is_market_open).toBe(false);
    jest.setSystemTime(new Date("2026-10-06T10:30:00.000Z"));
    const afterCloseTicker = await read("/api/tickers");
    expect(afterCloseTicker.tickers).toEqual(closingTicker.tickers);
  });

  it("keeps weekends and NSE holidays closed and returns the prior session's data", async () => {
    jest.setSystemTime(new Date("2026-10-03T06:00:00.000Z"));
    const weekend = await read("/api/status");
    expect(weekend.market).toMatchObject({ is_market_open: false, phase: "weekend" });
    expect(weekend.data_status.data_date).toBe("2026-10-01");

    jest.setSystemTime(new Date("2026-10-02T06:00:00.000Z"));
    const holiday = await read("/api/status");
    expect(holiday.market).toMatchObject({ is_market_open: false, phase: "holiday" });
    expect(holiday.data_status.data_date).toBe("2026-10-01");
  });

  it("uses listed Muhurat session hours instead of regular hours", async () => {
    jest.setSystemTime(new Date("2025-10-21T09:00:00.000Z"));
    const muhurat = await read("/api/status");
    expect(muhurat.market).toMatchObject({
      is_market_open: true,
      market_open_ist: "13:30",
      market_close_ist: "14:45",
    });

    jest.setSystemTime(new Date("2025-10-21T09:15:00.000Z"));
    expect((await read("/api/status")).market.is_market_open).toBe(false);
  });

  it("builds intraday OI and straddle histories from the same synthetic ticks", async () => {
    jest.setSystemTime(new Date("2026-10-06T07:30:00.000Z"));
    const oi = await read("/api/history/NIFTY");
    const straddle = await read("/api/straddle/NIFTY/history");
    expect(oi.history.length).toBeGreaterThan(20);
    expect(straddle.history.length).toBe(oi.history.length);
    expect(straddle.history[straddle.history.length - 1].underlying)
      .toBe(oi.history[oi.history.length - 1].price);
  });

  it("keeps sample alert IDs stable between polls and emits a new strike alert on its demo cadence", async () => {
    jest.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
    const initial = await read("/api/alerts");
    jest.setSystemTime(new Date("2026-10-06T04:00:15.000Z"));
    const sameWindow = await read("/api/alerts");

    expect(initial.alerts.length).toBeGreaterThan(0);
    expect(initial.alerts).toHaveLength(4);
    expect(sameWindow.alerts[0].created_at).toBe(initial.alerts[0].created_at);
    expect(initial.alerts[0]).toMatchObject({ sample: true, index: expect.any(String), atm: expect.any(Number) });
    expect(initial.alerts[0].strikes.length).toBeGreaterThan(0);

    jest.setSystemTime(new Date("2026-10-06T04:01:30.000Z"));
    const nextWindow = await read("/api/alerts");
    expect(nextWindow.alerts[0].created_at).not.toBe(initial.alerts[0].created_at);
  });

  it("provides a populated, fictional Desk AI brief without reaching live services", async () => {
    const outside = await read("/api/desk-outside");
    const guide = await read("/api/desk-guide");
    const postedGuide = await siteWalkthroughAdapter({
      method: "post",
      url: "/api/desk-guide",
      data: JSON.stringify({ surface: "desk", skip_llm: true }),
    });
    const disabled = await siteWalkthroughAdapter({
      method: "post",
      url: "/api/desk-ai",
      data: JSON.stringify({ desk_ai_show: false }),
    });
    const flags = await read("/api/desk-ai");

    expect(outside.quote_source).toBe("walkthrough sample");
    expect(outside.movers).toHaveLength(4);
    expect(outside.news).toHaveLength(2);
    expect(guide.guide).toContain("Sample read");
    expect(guide.evidence_quality.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Session OI" }),
      expect.objectContaining({ name: "Outside tape" }),
    ]));
    expect(postedGuide.data.guide).toBe(guide.guide);
    expect(postedGuide.data.demo_only).toBe(true);
    expect(disabled.data.desk_ai_show).toBe(false);
    expect(flags.desk_ai_show).toBe(false);
  });

  it("provides four correctly shaped walkthrough market-intelligence notifications", async () => {
    const feed = await read("/api/market-intel", { filter: "all", date: "2026-10-06" });
    const rbi = await read("/api/market-intel", { filter: "rbi", date: "2026-10-06" });
    const corporate = await read("/api/market-intel", { filter: "corporate", date: "2026-10-06" });

    expect(feed.items).toHaveLength(4);
    expect(feed.items[0]).toMatchObject({
      impact_band: "HIGH",
      event_type: "india_macro",
      source_name: "Walkthrough sample",
      impact_score: expect.any(Number),
      india_relevance_score: expect.any(Number),
    });
    expect(rbi.items.map((item) => item.id)).toEqual(["demo-mi-1"]);
    expect(corporate.items.map((item) => item.id)).toEqual(["demo-mi-4"]);
  });

  it("keeps walkthrough extras, config, and straddle history separate from live caches", async () => {
    const originalPath = window.location.pathname;
    const previousAdapter = api.defaults.adapter;
    const expiry = "2026-10-06";
    const date = "2026-10-06";
    const liveExtras = { source: "live-cache" };
    const liveConfig = { source: "live-cache" };
    const liveHistory = { source: "live-cache", history: [{ marker: "live" }] };
    api.defaults.adapter = jest.fn((config) => {
      const url = String(config.url || "");
      const data = url.endsWith("/tickers/extras") ? liveExtras
        : url.endsWith("/config") ? liveConfig
          : url.endsWith("/straddle/NIFTY/history") ? liveHistory
            : {};
      return Promise.resolve({ data, status: 200, statusText: "OK", headers: {}, config });
    });

    try {
      jest.advanceTimersByTime(60_000);
      window.history.replaceState({}, "", "/");
      invalidateConfigCache();
      expect(await fetchExtras()).toEqual(liveExtras);
      expect(await fetchConfig()).toEqual(liveConfig);
      expect(await fetchStraddleHistory("NIFTY", 60, { expiry, date })).toEqual(liveHistory);

      window.history.replaceState({}, "", "/sitewalkthrough");
      const onDemoExtras = jest.fn();
      const unsubscribe = subscribeExtras(onDemoExtras, { delayMs: 5000 });
      expect(onDemoExtras).not.toHaveBeenCalled();
      const demoExtras = await fetchExtras();
      const demoConfig = await fetchConfig();
      const demoHistory = await fetchStraddleHistory("NIFTY", 60, { expiry, date });
      unsubscribe();

      expect(demoExtras.vix.source).toBe("demo");
      expect(demoConfig).not.toEqual(liveConfig);
      expect(demoHistory.history.length).toBeGreaterThan(0);
      expect(demoHistory.history[0]).not.toHaveProperty("marker");

      window.history.replaceState({}, "", "/");
      expect(await fetchExtras()).toEqual(liveExtras);
      expect(await fetchConfig()).toEqual(liveConfig);
      expect(await fetchStraddleHistory("NIFTY", 60, { expiry, date })).toEqual(liveHistory);
      expect(api.defaults.adapter).toHaveBeenCalledTimes(3);
    } finally {
      window.history.replaceState({}, "", originalPath);
      api.defaults.adapter = previousAdapter;
      jest.clearAllTimers();
    }
  });
});
