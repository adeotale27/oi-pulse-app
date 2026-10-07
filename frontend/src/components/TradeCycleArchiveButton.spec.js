import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TradeCycleArchiveButton from "./TradeCycleArchiveButton";
import {
  compactTradeCycleArchive,
  deleteTradeCycleArchive,
  downloadTradeCycleArchive,
  fetchTradeCycleArchiveRange,
} from "@/lib/api";
import { parseTradeCycleArchive } from "@/lib/tradeCycleArchive";

jest.mock("@/lib/api", () => ({
  compactTradeCycleArchive: jest.fn(),
  deleteTradeCycleArchive: jest.fn(),
  downloadTradeCycleArchive: jest.fn(),
  fetchTradeCycleArchiveRange: jest.fn(),
}));

jest.mock("@/lib/tradeCycleArchive", () => ({
  parseTradeCycleArchive: jest.fn(),
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
  Trash2: () => null,
  Upload: () => null,
}));

describe("TradeCycleArchiveButton", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
    fetchTradeCycleArchiveRange.mockResolvedValue({ count: 3, detail_count: 3 });
    downloadTradeCycleArchive.mockResolvedValue({
      name: "striklenz-cycle-archive-2026-06-12-to-2026-06-12.jsonl.gz",
      sha256: "a".repeat(64),
      count: 3,
    });
    compactTradeCycleArchive.mockResolvedValue({
      archive_count: 3,
      detail_count: 3,
      compacted_count: 3,
      remaining_count: 0,
    });
    deleteTradeCycleArchive.mockResolvedValue({
      from: "2026-06-12",
      to: "2026-06-12",
      archive_count: 3,
      deleted_count: 3,
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
    const fromDate = container.querySelector('[data-testid="cycle-archive-from"]').value;
    const toDate = container.querySelector('[data-testid="cycle-archive-to"]').value;
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-download"]').click());
    return { fromDate, toDate };
  }

  it("requires an explicit confirmation after downloading before compacting", async () => {
    const { fromDate, toDate } = await openAndDownload();

    expect(fetchTradeCycleArchiveRange).toHaveBeenCalledWith(fromDate, toDate);
    expect(downloadTradeCycleArchive).toHaveBeenCalledWith(fromDate, toDate);
    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="btn-cycle-archive-compact"]').disabled).toBe(false);

    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-compact"]').click());
    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="btn-cycle-archive-confirm"]')).not.toBeNull();

    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-confirm"]').click());
    expect(compactTradeCycleArchive).toHaveBeenCalledWith(fromDate, toDate, "a".repeat(64));
    expect(container.textContent).toContain("Compacted 3 detail sets");
  });

  it("leaves stored cycles untouched when the admin cancels confirmation", async () => {
    await openAndDownload();
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-compact"]').click());
    await act(async () => container.querySelector('[data-testid="alert-dialog-cancel"]').click());

    expect(compactTradeCycleArchive).not.toHaveBeenCalled();
  });

  it("requires archive download and confirmation before deleting the selected month", async () => {
    await openAndDownload();
    expect(deleteTradeCycleArchive).not.toHaveBeenCalled();

    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-delete"]').click());
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-confirm"]').click());

    const fromDate = container.querySelector('[data-testid="cycle-archive-from"]').value;
    const toDate = container.querySelector('[data-testid="cycle-archive-to"]').value;
    expect(deleteTradeCycleArchive).toHaveBeenCalledWith(fromDate, toDate, "a".repeat(64));
    expect(container.textContent).toContain("Permanently deleted 3 closed cycles");
  });

  it("uploads and parses the archive in the browser, then passes it to the calendar", async () => {
    const onArchiveLoaded = jest.fn();
    const archive = { name: "striklenz-cycle-archive-2026-06.jsonl.gz", month: "2026-06", count: 1, byDate: {} };
    parseTradeCycleArchive.mockResolvedValue(archive);
    await act(async () => root.render(<TradeCycleArchiveButton onArchiveLoaded={onArchiveLoaded} />));
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive"]').click());
    const input = container.querySelector('[data-testid="cycle-archive-upload"]');
    const file = new File(["local fixture"], archive.name, { type: "application/gzip" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));

    expect(parseTradeCycleArchive).toHaveBeenCalledWith(file);
    expect(onArchiveLoaded).toHaveBeenCalledWith(archive);
    expect(container.textContent).toContain("Loaded 1 cycles");
  });

  it("reloads and applies the exact inclusive date range to download and compaction", async () => {
    await act(async () => root.render(<TradeCycleArchiveButton />));
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive"]').click());
    await act(async () => {});

    const fromInput = container.querySelector('[data-testid="cycle-archive-from"]');
    const toInput = container.querySelector('[data-testid="cycle-archive-to"]');
    const toDate = toInput.value;
    const end = new Date(`${toDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() - 10);
    const selectedTo = end.toISOString().slice(0, 10);
    end.setUTCDate(end.getUTCDate() - 4);
    const selectedFrom = end.toISOString().slice(0, 10);

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setValue.call(fromInput, selectedFrom);
      fromInput.dispatchEvent(new Event("input", { bubbles: true }));
      fromInput.dispatchEvent(new Event("change", { bubbles: true }));
      setValue.call(toInput, selectedTo);
      toInput.dispatchEvent(new Event("input", { bubbles: true }));
      toInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});

    expect(fetchTradeCycleArchiveRange).toHaveBeenLastCalledWith(selectedFrom, selectedTo);
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-download"]').click());
    expect(downloadTradeCycleArchive).toHaveBeenCalledWith(selectedFrom, selectedTo);
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-compact"]').click());
    await act(async () => container.querySelector('[data-testid="btn-cycle-archive-confirm"]').click());
    expect(compactTradeCycleArchive).toHaveBeenCalledWith(selectedFrom, selectedTo, "a".repeat(64));
  });
});
