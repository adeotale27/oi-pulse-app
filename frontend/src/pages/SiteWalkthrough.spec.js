import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SiteWalkthrough from "@/pages/SiteWalkthrough";
import { siteWalkthroughAdapter } from "@/lib/siteWalkthroughApi";
import { api } from "@/lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, ...props }) => React.createElement("a", { href: to, ...props }),
  };
});

jest.mock("@/pages/Dashboard", () => {
  const React = require("react");
  return function DemoDashboard({ demoMode }) {
    return React.createElement("div", { "data-demo-dashboard": demoMode }, "StrikLenz dashboard");
  };
});

jest.mock("@/components/MaintenanceScreen", () => {
  const React = require("react");
  return function WalkthroughMaintenance({ notice, onRetry }) {
    return React.createElement(
      "main",
      { "data-walkthrough-maintenance": true },
      React.createElement("h1", null, "StrikLenz is under maintenance"),
      React.createElement("p", null, notice),
      React.createElement("button", { onClick: onRetry }, "Check for updates"),
    );
  };
});

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

describe("SiteWalkthrough", () => {
  let container;
  let root;
  let originalPath;

  beforeEach(() => {
    originalPath = window.location.pathname;
    window.history.replaceState({}, "", "/sitewalkthrough");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState({}, "", originalPath);
  });

  it("mounts the real dashboard in isolated demo mode when public access is enabled", async () => {
    api.get.mockResolvedValue({ data: { sitewalkthrough_enabled: true } });
    await act(async () => {
      root.render(<SiteWalkthrough />);
    });

    expect(api.get).toHaveBeenCalledWith("/auth/state", expect.objectContaining({
      skipSiteWalkthroughMock: true,
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    }));
    expect(container.querySelector("[data-demo-dashboard='true']")).not.toBeNull();
  });

  it("shows the branded maintenance state when an administrator has disabled the walkthrough", async () => {
    api.get.mockResolvedValue({ data: { sitewalkthrough_enabled: false } });
    await act(async () => {
      root.render(<SiteWalkthrough />);
    });

    expect(container.textContent).toContain("StrikLenz is under maintenance");
    expect(container.textContent).toContain("check with the administrator for updates");
    expect(container.querySelector("[data-demo-dashboard]")).toBeNull();
    expect(container.querySelector("[data-walkthrough-maintenance]")).not.toBeNull();
  });

  it("rechecks availability from the maintenance screen", async () => {
    api.get
      .mockResolvedValueOnce({ data: { sitewalkthrough_enabled: false } })
      .mockResolvedValueOnce({ data: { sitewalkthrough_enabled: true } });
    await act(async () => {
      root.render(<SiteWalkthrough />);
    });

    await act(async () => {
      container.querySelector("button").click();
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-demo-dashboard='true']")).not.toBeNull();
  });

  it("moves an already-open walkthrough to maintenance when availability is disabled", async () => {
    jest.useFakeTimers();
    api.get
      .mockResolvedValueOnce({ data: { sitewalkthrough_enabled: true, maintenance_mode: false } })
      .mockResolvedValueOnce({ data: { sitewalkthrough_enabled: false, maintenance_mode: true } });

    await act(async () => {
      root.render(<SiteWalkthrough />);
    });
    expect(container.querySelector("[data-demo-dashboard='true']")).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-demo-dashboard]")).toBeNull();
    expect(container.querySelector("[data-walkthrough-maintenance]")).not.toBeNull();
    jest.useRealTimers();
  });

  it("shows maintenance if the walkthrough flag is on but site-wide maintenance is active", async () => {
    api.get.mockResolvedValue({
      data: { sitewalkthrough_enabled: true, maintenance_mode: true },
    });

    await act(async () => {
      root.render(<SiteWalkthrough />);
    });

    expect(container.querySelector("[data-demo-dashboard]")).toBeNull();
    expect(container.querySelector("[data-walkthrough-maintenance]")).not.toBeNull();
  });

  it("serves fictional dashboard data and keeps writes in memory only", async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn();
    try {
      const config = await siteWalkthroughAdapter({ method: "get", url: "/api/config" });
      const positionWrite = await siteWalkthroughAdapter({
        method: "post",
        url: "/api/demo/positions",
        data: JSON.stringify({ note: "temporary demo entry" }),
      });
      const temporaryRead = await siteWalkthroughAdapter({ method: "get", url: "/api/demo/positions" });
      const memory = await siteWalkthroughAdapter({ method: "get", url: "/api/market-memory/NIFTY" });
      const alerts = await siteWalkthroughAdapter({ method: "get", url: "/api/alerts" });
      const events = await siteWalkthroughAdapter({ method: "get", url: "/api/events/NIFTY" });
      const fiiDii = await siteWalkthroughAdapter({ method: "get", url: "/api/market/fii-dii" });

      expect(config.data.visible_pages).toContain("positions");
      expect(config.data.visible_pages).not.toContain("cas");
      expect(positionWrite.data).toMatchObject({ ok: true, demo_only: true });
      expect(positionWrite.data.entry.note).toBe("temporary demo entry");
      expect(temporaryRead.data.entries).toContainEqual(positionWrite.data.entry);
      expect(memory.data.levels).toHaveLength(3);
      expect(alerts.data.alerts).toHaveLength(4);
      expect(events.data.events.some((event) => event.days_remaining >= 0)).toBe(true);
      expect(fiiDii.data.data.fii.net).toBe(-746.5);
      expect(global.fetch).not.toHaveBeenCalled();
      await expect(siteWalkthroughAdapter({ method: "get", url: "/api/unlisted-live-endpoint" }))
        .rejects.toMatchObject({ response: { status: 404 } });
    } finally {
      if (previousFetch) global.fetch = previousFetch;
      else delete global.fetch;
    }
  });
});
