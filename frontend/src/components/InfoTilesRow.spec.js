import React, { act } from "react";
import { createRoot } from "react-dom/client";
import InfoTilesRow from "./InfoTilesRow";

jest.mock("@/components/HolidayBadge", () => ({
  __esModule: true,
  default: ({ open, onOpenChange }) => {
    const React = require("react");
    return React.createElement(React.Fragment, null,
      React.createElement("button", {
        type: "button",
        "data-testid": "holiday-toggle",
        onClick: () => onOpenChange(!open),
      }, "Holiday"),
      open ? React.createElement("div", { "data-testid": "holiday-menu" }, "Holiday menu") : null,
    );
  },
}));

jest.mock("@/components/FiiDiiBadge", () => ({
  __esModule: true,
  default: ({ open, onOpenChange }) => {
    const React = require("react");
    return React.createElement(React.Fragment, null,
      React.createElement("button", {
        type: "button",
        "data-testid": "fiidii-toggle",
        onClick: () => onOpenChange(!open),
      }, "FII/DII"),
      open ? React.createElement("div", { "data-testid": "fiidii-menu" }, "FII/DII menu") : null,
    );
  },
}));

jest.mock("@/components/MarketEventsBadge", () => ({
  __esModule: true,
  default: ({ open, onOpenChange }) => {
    const React = require("react");
    return React.createElement(React.Fragment, null,
      React.createElement("button", {
        type: "button",
        "data-testid": "events-toggle",
        onClick: () => onOpenChange(!open),
      }, "Events"),
      open ? React.createElement("div", { "data-testid": "events-menu" }, "Events menu") : null,
    );
  },
}));

jest.mock("@/components/MarketImpactBadge", () => ({
  __esModule: true,
  default: ({ open, onOpenChange }) => {
    const React = require("react");
    return React.createElement(React.Fragment, null,
      React.createElement("button", {
        type: "button",
        "data-testid": "impact-toggle",
        onClick: () => onOpenChange(!open),
      }, "Impact"),
      open ? React.createElement("div", { "data-testid": "impact-menu" }, "Impact menu") : null,
    );
  },
}));

describe("InfoTilesRow dropdown menus", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps only the most recently opened tile menu visible", async () => {
    await act(async () => {
      root.render(<InfoTilesRow />);
    });

    await act(async () => {
      container.querySelector('[data-testid="holiday-toggle"]').click();
    });
    expect(container.querySelector('[data-testid="holiday-menu"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-testid="events-toggle"]').click();
    });
    expect(container.querySelector('[data-testid="holiday-menu"]')).toBeNull();
    expect(container.querySelector('[data-testid="events-menu"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-testid="events-toggle"]').click();
    });
    expect(container.querySelector('[data-testid="events-menu"]')).toBeNull();
  });

  it("applies the same single-open behavior to every info tile menu", async () => {
    await act(async () => {
      root.render(<InfoTilesRow />);
    });

    for (const [id, otherId] of [["fiidii", "holiday"], ["impact", "events"]]) {
      await act(async () => {
        container.querySelector(`[data-testid="${id}-toggle"]`).click();
      });
      expect(container.querySelector(`[data-testid="${id}-menu"]`)).not.toBeNull();

      await act(async () => {
        container.querySelector(`[data-testid="${otherId}-toggle"]`).click();
      });
      expect(container.querySelector(`[data-testid="${id}-menu"]`)).toBeNull();
      expect(container.querySelector(`[data-testid="${otherId}-menu"]`)).not.toBeNull();
    }
  });
});
