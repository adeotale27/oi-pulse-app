import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TradeCycleArchiveButton from "./TradeCycleArchiveButton";
import {
  compactTradeCycleArchive,
  downloadTradeCycleArchive,
  fetchTradeCycleArchiveMonths,
} from "@/lib/api";

jest.mock("@/lib/api", () => ({
  compactTradeCycleArchive: jest.fn(),
  downloadTradeCycleArchive: jest.fn(),
  fetchTradeCycleArchiveMonths: jest.fn(),
}));

jest.mock("@/components/ui/button", () => {
  const React = require("react");
  return { Button: (props) => React.createElement("button", props) };
});

jest.mock("@/components/ui/popover", () => {
  const React = require("react");
  const Context = React.createContext({});
  return {
    Popover: ({ open, onOpenChange, children }) => React.createElement(
      Context.Provider,
      { value: { open, onOpenChange } },
      children,
    ),
    PopoverTrigger: ({ children }) => {
      const context = React.useContext(Context);
      return React.cloneElement(children, {
        onClick: () => context.onOpenChange(!context.open),
      });
    },
    PopoverContent: ({ children }) => {
      const context = React.useContext(Context);
      return context.open ? React.createElement("div", null, children) : null;
    },
  };
});

jest.mock("@/components/ui/alert-dialog", () => {
  const React = require("react");
  const Context = React.createContext({});
  return {
    AlertDialog: ({ open, onOpenChange, children }) => React.createElement(
      Context.Provider,
      { value: { open, onOpenChange } },
      children,
    ),
    AlertDialogContent: ({ children }) => {
      const context = React.useContext(Context);
      return context.open ? React.createElement("div", null, children) : null;
    },
    AlertDialogHeader: ({ children }) => React.createElement("header", null, children),
    AlertDialogTitle: ({ children }) => React.createElement("h2", null, children),
    AlertDialogDescription: ({ children }) => React.createElement("p", null, children),
    AlertDialogFooter: ({ children }) => React.createElement("footer", null, children),
    AlertDialogCancel: ({ children, ...props }) => {
      const context = React.useContext(Context);
      return React.createElement("button", {
        ...props,
        type: "button",
        onClick: () => context.onOpenChange(false),
      }, children);
    },
    AlertDialogAction: ({ children, onClick, ...props }) => React.createElement(
      "button",
      { ...props, type: "button", onClick },
      children,
    ),
  };
});

jest.mock("lucide-react", () => ({
  Archive: () => null,
  Download: () => null,
}));

describe("TradeCycleArchiveButton", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
    fetchTradeCycleArchiveMonths.mockResolvedValue({
      retention_days: 90,
      cutoff: "2026-07-09",
      months: [{ month: "2026-06", count: 3 }],
    });
    downloadTradeCycleArchive.mockResolvedValue({
      name: "striklenz-cycle-archive-2026-06.jsonl.gz",
      sha256: "a".repeat(64),
      count: 3,
    });
    compactTradeCycleArchive.mockResolvedValue({
      archive_count: 3,
      compacted_count: 3,
      remaining_count: 0,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  async function openAndDownload() {
    await act(async () => root.render(<TradeCycleArchiveButton />));
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive"]').click());
    await act(async () => {});
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-download"]').click());
  }

  it("requires an explicit confirmation after downloading before compacting", async () => {
    await openAndDownload();

    expect(downloadTradeCycleArchive).toHaveBeenCalledWith("2026-06");
    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="btn-cycle-archive-compact"]').disabled).toBe(false);

    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-compact"]').click());
    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="btn-cycle-archive-confirm"]')).not.toBeNull();

    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-confirm"]').click());
    expect(compactTradeCycleArchive).toHaveBeenCalledWith("2026-06", "a".repeat(64));
    expect(container.textContent).toContain("Compacted 3 cycles");
  });

  it("leaves stored cycles untouched when the admin cancels confirmation", async () => {
    await openAndDownload();
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-compact"]').click());
    await act(async () => container.querySelector('[data-testid="alert-dialog-cancel"]').click());

    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
  });
});
