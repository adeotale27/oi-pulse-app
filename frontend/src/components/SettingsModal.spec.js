import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SettingsModal from "./SettingsModal";
import { api } from "@/lib/api";
import { toast } from "sonner";

jest.mock("@/lib/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const element = (tag) => ({ children, ...props }) => React.createElement(tag, props, children);
  return {
    Dialog: ({ open, children }) => open ? React.createElement("div", null, children) : null,
    DialogContent: element("div"),
    DialogHeader: element("header"),
    DialogTitle: element("h2"),
    DialogDescription: element("p"),
  };
});

jest.mock("@/components/AdminDialogNavigation", () => () => null);
jest.mock("@/components/InfoTip", () => ({ children }) => <span>{children}</span>);
jest.mock("@/components/ui/input", () => {
  const React = require("react");
  return { Input: (props) => React.createElement("input", props) };
});
jest.mock("@/components/ui/label", () => {
  const React = require("react");
  return { Label: ({ children, ...props }) => React.createElement("label", props, children) };
});
jest.mock("@/components/ui/button", () => {
  const React = require("react");
  return {
    Button: ({ variant, size, ...props }) => React.createElement("button", props),
  };
});
jest.mock("@/components/ui/checkbox", () => {
  const React = require("react");
  return {
    Checkbox: ({ checked, onCheckedChange, ...props }) => React.createElement("button", {
      ...props,
      type: "button",
      role: "checkbox",
      "aria-checked": String(!!checked),
      onClick: () => onCheckedChange(!checked),
    }),
  };
});
jest.mock("@/components/ui/switch", () => {
  const React = require("react");
  return {
    Switch: ({ checked, onCheckedChange, ...props }) => React.createElement("button", {
      ...props,
      type: "button",
      role: "switch",
      "aria-checked": String(!!checked),
      onClick: () => onCheckedChange(!checked),
    }),
  };
});
jest.mock("@/components/ui/slider", () => {
  const React = require("react");
  return {
    Slider: ({ value = [], onValueChange, ...props }) => React.createElement("input", {
      ...props,
      type: "range",
      value: value[0] ?? 0,
      onChange: (event) => onValueChange([Number(event.target.value)]),
    }),
  };
});

const savedDesk = {
  threshold_pct: 15,
  cooldown_seconds: 120,
  compare_minutes: 3,
  enabled_indices: ["NIFTY", "SENSEX", "BANKNIFTY"],
  alert_enabled_indices: ["NIFTY"],
  straddle_enabled_indices: ["NIFTY", "SENSEX"],
  known_indices: ["NIFTY", "SENSEX", "BANKNIFTY"],
  visible_pages: ["oi-change"],
  admin_visible_pages: ["oi-change"],
  weekday_dashboard_defaults: {
    "0": "NIFTY",
    "1": "NIFTY",
    "2": "SENSEX",
    "3": "SENSEX",
    "4": "NIFTY",
  },
  lot_sizes: { NIFTY: 65, SENSEX: 20, BANKNIFTY: 30 },
  positions_poll_interval_seconds: 2,
};

describe("SettingsModal mobile layout and independent saves", () => {
  let container;
  let root;
  let originalWidth;

  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset().mockResolvedValue({ data: savedDesk });
    api.post.mockReset().mockImplementation(async (_path, payload) => ({ data: payload }));
    toast.success.mockReset();
    toast.error.mockReset();
    originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

  async function renderAdminSettings() {
    await act(async () => {
      root.render(<SettingsModal open onOpenChange={jest.fn()} isAdmin />);
      await Promise.resolve();
    });
    return document.querySelector('[data-testid="settings-modal"]');
  }

  it("keeps settings scrollable and the save bar reachable in a phone-width dialog", async () => {
    const modal = await renderAdminSettings();
    const content = modal.querySelector('[data-testid="settings-scroll-content"]');
    const saveBar = modal.querySelector('[data-testid="settings-save-bar"]');
    const saveActions = modal.querySelector('[data-testid="settings-save-actions"]');

    expect(modal.className).toContain("overflow-hidden");
    expect(modal.className).toContain("max-sm:p-4");
    expect(modal.querySelector("h2").className).toContain("flex-wrap");
    expect(content.className).toContain("overflow-y-auto");
    expect(content.contains(saveBar)).toBe(false);
    expect(saveBar.className).toContain("flex-col");
    expect(saveActions.className).toContain("grid-cols-1");
    for (const actionId of ["btn-save-desk-settings", "btn-save-personal-settings"]) {
      const action = modal.querySelector(`[data-testid="${actionId}"]`);
      expect(action.className).toContain("w-full");
      expect(action.className).toContain("max-sm:flex-col");
    }
  });

  it("saves browser-local thresholds without posting desk settings", async () => {
    localStorage.setItem("oiPulseSettings.v1", JSON.stringify({ gammaWallAbs: 123456 }));
    const modal = await renderAdminSettings();

    await act(async () => {
      modal.querySelector('[data-testid="btn-reset-local"]').click();
    });
    expect(modal.querySelector('[data-testid="personal-change-count"]').textContent).toContain("changed");

    await act(async () => {
      modal.querySelector('[data-testid="btn-save-personal-settings"]').click();
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("oiPulseSettings.v1")).gammaWallAbs).toBe(200000);
    expect(toast.success).toHaveBeenCalledWith("Personal thresholds saved on this device");
  });

  it("posts shared desk changes without replacing browser-local settings", async () => {
    localStorage.setItem("oiPulseSettings.v1", JSON.stringify({ gammaWallAbs: 123456 }));
    const modal = await renderAdminSettings();
    const trackedNifty = modal.querySelector('[data-testid="enabled-NIFTY"]');

    await act(async () => {
      trackedNifty.click();
    });
    await act(async () => {
      modal.querySelector('[data-testid="btn-save-desk-settings"]').click();
    });

    expect(api.post).toHaveBeenCalledWith("/settings", expect.objectContaining({
      enabled_indices: ["SENSEX", "BANKNIFTY"],
    }));
    expect(JSON.parse(localStorage.getItem("oiPulseSettings.v1")).gammaWallAbs).toBe(123456);
    expect(toast.success).toHaveBeenCalledWith("Desk settings saved to server");
  });

  it("keeps desk edits and shows a retryable inline error when the server save fails", async () => {
    api.post.mockRejectedValueOnce({
      response: { data: { detail: "Server unavailable" } },
    });
    const modal = await renderAdminSettings();
    const trackedNifty = modal.querySelector('[data-testid="enabled-NIFTY"]');

    await act(async () => {
      trackedNifty.click();
    });
    await act(async () => {
      modal.querySelector('[data-testid="btn-save-desk-settings"]').click();
    });

    expect(modal.querySelector('[data-testid="enabled-NIFTY"]').getAttribute("aria-checked")).toBe("false");
    expect(modal.querySelector('[data-testid="desk-change-count"]').textContent).toContain("1 setting changed");
    expect(modal.querySelector('[data-testid="settings-save-error"]').textContent).toContain("Server unavailable");
    expect(modal.querySelector('[data-testid="btn-save-desk-settings"]').disabled).toBe(false);
  });

  it("blocks desk writes until configuration loads and retries successfully", async () => {
    api.get
      .mockRejectedValueOnce(new Error("Settings offline"))
      .mockResolvedValueOnce({ data: savedDesk });
    const modal = await renderAdminSettings();

    expect(modal.querySelector('[data-testid="settings-health"]').textContent).toContain("Configuration unavailable");
    expect(modal.querySelector('[data-testid="btn-save-desk-settings"]').disabled).toBe(true);

    await act(async () => {
      modal.querySelector("button").click();
      await Promise.resolve();
    });

    expect(modal.querySelector('[data-testid="settings-health"]').textContent).toContain("Configuration loaded");
    expect(api.post).not.toHaveBeenCalled();
  });
});
